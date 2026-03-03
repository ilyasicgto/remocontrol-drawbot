/**
 * main.js — Bot + Server in one file
 */

const http = require('http');
const https = require('https');
const { Telegraf } = require('telegraf');
const puppeteer = require('puppeteer');
const Groq = require('groq-sdk');

const {
  drawLine, drawCircle, drawRect, drawFreeStroke,
  setColor, setBrushSize, selectBrushType,
  undo, redo, clearCanvas, screenshotCanvas, sleep,
} = require('./drawer');
const { generateDrawingCommands } = require('./ai');

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
if (!BOT_TOKEN) { console.error('❌ BOT_TOKEN missing'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

let browser = null, page = null, isReady = false, isDrawing = false;

// ── Browser init ──────────────────────────────────────────────────────────────
async function initBrowser(url) {
  if (browser) { await browser.close().catch(() => {}); browser = null; page = null; isReady = false; }
  console.log('🚀 Launching browser for:', url);
  browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 120000,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,900',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  try { await page.waitForSelector('canvas.main-canvas', { timeout: 15000 }); }
  catch(e) { await page.waitForSelector('canvas', { timeout: 15000 }); }
  await sleep(3000);
  isReady = true;
// Pre-focus canvas and select brush tool
  await page.mouse.click(517, 709);
  await sleep(300);
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.evaluate(() => {
    const c = document.querySelector('canvas.main-canvas');
    if (c) c.focus();
  });
  console.log('✅ Browser ready!');
}

// ── Screenshot ────────────────────────────────────────────────────────────────
async function sendPic(ctx) {
  const jpg = await screenshotCanvas(page);
  await ctx.replyWithPhoto({ source: jpg });
}

// ── AI image via Groq vision ──────────────────────────────────────────────────
async function runAIImage(base64, caption) {
  const res = await groq.chat.completions.create({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    max_tokens: 8000,
    messages: [
      { role: 'system', content: `You are a drawing bot. Output ONLY JSON object with key "commands" containing array of strokes.
Types: {"type":"stroke","points":[{"x":n,"y":n},...]}
Coordinates 0-1000. Max 60 strokes. Trace main outlines only. No markdown.` },
      { role: 'user', content: [
        { type: 'text', text: caption },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } }
      ]}
    ]
  });
  const raw = res.choices[0].message.content.trim().replace(/```json|```/g, '');
  const parsed = JSON.parse(raw);
  return parsed.commands || parsed;
}

// ── Execute commands ──────────────────────────────────────────────────────────
async function executeCommands(commands) {
  for (const cmd of commands) {
    switch(cmd.type) {
      case 'color':  await setColor(page, cmd.hex); break;
      case 'size':   await setBrushSize(page, cmd.px); break;
      case 'line':   await drawLine(page, cmd.x1, cmd.y1, cmd.x2, cmd.y2); break;
      case 'circle': await drawCircle(page, cmd.cx, cmd.cy, cmd.r); break;
      case 'rect':   await drawRect(page, cmd.x1, cmd.y1, cmd.x2, cmd.y2); break;
      case 'stroke': await drawFreeStroke(page, cmd.points); break;
    }
    await sleep(20);
  }
}

// ── Download Telegram file as base64 ─────────────────────────────────────────
async function getTelegramFileBase64(ctx, fileId) {
  const file = await ctx.telegram.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
      res.on('error', reject);
    });
  });
}

// ── Lock helper ───────────────────────────────────────────────────────────────
function withLock(ctx, fn) {
  if (isDrawing) return ctx.reply('⏳ Already drawing, please wait...');
  isDrawing = true;
  const timeout = setTimeout(() => { isDrawing = false; }, 120000);
  fn().catch(e => ctx.reply('❌ ' + e.message)).finally(() => { isDrawing = false; clearTimeout(timeout); });
}

function checkReady(ctx) {
  if (!isReady) { ctx.reply('❌ No canvas attached. Send a CrocoDraw URL first.'); return false; }
  return true;
}

// ── Telegram Commands ─────────────────────────────────────────────────────────
bot.command('start', (ctx) => ctx.reply(
  '🦠 *Parasite Bot*\n\n📎 Send a CrocoDraw URL to attach\n\n' +
  '*Commands:*\n`/line x1 y1 x2 y2 [#color] [size]`\n`/circle cx cy r [#color]`\n`/rect x1 y1 x2 y2 [#color]`\n' +
  '`/color #hex` `/size px` `/brush name`\n`/undo` `/redo` `/clear`\n' +
  '`/ai description`\n📸 Send a photo to redraw it!\n`/pic` `/unlock` `/debug`',
  { parse_mode: 'Markdown' }
));

bot.command('unlock', (ctx) => {
  isDrawing = false;
  ctx.reply('🔓 Unlocked');
});

bot.command('pic', async (ctx) => {
  if (!checkReady(ctx)) return;
  isDrawing = false;
  try { await sendPic(ctx); } catch(e) { ctx.reply('❌ ' + e.message); }
});

bot.command('debug', async (ctx) => {
  if (!checkReady(ctx)) return;
  try {
    const info = await page.evaluate(() => {
      const c = document.querySelector('canvas.main-canvas') || document.querySelector('canvas');
      if (!c) return { error: 'no canvas' };
      const r = c.getBoundingClientRect();
      return {
        title: document.title,
        url: window.location.href.substring(0, 80),
        canvas: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        viewport: { w: window.innerWidth, h: window.innerHeight }
      };
    });
    ctx.reply('🔍 Debug:\n' + JSON.stringify(info, null, 2));
  } catch(e) { ctx.reply('❌ ' + e.message); }
});

bot.command('line', async (ctx) => {
  if (!checkReady(ctx)) return;
  const parts = ctx.message.text.split(' ').slice(1);
  const colorArg = parts.find(p => p.startsWith('#'));
  const nums = parts.filter(p => !p.startsWith('#')).map(Number).filter(n => !isNaN(n));
  if (nums.length < 4) return ctx.reply('Usage: /line x1 y1 x2 y2 [#color] [size]\nCoords: 0-1000');
  await ctx.reply('⏳ Drawing...');
  withLock(ctx, async () => {
    if (colorArg) await setColor(page, colorArg);
    if (nums[4]) await setBrushSize(page, nums[4]);
    await drawLine(page, nums[0], nums[1], nums[2], nums[3]);
    await sendPic(ctx);
  });
});

bot.command('circle', async (ctx) => {
  if (!checkReady(ctx)) return;
  const parts = ctx.message.text.split(' ').slice(1);
  const colorArg = parts.find(p => p.startsWith('#'));
  const nums = parts.filter(p => !p.startsWith('#')).map(Number).filter(n => !isNaN(n));
  if (nums.length < 3) return ctx.reply('Usage: /circle cx cy r [#color]\nCoords: 0-1000');
  await ctx.reply('⏳ Drawing...');
  withLock(ctx, async () => {
    if (colorArg) await setColor(page, colorArg);
    await drawCircle(page, nums[0], nums[1], nums[2]);
    await sendPic(ctx);
  });
});

bot.command('rect', async (ctx) => {
  if (!checkReady(ctx)) return;
  const parts = ctx.message.text.split(' ').slice(1);
  const colorArg = parts.find(p => p.startsWith('#'));
  const nums = parts.filter(p => !p.startsWith('#')).map(Number).filter(n => !isNaN(n));
  if (nums.length < 4) return ctx.reply('Usage: /rect x1 y1 x2 y2 [#color]\nCoords: 0-1000');
  await ctx.reply('⏳ Drawing...');
  withLock(ctx, async () => {
    if (colorArg) await setColor(page, colorArg);
    await drawRect(page, nums[0], nums[1], nums[2], nums[3]);
    await sendPic(ctx);
  });
});

bot.command('color', async (ctx) => {
  if (!checkReady(ctx)) return;
  const hex = ctx.message.text.split(' ')[1];
  if (!hex) return ctx.reply('Usage: /color #ff0000');
  try {
    await setColor(page, hex.startsWith('#') ? hex : '#' + hex);
    ctx.reply('✅ Color set to ' + hex);
  } catch(e) { ctx.reply('❌ ' + e.message); }
});

bot.command('size', async (ctx) => {
  if (!checkReady(ctx)) return;
  const px = Number(ctx.message.text.split(' ')[1]);
  if (!px) return ctx.reply('Usage: /size 20');
  try {
    await setBrushSize(page, px);
    ctx.reply('✅ Size set to ' + px + 'px');
  } catch(e) { ctx.reply('❌ ' + e.message); }
});

bot.command('brush', async (ctx) => {
  if (!checkReady(ctx)) return;
  const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!name) return ctx.reply(
    'Usage: /brush <name>\nAvailable: Flowing Watercolor, Flat brush, Quill, Ink, Pencil, Watercolor (texture), Rembrandt'
  );
  try {
    await selectBrushType(page, name);
    ctx.reply('✅ Brush set to ' + name);
  } catch(e) { ctx.reply('❌ ' + e.message); }
});

bot.command('undo', async (ctx) => {
  if (!checkReady(ctx)) return;
  try { await undo(page); ctx.reply('↩️ Undone'); } catch(e) { ctx.reply('❌ ' + e.message); }
});

bot.command('redo', async (ctx) => {
  if (!checkReady(ctx)) return;
  try { await redo(page); ctx.reply('↪️ Redone'); } catch(e) { ctx.reply('❌ ' + e.message); }
});

bot.command('clear', async (ctx) => {
  if (!checkReady(ctx)) return;
  try { await clearCanvas(page); await sendPic(ctx); } catch(e) { ctx.reply('❌ ' + e.message); }
});

bot.command('ai', async (ctx) => {
  if (!checkReady(ctx)) return;
  const description = ctx.message.text.replace('/ai', '').trim();
  if (!description) return ctx.reply('Usage: /ai anime girl with blue eyes');
  await ctx.reply('🤖 Generating drawing plan...');
  withLock(ctx, async () => {
    const commands = await generateDrawingCommands(description);
    await ctx.reply(`✅ Got ${commands.length} commands, drawing now...`);
    await executeCommands(commands);
    await sendPic(ctx);
  });
});

bot.on('photo', async (ctx) => {
  if (!checkReady(ctx)) return;
  await ctx.reply('📸 Analyzing image...');
  withLock(ctx, async () => {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const base64 = await getTelegramFileBase64(ctx, fileId);
    const caption = ctx.message.caption || 'Redraw this image as line art. Trace all main outlines.';
    const cmds = await runAIImage(base64, caption);
    await ctx.reply(`✅ Got ${cmds.length} strokes, drawing now...`);
    await executeCommands(cmds);
    await sendPic(ctx);
  });
});

bot.on('text', async (ctx) => {
  const t = ctx.message.text;
  if (t.startsWith('/')) return;
  if (t.startsWith('http')) {
    await ctx.reply('⏳ Attaching...');
    try {
      await initBrowser(t);
      ctx.reply('✅ Attached! Use /pic or send a photo 📸');
    } catch(e) { ctx.reply('❌ ' + e.message); }
  }
});

bot.catch((err, ctx) => {
  console.error('Bot error:', err.message);
  ctx.reply('❌ ' + err.message);
});

http.createServer((req, res) => res.end('Parasite Bot 🦠')).listen(PORT, () => {
  console.log(`🌐 HTTP server on :${PORT}`);
});

bot.launch()
  .then(() => console.log('✅ Bot started!'))
  .catch(err => console.error('❌ Bot failed:', err.message));

process.once('SIGINT', () => { bot.stop('SIGINT'); if (browser) browser.close(); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); if (browser) browser.close(); });
