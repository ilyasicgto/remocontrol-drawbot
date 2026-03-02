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
    case 'line':
      await page.evaluate((c) => {
        window.parasite.drawLine(+c.x1,+c.y1,+c.x2,+c.y2,c.color||'#000',+c.width||2);
      }, cmd); break;
    case 'circle':
      await page.evaluate((c) => {
        window.parasite.drawCircle(+c.x,+c.y,+c.r,c.color||'#000',c.fill===true||c.fill==='true');
      }, cmd); break;
    case 'path':
      await page.evaluate((c) => {
        window.parasite.drawPath(c.points,c.color||'#000',+c.width||2);
      }, cmd); break;
    case 'drag':
      await page.mouse.move(+cmd.x1, +cmd.y1);
      await page.mouse.down();
      const steps = cmd.steps || 20;
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(
          +cmd.x1 + ((+cmd.x2 - +cmd.x1) * i / steps),
          +cmd.y1 + ((+cmd.y2 - +cmd.y1) * i / steps)
        );
      }
      await page.mouse.up(); break;
    case 'click': await page.mouse.click(+cmd.x, +cmd.y); break;
    case 'eval':  await page.evaluate(new Function(cmd.code)); break;
    case 'clear':
      await page.evaluate(() => {
        const c = document.querySelector('canvas');
        c.getContext('2d').clearRect(0, 0, c.width, c.height);
      }); break;
    default: throw new Error(`Unknown command: ${cmd.type}`);
  }
  canvasDirty = true;
  broadcast({ ...cmd, _from: 'server' });
}

// ─── Fast screenshot ──────────────────────────────────────────────────────────
async function getScreenshot(forceRefresh = false) {
  if (!canvasDirty && screenshotCache && !forceRefresh) return screenshotCache;
  const canvas = await page.$('canvas');
  const png = await canvas.screenshot({ type: 'png' });
  screenshotCache = await sharp(png)
    .resize({ width: 800, withoutEnlargement: true })
    .jpeg({ quality: 70, mozjpeg: true })
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
    await page.setViewport({ width: 1200, height: 800 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait 5s for page to fully render instead of looking for specific selector
    await new Promise(r => setTimeout(r, 5000));

    await page.evaluate(() => {
      window.parasite = {
        drawLine(x1,y1,x2,y2,color='#000',width=2) {
          const ctx = document.querySelector('canvas').getContext('2d');
          ctx.strokeStyle=color; ctx.lineWidth=width; ctx.lineCap='round';
          ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
        },
        drawCircle(x,y,r,color='#000',fill=false) {
          const ctx = document.querySelector('canvas').getContext('2d');
          ctx.strokeStyle=color; ctx.fillStyle=color;
          ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
          if(fill) ctx.fill(); else ctx.stroke();
        },
        drawPath(points,color='#000',width=2) {
          if(!points?.length) return;
          const ctx = document.querySelector('canvas').getContext('2d');
          ctx.strokeStyle=color; ctx.lineWidth=width; ctx.lineCap='round'; ctx.lineJoin='round';
          ctx.beginPath(); ctx.moveTo(points[0][0],points[0][1]);
          for(let i=1;i<points.length;i++) ctx.lineTo(points[i][0],points[i][1]);
          ctx.stroke();
        }
      };
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
    model: 'claude-sonnet-4-20250514', max_tokens: 4000,
    system: `You are a drawing bot controller. Output ONLY a JSON array of drawing commands.
Types: {"type":"line","x1":n,"y1":n,"x2":n,"y2":n,"color":"#hex","width":n}
       {"type":"circle","x":n,"y":n,"r":n,"color":"#hex","fill":bool}
       {"type":"path","points":[[x,y],...],"color":"#hex","width":n}
Canvas is 1200x800. Output ONLY valid JSON array, no markdown.`,
    messages: [{ role: 'user', content: prompt }]
  });
  let commands;
  try {
    commands = JSON.parse(res.content[0].text.trim().replace(/```json|```/g,''));
  } catch { return ctx.reply('❌ Failed to parse AI response'); }
  await ctx.reply(`✅ Got ${commands.length} commands, drawing now...`);
  await page.evaluate((cmds) => {
    const c = document.querySelector('canvas');
    const ctx = c.getContext('2d');
    ctx.lineCap='round'; ctx.lineJoin='round';
    for(const cmd of cmds) {
      if(cmd.type==='line') {
        ctx.strokeStyle=cmd.color||'#000'; ctx.lineWidth=cmd.width||2;
        ctx.beginPath(); ctx.moveTo(cmd.x1,cmd.y1); ctx.lineTo(cmd.x2,cmd.y2); ctx.stroke();
      } else if(cmd.type==='circle') {
        ctx.strokeStyle=cmd.color||'#000'; ctx.fillStyle=cmd.color||'#000';
        ctx.beginPath(); ctx.arc(cmd.x,cmd.y,cmd.r,0,Math.PI*2);
        if(cmd.fill) ctx.fill(); else ctx.stroke();
      } else if(cmd.type==='path'&&cmd.points?.length) {
        ctx.strokeStyle=cmd.color||'#000'; ctx.lineWidth=cmd.width||2;
        ctx.beginPath(); ctx.moveTo(cmd.points[0][0],cmd.points[0][1]);
        for(let i=1;i<cmd.points.length;i++) ctx.lineTo(cmd.points[i][0],cmd.points[i][1]);
        ctx.stroke();
      }
    }
  }, commands);
  canvasDirty = true;
  await ctx.replyWithPhoto({ source: await getScreenshot(true) }, { caption: '🖼 Current canvas' });
}

// ─── Telegram Commands ────────────────────────────────────────────────────────
bot.command('start', (ctx) => ctx.reply(
  '🦠 *Parasite Bot* Ready!\n\n📎 Send URL to attach\n\n' +
  '*Commands:*\n`/line x1 y1 x2 y2 [#color] [width]`\n`/circle x y r [#color] [fill]`\n' +
  '`/drag x1 y1 x2 y2`\n`/ai [prompt]`\n`/pic`\n`/clear`\n`/debug`\n\n' +
  '*WS:* `ws://HOST:3000`', { parse_mode: 'Markdown' }
));

bot.command('line', async (ctx) => {
  const [x1,y1,x2,y2,color='#000000',width='2'] = ctx.message.text.split(' ').slice(1);
  if (!x2) return ctx.reply('Usage: /line 100 100 400 400 #ff0000 5');
  try {
    await handleDrawCommand({type:'line',x1,y1,x2,y2,color,width});
    ctx.replyWithPhoto({source: await getScreenshot()});
  } catch(e) { ctx.reply('❌ '+e.message); }
});

bot.command('circle', async (ctx) => {
  const [x,y,r,color='#000000',fill='false'] = ctx.message.text.split(' ').slice(1);
  if (!r) return ctx.reply('Usage: /circle 400 300 50 #3498db true');
  try {
    await handleDrawCommand({type:'circle',x,y,r,color,fill});
    ctx.replyWithPhoto({source: await getScreenshot()});
  } catch(e) { ctx.reply('❌ '+e.message); }
});

bot.command('drag', async (ctx) => {
  const [x1,y1,x2,y2,steps='20'] = ctx.message.text.split(' ').slice(1);
  if (!x2) return ctx.reply('Usage: /drag 100 100 400 400');
  try {
    await handleDrawCommand({type:'drag',x1,y1,x2,y2,steps:+steps});
    ctx.replyWithPhoto({source: await getScreenshot()});
  } catch(e) { ctx.reply('❌ '+e.message); }
});

bot.command('clear', async (ctx) => {
  try { await handleDrawCommand({type:'clear'}); ctx.reply('🗑 Cleared'); }
  catch(e) { ctx.reply('❌ '+e.message); }
});

bot.command('pic', async (ctx) => {
  if (!isReady) return ctx.reply('❌ No host attached');
  try { await ctx.replyWithPhoto({source: await getScreenshot(true)}); }
  catch(e) { ctx.reply('❌ '+e.message); }
});

bot.command('ai', async (ctx) => {
  if (!isReady) return ctx.reply('❌ No host attached');
  const prompt = ctx.message.text.replace('/ai','').trim();
  if (!prompt) return ctx.reply('Usage: /ai draw a cat');
  if (!process.env.ANTHROPIC_API_KEY) return ctx.reply('❌ ANTHROPIC_API_KEY missing');
  try { await runAIDraw(ctx, prompt); } catch(e) { ctx.reply('❌ '+e.message); }
});

bot.command('debug', async (ctx) => {
  if (!isReady) return ctx.reply('❌ No host attached');
  try {
    const title = await page.title();
    const url = page.url();
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
    const canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
    ctx.reply(`📄 Title: ${title}\n🔗 URL: ${url}\n🖼 Canvases: ${canvases}\n📝 Body:\n${bodyText}`);
  } catch(e) { ctx.reply('❌ '+e.message); }
});

// ─── Text handler LAST (so commands take priority) ────────────────────────────
bot.on('text', async (ctx) => {
  const t = ctx.message.text;
  if (t.startsWith('/')) return;
  if (t.startsWith('http')) {
    await ctx.reply('⏳ Attaching...');
    const ok = await initBrowser(t);
    return ctx.reply(ok ? '✅ Attached! Use /pic' : '❌ Failed.');
  }
});

// ─── Error handler ────────────────────────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error('Bot error:', err.message);
  ctx.reply('❌ Error: ' + err.message);
});

bot.launch()
  .then(() => console.log('✅ Telegram connected!'))
  .catch((err) => console.error('❌ Launch failed:', err.message));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
