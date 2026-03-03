/**
 * drawer.js — Controls doodle.gator via Puppeteer
 * ALL coordinates extracted from deepdebug_full.json (exact pixel positions)
 *
 * Canvas (displayed): x=379, y=37, w=523, h=617
 * Canvas (internal):  1016 x 1200
 * Scale: 523/1016 = 0.5147...
 *
 * Toolbar Row 1 (y≈709):  Brush=517, Eraser=578, Fill=640, Eyedrop=702, ColorBall=763
 * Toolbar Row 2 (y≈774):  Undo=517,  Redo=578,  Clear=639, Layers=700, SizeBall=762
 *
 * Color picker (open when color ball active):
 *   Saturation: x=540,y=459, w=200,h=136
 *   Hue slider:  x=540,y=610, w=200,h=12
 *   Alpha slider:x=540,y=637, w=200,h=12
 *   Hex input:   x=595,y=659, w=90,h=32  center=(640,675)
 *
 * Size slider (widthSlider): x=495,y=473, w=25,h=177  min=1 max=100
 *   top=473 (max size=100), bottom=650 (min size=1)
 *
 * Brush list (open when brush button active):
 *   Each row h=41, starting y=75
 *   Marker=75, PixelBrush=118, Shapes=161, Airbrush=204, DryBrush=247,
 *   WetBrush=290, VelvetPastel=333, SoftWatercolor=376, FlowingWatercolor=419,
 *   FlatBrush=462, Quill=505, Ink=548, Pencil=591, WatercolorTexture=634,
 *   Rembrandt=677, Dashed=720, Outline=763, Neon=806, Particles=849, Glyph=892
 *
 * Clear dialog: Cancel=(603,535) Clear=(721,535)
 */

const CANVAS = { x: 379, y: 37, w: 523, h: 617 };
const CANVAS_INTERNAL = { w: 1016, h: 1200 };
const SCALE_X = CANVAS.w / CANVAS_INTERNAL.w; // 0.5147
const SCALE_Y = CANVAS.h / CANVAS_INTERNAL.h; // 0.5142

// ── Toolbar buttons (center coords) ──────────────────────────────────────────
const TOOLS = {
  brush:     { x: 517, y: 709 },
  eraser:    { x: 578, y: 709 },
  fill:      { x: 640, y: 709 },
  eyedrop:   { x: 702, y: 709 },
  colorball: { x: 763, y: 709 }, // opens color picker
  undo:      { x: 517, y: 774 },
  redo:      { x: 578, y: 774 },
  clear:     { x: 639, y: 774 },
  layers:    { x: 700, y: 774 },
  sizeball:  { x: 762, y: 774 }, // drag up/down to resize
};

// ── Brush list (click brush button first, then pick) ─────────────────────────
const BRUSHES = {
  'Marker':              { x: 640, y: 96  },
  'Pixel Brush':         { x: 640, y: 139 },
  'Shapes':              { x: 640, y: 182 },
  'Airbrush':            { x: 640, y: 225 },
  'Dry brush':           { x: 640, y: 268 },
  'Wet brush':           { x: 640, y: 311 },
  'Velvet Pastel':       { x: 640, y: 354 },
  'Soft Watercolor':     { x: 640, y: 397 },
  'Flowing Watercolor':  { x: 640, y: 440 },
  'Flat brush':          { x: 640, y: 483 },
  'Quill':               { x: 640, y: 526 },
  'Ink':                 { x: 640, y: 569 },
  'Pencil':              { x: 640, y: 612 },
  'Watercolor (texture)':{ x: 640, y: 655 },
  'Rembrandt':           { x: 640, y: 698 },
  'Dashed':              { x: 640, y: 741 },
  'Outline':             { x: 640, y: 784 },
  'Neon':                { x: 640, y: 827 },
  'Particles':           { x: 640, y: 870 },
  'Glyph':               { x: 640, y: 913 },
};

// ── Color picker coords ───────────────────────────────────────────────────────
const COLOR_PICKER = {
  saturation: { x: 540, y: 459, w: 200, h: 136 },
  hue:        { x: 540, y: 610, w: 200, h: 12  },
  alpha:      { x: 540, y: 637, w: 200, h: 12  },
  hexInput:   { x: 640, y: 675 }, // center of hex input field
};

// ── Size slider ───────────────────────────────────────────────────────────────
const SIZE_SLIDER = {
  x: 507,    // center x of slider
  topY: 473, // y when size = 100 (max)
  botY: 650, // y when size = 1 (min)
};

// ── Clear dialog ──────────────────────────────────────────────────────────────
const CLEAR_DIALOG = {
  cancel: { x: 603, y: 535 },
  confirm: { x: 721, y: 535 },
};

// ── Convert your 0-1000 coords → screen pixels ───────────────────────────────
function toScreen(nx, ny) {
  return {
    x: Math.round(CANVAS.x + (nx / 1000) * CANVAS.w),
    y: Math.round(CANVAS.y + (ny / 1000) * CANVAS.h),
  };
}

// ── Mouse helpers ─────────────────────────────────────────────────────────────
async function click(page, x, y, delay = 50) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await sleep(delay);
  await page.mouse.up();
  await sleep(50);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Set brush size (1-100) ────────────────────────────────────────────────────
async function setBrushSize(page, size) {
  size = Math.max(1, Math.min(100, Math.round(size)));
  // y position: linear interpolation between topY (=100) and botY (=1)
  const t = (100 - size) / 99; // 0 when size=100, 1 when size=1
  const y = Math.round(SIZE_SLIDER.topY + t * (SIZE_SLIDER.botY - SIZE_SLIDER.topY));
  await page.mouse.move(SIZE_SLIDER.x, y);
  await page.mouse.down();
  await sleep(30);
  await page.mouse.up();
}

// ── Set color via hex input ───────────────────────────────────────────────────
async function setColor(page, hex) {
  if (!hex.startsWith('#')) hex = '#' + hex;

  // 1. Open color picker (click the color ball in toolbar)
  await click(page, TOOLS.colorball.x, TOOLS.colorball.y);
  await sleep(200);

  // 2. Click hex input, clear it, type new hex
  await click(page, COLOR_PICKER.hexInput.x, COLOR_PICKER.hexInput.y);
  await sleep(100);
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await sleep(50);
  await page.keyboard.type(hex, { delay: 30 });
  await page.keyboard.press('Enter');
  await sleep(150);

  // 3. Close color picker (click canvas area)
  await click(page, CANVAS.x + CANVAS.w / 2, CANVAS.y + CANVAS.h / 2);
  await sleep(100);
}

// ── Select brush type ─────────────────────────────────────────────────────────
async function setBrush(page, brushName) {
  const brush = BRUSHES[brushName];
  if (!brush) throw new Error(`Unknown brush: ${brushName}. Available: ${Object.keys(BRUSHES).join(', ')}`);

  // 1. Open brush panel (click brush button)
  await click(page, TOOLS.brush.x, TOOLS.brush.y);
  await sleep(300);

  // 2. Click the brush row
  await click(page, brush.x, brush.y);
  await sleep(200);
}

// ── Draw a stroke (array of {x,y} in 0-1000 coords) ──────────────────────────
async function drawStroke(page, points) {
  if (!points || points.length < 2) return;
  const first = toScreen(points[0].x, points[0].y);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await sleep(10);
  for (let i = 1; i < points.length; i++) {
    const p = toScreen(points[i].x, points[i].y);
    await page.mouse.move(p.x, p.y, { steps: 1 });
    await sleep(2);
  }
  await page.mouse.up();
  await sleep(20);
}

// ── Draw line (0-1000 coords) ─────────────────────────────────────────────────
async function drawLine(page, x1, y1, x2, y2, steps = 40) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    pts.push({ x: x1 + (x2 - x1) * (i / steps), y: y1 + (y2 - y1) * (i / steps) });
  }
  await drawStroke(page, pts);
}

// ── Draw circle (0-1000 coords) ───────────────────────────────────────────────
async function drawCircle(page, cx, cy, r, steps = 60) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  await drawStroke(page, pts);
}

// ── Draw rectangle (0-1000 coords) ───────────────────────────────────────────
async function drawRect(page, x1, y1, x2, y2) {
  const corners = [
    { x: x1, y: y1 }, { x: x2, y: y1 },
    { x: x2, y: y2 }, { x: x1, y: y2 }, { x: x1, y: y1 },
  ];
  const pts = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const a = corners[i], b = corners[i + 1];
    for (let s = 0; s <= 20; s++) {
      pts.push({ x: a.x + (b.x - a.x) * s / 20, y: a.y + (b.y - a.y) * s / 20 });
    }
  }
  await drawStroke(page, pts);
}

// ── Undo ──────────────────────────────────────────────────────────────────────
async function undo(page) {
  await click(page, TOOLS.undo.x, TOOLS.undo.y);
  await sleep(100);
}

// ── Redo ──────────────────────────────────────────────────────────────────────
async function redo(page) {
  await click(page, TOOLS.redo.x, TOOLS.redo.y);
  await sleep(100);
}

// ── Clear canvas ──────────────────────────────────────────────────────────────
async function clearCanvas(page) {
  await click(page, TOOLS.clear.x, TOOLS.clear.y);
  await sleep(300);
  await click(page, CLEAR_DIALOG.confirm.x, CLEAR_DIALOG.confirm.y);
  await sleep(200);
}

// ── Use eraser ────────────────────────────────────────────────────────────────
async function useEraser(page) {
  await click(page, TOOLS.eraser.x, TOOLS.eraser.y);
  await sleep(100);
}

// ── Use brush (back to drawing) ───────────────────────────────────────────────
async function useBrush(page) {
  await click(page, TOOLS.brush.x, TOOLS.brush.y);
  // Close brush menu immediately by pressing Escape or clicking canvas
  await sleep(100);
  await page.keyboard.press('Escape');
  await sleep(100);
}

module.exports = {
  // primitives
  toScreen,
  click,
  sleep,
  // drawing
  drawStroke,
  drawLine,
  drawCircle,
  drawRect,
  // tools
  setColor,
  setBrushSize,
  setBrush,
  useEraser,
  useBrush,
  undo,
  redo,
  clearCanvas,
  // raw coords (for custom use)
  TOOLS,
  BRUSHES,
  COLOR_PICKER,
  SIZE_SLIDER,
  CANVAS,
  SCALE_X,
  SCALE_Y,
};

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
