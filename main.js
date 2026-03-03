/**
 * main.js — Bot + WebSocket Server (no puppeteer)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');
const WebSocket = require('ws');
const Groq = require('groq-sdk');
const { generateDrawingCommands } = require('./ai');

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
if (!BOT_TOKEN) { console.error('❌ BOT_TOKEN missing'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Canvas state ──────────────────────────────────────────────────────────────
let strokes = [];
let currentColor = '#1a1a1a';
let currentSize = 10;
let clients = new Set();
let isDrawing = false;

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === WebSocket.OPEN) c.send(data);
}

function setColor(hex) {
  currentColor = hex;
  broadcast({ type: 'color', hex });
}

function setSize(px) {
  currentSize = Math.max(1, Math.min(200, px));
  broadcast({ type: 'size', px: currentSize });
}

function buildPoints(x1, y1, x2, y2) {
  const steps = Math.max(30, Math.round(Math.sqrt((x2-x1)**2 + (y2-y1)**2) / 5));
  const pts = [];
  for (let i = 0; i <= steps; i++)
    pts.push({ x: x1 + (x2-x1)*(i/steps), y: y1 + (y2-y1)*(i/steps) });
  return pts;
}

function pushStroke(points, color, size) {
  const s = { color: color || currentColor, size: size || currentSize, points };
  strokes.push(s);
  broadcast({ type: 'stroke_end', ...s });
}

function drawLine(x1, y1, x2, y2) { pushStroke(buildPoints(x1,y1,x2,y2)); }

function drawCircle(cx, cy, r) {
  const pts = [];
  for (let i = 0; i <= 80; i++) {
    const a = (i/80)*Math.PI*2;
    pts.push({ x: cx + Math.cos(a)*r, y: cy + Math.sin(a)*r });
  }
  pushStroke(pts);
}

function drawRect(x1, y1, x2, y2) {
  const corners = [{x:x1,y:y1},{x:x2,y:y1},{x:x2,y:y2},{x:x1,y:y2},{x:x1,y:y1}];
  const pts = [];
  for (let i = 0; i < corners.length-1; i++) {
    const a = corners[i], b = corners[i+1];
    for (let s = 0; s <= 20; s++)
      pts.push({ x: a.x+(b.x-a.x)*s/20, y: a.y+(b.y-a.y)*s/20 });
  }
  pushStroke(pts);
}

function drawFreeStroke(points) { pushStroke(points); }

function clearCanvas() {
  strokes = [];
  broadcast({ type: 'clear' });
}

function undoCanvas() {
  if (!strokes.length) return false;
  strokes.pop();
  broadcast({ type: 'undo', strokes });
  return true;
}

// ── Execute AI commands ───────────────────────────────────────────────────────
function executeCommands(commands) {
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'color':  setColor(cmd.hex); break;
      case 'size':   setSize(cmd.px); break;
      case 'line':   drawLine(cmd.x1, cmd.y1, cmd.x2, cmd.y2); break;
      case 'circle': drawCircle(cmd.cx, cmd.cy, cmd.r); break;
      case 'rect':   drawRect(cmd.x1, cmd.y1, cmd.x2, cmd.y2); break;
      case 'stroke': drawFreeStroke(cmd.points); break;
    }
  }
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

// ── Download Telegram file as base64 ─────────────────────────────────────────
async function getTelegramFileBase64(ctx, fileId) {
  const file = await ctx.telegram.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
      res.on('error', reject);
    });
  });
}

// ── Lock helper ───────────────────────────────────────────────────────────────
function withLock(ctx, fn) {
  if (isDrawing) return ctx.reply('⏳ Already drawing, please wait...');
  isDrawing = true;
  const t = setTimeout(() => { isDrawing = false; }, 120000);
  fn().catch(e => ctx.reply('❌ ' + e.message)).finally(() => { isDrawing = false; clearTimeout(t); });
}

// ── Bot commands ──────────────────────────────────────────────────────────────
bot.command('start', (ctx) => ctx.reply(
  '🦠 *Parasite Bot*\n\n' +
  '🖼 Open the Mini App to see the canvas live!\n\n' +
  '*Commands:*\n`/line x1 y1 x2 y2 [#color] [size]`\n`/circle cx cy r [#color]`\n`/rect x1 y1 x2 y2 [#color]`\n' +
  '`/color #hex` `/size px`\n`/undo` `/clear`\n' +
  '`/ai description`\n📸 Send a photo to redraw it!\n`/viewers` `/unlock`',
  { parse_mode: 'Markdown' }
));

bot.command('unlock', (ctx) => { isDrawing = false; ctx.reply('🔓 Unlocked'); });

bot.command('viewers', (ctx) => ctx.reply(`👁 ${clients.size} viewer(s) connected`));

bot.command('line', async (ctx) => {
  const parts = ctx.message.text.split(' ').slice(1);
  const colorArg = parts.find(p => p.startsWith('#'));
  const nums = parts.filter(p => !p.startsWith('#')).map(Number).filter(n => !isNaN(n));
  if (nums.length < 4) return ctx.reply('Usage: /line x1 y1 x2 y2 [#color] [size]\nCoords: 0-1000');
  if (colorArg) setColor(colorArg);
  if (nums[4]) setSize(nums[4]);
  drawLine(nums[0], nums[1], nums[2], nums[3]);
  ctx.reply('✅ Line drawn!');
});

bot.command('circle', async (ctx) => {
  const parts = ctx.message.text.split(' ').slice(1);
  const colorArg = parts.find(p => p.startsWith('#'));
  const nums = parts.filter(p => !p.startsWith('#')).map(Number).filter(n => !isNaN(n));
  if (nums.length < 3) return ctx.reply('Usage: /circle cx cy r [#color]\nCoords: 0-1000');
  if (colorArg) setColor(colorArg);
  drawCircle(nums[0], nums[1], nums[2]);
  ctx.reply('✅ Circle drawn!');
});

bot.command('rect', async (ctx) => {
  const parts = ctx.message.text.split(' ').slice(1);
  const colorArg = parts.find(p => p.startsWith('#'));
  const nums = parts.filter(p => !p.startsWith('#')).map(Number).filter(n => !isNaN(n));
  if (nums.length < 4) return ctx.reply('Usage: /rect x1 y1 x2 y2 [#color]\nCoords: 0-1000');
  if (colorArg) setColor(colorArg);
  drawRect(nums[0], nums[1], nums[2], nums[3]);
  ctx.reply('✅ Rect drawn!');
});

bot.command('color', (ctx) => {
  const hex = ctx.message.text.split(' ')[1];
  if (!hex) return ctx.reply('Usage: /color #ff0000');
  setColor(hex.startsWith('#') ? hex : '#' + hex);
  ctx.reply('✅ Color set to ' + hex);
});

bot.command('size', (ctx) => {
  const px = Number(ctx.message.text.split(' ')[1]);
  if (!px) return ctx.reply('Usage: /size 20');
  setSize(px);
  ctx.reply('✅ Size set to ' + px + 'px');
});

bot.command('undo', (ctx) => {
  if (undoCanvas()) ctx.reply('↩️ Undone');
  else ctx.reply('Nothing to undo');
});

bot.command('clear', (ctx) => {
  clearCanvas();
  ctx.reply('🗑 Canvas cleared!');
});

bot.command('ai', async (ctx) => {
  const description = ctx.message.text.replace('/ai', '').trim();
  if (!description) return ctx.reply('Usage: /ai anime girl with blue eyes');
  await ctx.reply('🤖 Generating drawing plan...');
  withLock(ctx, async () => {
    const commands = await generateDrawingCommands(description);
    await ctx.reply(`✅ Got ${commands.length} commands, drawing now...`);
    executeCommands(commands);
    ctx.reply('🎨 Done! Check the canvas.');
  });
});

bot.on('photo', async (ctx) => {
  await ctx.reply('📸 Analyzing image...');
  withLock(ctx, async () => {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const base64 = await getTelegramFileBase64(ctx, fileId);
    const caption = ctx.message.caption || 'Redraw this image as line art. Trace all main outlines.';
    const cmds = await runAIImage(base64, caption);
    await ctx.reply(`✅ Got ${cmds.length} strokes, drawing now...`);
    executeCommands(cmds);
    ctx.reply('🎨 Done! Check the canvas.');
  });
});

bot.on('text', (ctx) => {
  const t = ctx.message.text;
  if (t.startsWith('/')) return;
  // Ignore plain text (no more URL attachment needed)
});

bot.catch((err, ctx) => {
  console.error('Bot error:', err.message);
  ctx.reply('❌ ' + err.message);
});

// ── HTTP + WebSocket server ───────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/canvas' || req.url === '/canvas.html') {
    fs.readFile(path.join(__dirname, 'canvas.html'), (err, data) => {
      if (err) { res.writeHead(404); res.end('canvas.html not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else {
    res.writeHead(200);
    res.end('Parasite Bot 🦠');
  }
});

const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws) => {
  clients.add(ws);
  broadcast({ type: 'viewers', count: clients.size });
  // Send full state to new client
  ws.send(JSON.stringify({
    type: 'init',
    strokes,
    color: currentColor,
    size: currentSize,
    viewers: clients.size
  }));

  ws.on('message', (raw) => {
    try {
      const m = JSON.parse(raw);
      // Accept user strokes from canvas and relay to everyone
      if (m.type === 'user_stroke') {
        strokes.push({ color: m.color, size: m.size, points: m.points });
        broadcast({ type: 'stroke_end', color: m.color, size: m.size, points: m.points });
      }
    } catch {}
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcast({ type: 'viewers', count: clients.size });
  });

  ws.on('error', () => clients.delete(ws));
});

server.listen(PORT, () => console.log(`🌐 Server on :${PORT}`));

bot.launch()
  .then(() => console.log('✅ Bot started!'))
  .catch(err => console.error('❌ Bot failed:', err.message));

process.once('SIGINT', () => { bot.stop('SIGINT'); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); });
