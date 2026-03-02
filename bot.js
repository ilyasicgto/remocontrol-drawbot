const { Telegraf } = require('telegraf');
const puppeteer = require('puppeteer');
const sharp = require('sharp');
const WebSocket = require('ws');
const http = require('http');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.log('❌ BOT_TOKEN missing!'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);

let browser = null, page = null, isReady = false;
let wsClients = new Set(), screenshotCache = null, canvasDirty = false;

// ─── WebSocket Server ─────────────────────────────────────────────────────────
const server = http.createServer((req, res) => res.end('Parasite Bot 🦠'));
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`🔌 WS client connected (total: ${wsClients.size})`);
  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);
      await handleDrawCommand(msg);
      ws.send(JSON.stringify({ ok: true, type: msg.type }));
    } catch (e) { ws.send(JSON.stringify({ ok: false, error: e.message })); }
  });
  ws.on('close', () => { wsClients.delete(ws); });
});

server.listen(3000, () => console.log('🌐 HTTP+WS server on :3000'));

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const ws of wsClients)
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
}

// ─── Core draw handler ────────────────────────────────────────────────────────
async function handleDrawCommand(cmd) {
  if (!isReady) throw new Error('No host attached');

  switch (cmd.type) {

    case 'draw_direct': {
      await page.evaluate((c) => {
        const canvas = document.querySelector('.main-canvas');
        const ctx = canvas.getContext('2d');
        ctx.strokeStyle = c.color || '#000';
        ctx.lineWidth = c.width || 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(+c.x1, +c.y1);
        ctx.lineTo(+c.x2, +c.y2);
        ctx.stroke();
      }, cmd);
      break;
    }

    case 'circle': {
      await page.evaluate((c) => {
        const ctx = document.querySelector('.main-canvas').getContext('2d');
        ctx.strokeStyle = c.color || '#000';
        ctx.fillStyle = c.color || '#000';
        ctx.lineWidth = +c.width || 2;
        ctx.beginPath();
        ctx.arc(+c.x, +c.y, +c.r, 0, Math.PI * 2);
        if (c.fill === true || c.fill === 'true') ctx.fill(); else ctx.stroke();
      }, cmd);
      break;
    }

    case 'path': {
      await page.evaluate((c) => {
        if (!c.points?.length) return;
        const ctx = document.querySelector('.main-canvas').getContext('2d');
        ctx.strokeStyle = c.color || '#000';
        ctx.lineWidth = +c.width || 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(c.points[0][0], c.points[0][1]);
        for (let i = 1; i < c.points.length; i++) ctx.lineTo(c.points[i][0], c.points[i][1]);
        ctx.stroke();
      }, cmd);
      break;
    }

    case 'clear': {
      await page.evaluate(() => {
        ['main-canvas', 'temp-canvas', 'grid-canvas'].forEach(cls => {
          const c = document.querySelector('.' + cls);
          if (c) {
            const ctx = c.getContext('2d');
            ctx.clearRect(0, 0, c.width, c.height);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, c.width, c.height);
          }
        });
      });
      break;
    }

    case 'undo': {
      await page.keyboard.down('Control');
      await page.keyboard.press('z');
      await page.keyboard.up('Control');
      break;
    }

    case 'redo': {
      await page.keyboard.down('Control');
      await page.keyboard.press('y');
      await page.keyboard.up('Control');
      break;
    }

    case 'drag': {
      await page.mouse.move(+cmd.x1, +cmd.y1);
      await page.mouse.down();
      const steps = cmd.steps || 20;
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(
          +cmd.x1 + ((+cmd.x2 - +cmd.x1) * i / steps),
          +cmd.y1 + ((+cmd.y2 - +cmd.y1) * i / steps)
        );
      }
      await page.mouse.up();
      break;
    }

    case 'click':
      await page.mouse.click(+cmd.x, +cmd.y);
      break;

    case 'eval':
      await page.evaluate(new Function(cmd.code));
      break;

    default:
      throw new Error(`Unknown command: ${cmd.type}`);
  }

  canvasDirty = true;
  broadcast({ ...cmd, _from: 'server' });
}

// ─── Screenshot ───────────────────────────────────────────────────────────────
async function getScreenshot(forceRefresh = false) {
  if (!canvasDirty && screenshotCache && !forceRefresh) return screenshotCache;

  // Screenshot only the main canvas element with white background
  const png = await page.evaluate(async () => {
    const canvas = document.querySelector('.main-canvas');
    const offscreen = document.createElement('canvas');
    offscreen.width = canvas.width;
    offscreen.height = canvas.height;
    const ctx = offscreen.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);
    ctx.drawImage(canvas, 0, 0);
    return offscreen.toDataURL('image/png').split(',')[1];
  });

  const buf = Buffer.from(png, 'base64');
  screenshotCache = await sharp(buf)
    .resize({ width: 800, withoutEnlargement: true })
    .jpeg({ quality: 75, mozjpeg: true })
    .toBuffer();

  canvasDirty = false;
  return screenshotCache;
}

// ─── Browser init ─────────────────────────────────────────────────────────────
async function initBrowser(url) {
  try {
    if (browser) await browser.close().catch(() => {});
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu']
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 5000));

    // Set white background on main canvas
    await page.evaluate(() => {
      const canvas = document.querySelector('.main-canvas');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    });

    isReady = true;
    canvasDirty = true;
    console.log('✅ Browser ready!');
    return true;
  } catch(e) {
    console.error('❌ Browser failed:', e.message);
    return false;
  }
}

// ─── AI Draw ──────────────────────────────────────────────────────────────────
async function runAIDraw(ctx, prompt) {
  const Anthropic = require('@anthropic-ai/sdk');
  const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  await ctx.reply('🤖 Generating drawing plan...');
  const res = await ai.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    system: `You are a drawing bot controller. Output ONLY a JSON array of drawing commands.
Types:
- {"type":"draw_direct","x1":n,"y1":n,"x2":n,"y2":n,"color":"#hex","width":n}
- {"type":"circle","x":n,"y":n,"r":n,"color":"#hex","fill":bool,"width":n}
- {"type":"path","points":[[x,y],...],"color":"#hex","width":n}
Canvas is 1016x1200. Output ONLY valid JSON array, no markdown.`,
    messages: [{ role: 'user', content: prompt }]
  });
  let commands;
  try {
    commands = JSON.parse(res.content[0].text.trim().replace(/```json|```/g, ''));
  } catch { return ctx.reply('❌ Failed to parse AI response'); }
  await ctx.reply(`✅ Got ${commands.length} commands, drawing now...`);
  await page.evaluate((cmds) => {
    const canvas = document.querySelector('.main-canvas');
    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const cmd of cmds) {
      if (cmd.type === 'draw_direct') {
        ctx.strokeStyle = cmd.color || '#000'; ctx.lineWidth = cmd.width || 2;
        ctx.beginPath(); ctx.moveTo(cmd.x1, cmd.y1); ctx.lineTo(cmd.x2, cmd.y2); ctx.stroke();
      } else if (cmd.type === 'circle') {
        ctx.strokeStyle = cmd.color || '#000'; ctx.fillStyle = cmd.color || '#000';
        ctx.lineWidth = cmd.width || 2;
        ctx.beginPath(); ctx.arc(cmd.x, cmd.y, cmd.r, 0, Math.PI * 2);
        if (cmd.fill) ctx.fill(); else ctx.stroke();
      } else if (cmd.type === 'path' && cmd.points?.length) {
        ctx.strokeStyle = cmd.color || '#000'; ctx.lineWidth = cmd.width || 2;
        ctx.beginPath(); ctx.moveTo(cmd.points[0][0], cmd.points[0][1]);
        for (let i = 1; i < cmd.points.length; i++) ctx.lineTo(cmd.points[i][0], cmd.points[i][1]);
        ctx.stroke();
      }
    }
  }, commands);
  canvasDirty = true;
  await ctx.replyWithPhoto({ source: await getScreenshot(true) }, { caption: '🖼 Done!' });
}

// ─── Telegram Commands ────────────────────────────────────────────────────────
bot.command('start', (ctx) => ctx.reply(
  '🦠 *Parasite Bot*\n\n📎 Send URL to attach\n\n' +
  '*Commands:*\n`/line x1 y1 x2 y2 [#color] [width]`\n' +
  '`/circle x y r [#color] [fill]`\n`/undo` `/redo` `/clear`\n' +
  '`/ai [prompt]`\n`/pic`\n`/debug`',
  { parse_mode: 'Markdown' }
));

bot.command('line', async (ctx) => {
  const [x1,y1,x2,y2,color='#000000',width='2'] = ctx.message.text.split(' ').slice(1);
  if (!x2) return ctx.reply('Usage: /line 100 100 900 900 #ff0000 5');
  try {
    await handleDrawCommand({ type:'draw_direct', x1, y1, x2, y2, color, width });
    await ctx.replyWithPhoto({ source: await getScreenshot() });
  } catch(e) { ctx.reply('❌ '+e.message); }
});

bot.command('circle', async (ctx) => {
  const [x,y,r,color='#000000',fill='false',width='2'] = ctx.message.text.split(' ').slice(1);
  if (!r) return ctx.reply('Usage: /circle 400 300 50 #3498db true');
  try {
    await handleDrawCommand({ type:'circle', x, y, r, color, fill, width });
    await ctx.replyWithPhoto({ source: await getScreenshot() });
  } catch(e) { ctx.reply('❌ '+e.message); }
});

bot.command('undo', async (ctx) => {
  try { await handleDrawCommand({ type:'undo' }); ctx.reply('↩️ Undone'); }
  catch(e) { ctx.reply('❌ '+e.message); }
});

bot.command('redo', async (ctx) => {
  try { await handleDrawCommand({ type:'redo' }); ctx.reply('↪️ Redone'); }
  catch(e) { ctx.reply('❌ '+e.message); }
});

bot.command('clear', async (ctx) => {
  try {
    await handleDrawCommand({ type:'clear' });
    ctx.reply('🗑 Cleared');
  } catch(e) { ctx.reply('❌ '+e.message); }
});

bot.command('pic', async (ctx) => {
  if (!isReady) return ctx.reply('❌ No host attached');
  try { await ctx.replyWithPhoto({ source: await getScreenshot(true) }); }
  catch(e) { ctx.reply('❌ '+e.message); }
});

bot.command('ai', async (ctx) => {
  if (!isReady) return ctx.reply('❌ No host attached');
  const prompt = ctx.message.text.replace('/ai', '').trim();
  if (!prompt) return ctx.reply('Usage: /ai draw a cat');
  if (!process.env.ANTHROPIC_API_KEY) return ctx.reply('❌ ANTHROPIC_API_KEY missing');
  try { await runAIDraw(ctx, prompt); } catch(e) { ctx.reply('❌ '+e.message); }
});

bot.command('debug', async (ctx) => {
  if (!isReady) return ctx.reply('❌ No host attached');
  try {
    const info = await page.evaluate(() => {
      const canvases = document.querySelectorAll('canvas');
      const buttons = document.querySelectorAll('button');
      const inputs = document.querySelectorAll('input');
      return {
        canvases: Array.from(canvases).map((c,i) => ({
          index: i, class: c.className, width: c.width, height: c.height
        })),
        buttons: Array.from(buttons).map(b => ({
          text: b.innerText.trim(),
          title: b.title,
          aria: b.getAttribute('aria-label')
        })).filter(b => b.text || b.title || b.aria),
        inputs: Array.from(inputs).map(i => ({
          type: i.type, class: i.className, value: i.value
        }))
      };
    });
    ctx.reply('🔍 Debug:\n' + JSON.stringify(info, null, 2).slice(0, 3500));
  } catch(e) { ctx.reply('❌ '+e.message); }
});

// ─── Text handler LAST ────────────────────────────────────────────────────────
bot.on('text', async (ctx) => {
  const t = ctx.message.text;
  if (t.startsWith('/')) return;
  if (t.startsWith('http')) {
    await ctx.reply('⏳ Attaching...');
    const ok = await initBrowser(t);
    return ctx.reply(ok ? '✅ Attached! Use /pic' : '❌ Failed.');
  }
});

bot.catch((err, ctx) => {
  console.error('Bot error:', err.message);
  ctx.reply('❌ Error: ' + err.message);
});

bot.launch()
  .then(() => console.log('✅ Telegram connected!'))
  .catch((err) => console.error('❌ Launch failed:', err.message));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
