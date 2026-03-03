/**
 * main.js — Parasite Bot
 * Flow: Your Mini App (canvas.html) → WebSocket → Puppeteer → real doodle.gator game
 * Env vars: BOT_TOKEN, GROQ_API_KEY, PORT
 * Usage: /seturl <doodle url> — loads the game in puppeteer
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { Telegraf } = require('telegraf');
const puppeteer = require('puppeteer');
const Groq = require('groq-sdk');
const drawer = require('./drawer');
const { generateDrawingCommands } = require('./ai');

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
if (!BOT_TOKEN) { console.error('BOT_TOKEN missing'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

let browser, page;
let isDrawing = false;
let clients = new Set();

// ── Load a doodle URL into puppeteer ─────────────────────────────────────────
async function loadURL(url) {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--window-size=1280,900'],
    });
  }
  if (page) await page.close().catch(() => {});
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  console.log('Loading:', url);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.main-canvas', { timeout: 15000 });
  console.log('Canvas ready!');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function withLock(ctx, fn) {
  if (isDrawing) return ctx.reply('⏳ Already drawing...');
  isDrawing = true;
  const t = setTimeout(() => { isDrawing = false; }, 120000);
  fn().catch(e => ctx.reply('❌ ' + e.message)).finally(() => { isDrawing = false; clearTimeout(t); });
}

function requirePage(ctx) {
  if (!page) { ctx.reply('❌ No game loaded. Send /seturl <url> first'); return false; }
  return true;
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === WebSocket.OPEN) c.send(data);
}

async function executeCommands(commands) {
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'color':  await drawer.setColor(page, cmd.hex); break;
      case 'size':   await drawer.setBrushSize(page, cmd.px); break;
      case 'brush':  await drawer.setBrush(page, cmd.name); break;
      case 'line':   await drawer.drawLine(page, cmd.x1, cmd.y1, cmd.x2, cmd.y2); break;
      case 'circle': await drawer.drawCircle(page, cmd.cx, cmd.cy, cmd.r); break;
      case 'rect':   await drawer.drawRect(page, cmd.x1, cmd.y1, cmd.x2, cmd.y2); break;
      case 'stroke': await drawer.drawStroke(page, cmd.points); break;
    }
    await drawer.sleep(30);
  }
}

async function getTelegramFileBase64(ctx, fileId) {
  const file = await ctx.telegram.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
      res.on('error', reject);
    });
  });
}

async function runAIImage(base64, caption) {
  const res = await groq.chat.completions.create({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    max_tokens: 8000,
    messages: [
      { role: 'system', content: `Output ONLY JSON: {"commands":[{"type":"stroke","points":[{"x":n,"y":n},...]},...]}. Coords 0-1000. Max 60 strokes. No markdown.` },
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

// ── HTTP server — serves canvas.html ─────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'canvas.html'), (err, data) => {
      if (err) { res.writeHead(404); res.end('canvas.html missing'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else {
    res.writeHead(200); res.end('OK');
  }
});

// ── WebSocket — Mini App strokes → puppeteer ──────────────────────────────────
const wss = new WebSocket.Server({ server, path: '/ws' });
wss.on('connection', ws => {
  clients.add(ws);
  broadcast({ type: 'viewers', count: clients.size });
  console.log(`Mini App connected (${clients.size})`);

  ws.on('message', async raw => {
    try {
      const m = JSON.parse(raw);
      if (!page) return;

      if (m.type === 'user_stroke' && !isDrawing)
        await drawer.drawStroke(page, m.points);
      if (m.type === 'color')
        await drawer.setColor(page, m.hex);
      if (m.type === 'size')
        await drawer.setBrushSize(page, Math.min(100, m.px));
      if (m.type === 'brush')
        await drawer.setBrush(page, m.name);
      if (m.type === 'undo' && !isDrawing)
        await drawer.undo(page);
      if (m.type === 'redo' && !isDrawing)
        await drawer.redo(page);
      if (m.type === 'clear' && !isDrawing)
        await drawer.clearCanvas(page);
      if (m.type === 'fill' && !isDrawing) {
        await drawer.click(page, drawer.TOOLS.fill.x, drawer.TOOLS.fill.y);
        await drawer.sleep(50);
        const sx = Math.round(drawer.CANVAS.x + (m.x / drawer.CANVAS_INTERNAL.w) * drawer.CANVAS.w);
        const sy = Math.round(drawer.CANVAS.y + (m.y / drawer.CANVAS_INTERNAL.h) * drawer.CANVAS.h);
        await drawer.click(page, sx, sy);
        await drawer.sleep(50);
        await drawer.click(page, drawer.TOOLS.brush.x, drawer.TOOLS.brush.y);
        await drawer.sleep(100);
        await page.keyboard.press('Escape');
      }
    } catch (e) {
      console.error('WS error:', e.message);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcast({ type: 'viewers', count: clients.size });
  });
});

server.listen(PORT, () => console.log(`Server :${PORT}`));

// ── Bot commands ──────────────────────────────────────────────────────────────
bot.command('start', ctx => {
  const url = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'your-railway-url';
  ctx.reply(
    '🦠 *Parasite Bot*\n\n' +
    '1️⃣ Send the game URL: `/seturl https://doodle.gator...`\n' +
    '2️⃣ Open canvas: ' + url + '\n\n' +
    '`/line x1 y1 x2 y2 [#color] [size]`\n' +
    '`/circle cx cy r [#color]`\n' +
    '`/rect x1 y1 x2 y2 [#color]`\n' +
    '`/color #hex` `/size 1-100` `/brush name`\n' +
    '`/undo` `/redo` `/clear`\n' +
    '`/ai description` or send 📸 photo\n' +
    '`/brushes` `/clients` `/unlock` `/status`',
    { parse_mode: 'Markdown' }
  );
});

bot.command('seturl', async ctx => {
  const url = ctx.message.text.replace('/seturl', '').trim();
  if (!url || !url.startsWith('http')) return ctx.reply('Usage: /seturl https://doodle.gator.top/draw/?...');
  await ctx.reply('⏳ Loading game...');
  try {
    await loadURL(url);
    ctx.reply('✅ Canvas ready! Start drawing.');
  } catch (e) {
    ctx.reply('❌ Failed: ' + e.message);
  }
});

bot.command('status', ctx => {
  ctx.reply(
    `🤖 Puppeteer: ${page ? '✅ ready' : '❌ not loaded (use /seturl)'}\n` +
    `👁 Mini App viewers: ${clients.size}\n` +
    `🔒 Drawing lock: ${isDrawing ? 'locked' : 'free'}`
  );
});

bot.command('brushes', ctx =>
  ctx.reply('🖌 Brushes:\n' + Object.keys(drawer.BRUSHES).map(b => '• ' + b).join('\n'))
);

bot.command('clients', ctx =>
  ctx.reply(`👁 ${clients.size} viewer(s)\n🤖 Puppeteer: ${page ? '✅ ready' : '❌ not ready'}`)
);

bot.command('unlock', ctx => { isDrawing = false; ctx.reply('🔓 Unlocked'); });

bot.command('color', ctx => {
  if (!requirePage(ctx)) return;
  const hex = ctx.message.text.split(' ')[1];
  if (!hex) return ctx.reply('Usage: /color #ff0000');
  withLock(ctx, async () => { await drawer.setColor(page, hex); ctx.reply('✅ Color: ' + hex); });
});

bot.command('size', ctx => {
  if (!requirePage(ctx)) return;
  const px = Number(ctx.message.text.split(' ')[1]);
  if (!px || px < 1 || px > 100) return ctx.reply('Usage: /size 1-100');
  withLock(ctx, async () => { await drawer.setBrushSize(page, px); ctx.reply('✅ Size: ' + px); });
});

bot.command('brush', ctx => {
  if (!requirePage(ctx)) return;
  const name = ctx.message.text.replace('/brush', '').trim();
  if (!name) return ctx.reply('Usage: /brush Marker\nSee /brushes');
  withLock(ctx, async () => { await drawer.setBrush(page, name); ctx.reply('✅ Brush: ' + name); });
});

bot.command('line', ctx => {
  if (!requirePage(ctx)) return;
  const parts = ctx.message.text.split(' ').slice(1);
  const colorArg = parts.find(p => p.startsWith('#'));
  const nums = parts.filter(p => !p.startsWith('#')).map(Number).filter(n => !isNaN(n));
  if (nums.length < 4) return ctx.reply('Usage: /line x1 y1 x2 y2 [#color] [size]\nCoords: 0-1000');
  withLock(ctx, async () => {
    if (colorArg) await drawer.setColor(page, colorArg);
    if (nums[4]) await drawer.setBrushSize(page, Math.min(100, nums[4]));
    await drawer.drawLine(page, nums[0], nums[1], nums[2], nums[3]);
    ctx.reply('✅');
  });
});

bot.command('circle', ctx => {
  if (!requirePage(ctx)) return;
  const parts = ctx.message.text.split(' ').slice(1);
  const colorArg = parts.find(p => p.startsWith('#'));
  const nums = parts.filter(p => !p.startsWith('#')).map(Number).filter(n => !isNaN(n));
  if (nums.length < 3) return ctx.reply('Usage: /circle cx cy r [#color]');
  withLock(ctx, async () => {
    if (colorArg) await drawer.setColor(page, colorArg);
    await drawer.drawCircle(page, nums[0], nums[1], nums[2]);
    ctx.reply('✅');
  });
});

bot.command('rect', ctx => {
  if (!requirePage(ctx)) return;
  const parts = ctx.message.text.split(' ').slice(1);
  const colorArg = parts.find(p => p.startsWith('#'));
  const nums = parts.filter(p => !p.startsWith('#')).map(Number).filter(n => !isNaN(n));
  if (nums.length < 4) return ctx.reply('Usage: /rect x1 y1 x2 y2 [#color]');
  withLock(ctx, async () => {
    if (colorArg) await drawer.setColor(page, colorArg);
    await drawer.drawRect(page, nums[0], nums[1], nums[2], nums[3]);
    ctx.reply('✅');
  });
});

bot.command('undo', ctx => {
  if (!requirePage(ctx)) return;
  withLock(ctx, async () => { await drawer.undo(page); ctx.reply('↩️'); });
});

bot.command('redo', ctx => {
  if (!requirePage(ctx)) return;
  withLock(ctx, async () => { await drawer.redo(page); ctx.reply('↪️'); });
});

bot.command('clear', ctx => {
  if (!requirePage(ctx)) return;
  withLock(ctx, async () => { await drawer.clearCanvas(page); ctx.reply('🗑 Cleared'); });
});

bot.command('ai', async ctx => {
  if (!requirePage(ctx)) return;
  const description = ctx.message.text.replace('/ai', '').trim();
  if (!description) return ctx.reply('Usage: /ai cute cat');
  await ctx.reply('🤖 Generating...');
  withLock(ctx, async () => {
    const commands = await generateDrawingCommands(description);
    await ctx.reply(`Drawing ${commands.length} strokes...`);
    await executeCommands(commands);
    ctx.reply('🎨 Done!');
  });
});

bot.on('photo', async ctx => {
  if (!requirePage(ctx)) return;
  await ctx.reply('📸 Analyzing...');
  withLock(ctx, async () => {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const base64 = await getTelegramFileBase64(ctx, fileId);
    const caption = ctx.message.caption || 'Redraw as clean line art';
    const cmds = await runAIImage(base64, caption);
    await ctx.reply(`Drawing ${cmds.length} strokes...`);
    await executeCommands(cmds);
    ctx.reply('🎨 Done!');
  });
});

bot.catch((err, ctx) => { console.error(err.message); ctx.reply('❌ ' + err.message); });
bot.launch().then(() => console.log('Bot started!')).catch(e => console.error(e.message));
process.once('SIGINT',  () => { browser?.close(); bot.stop('SIGINT'); });
process.once('SIGTERM', () => { browser?.close(); bot.stop('SIGTERM'); });
