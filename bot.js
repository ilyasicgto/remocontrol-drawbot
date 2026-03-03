const { Telegraf } = require('telegraf');
const puppeteer = require('puppeteer');
const sharp = require('sharp');
const http = require('http');
const https = require('https');
const Groq = require('groq-sdk');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.log('❌ BOT_TOKEN missing!'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

let browser = null, page = null, isReady = false;

// ─── Keep alive ───────────────────────────────────────────────────────────────
http.createServer((req, res) => res.end('Bot running')).listen(3000);

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
    await page.evaluate(() => {
      window.parasite = {
        drawLine(x1,y1,x2,y2,color='#000',width=2) {
          const ctx = document.querySelector('.main-canvas').getContext('2d');
          ctx.strokeStyle=color; ctx.lineWidth=width; ctx.lineCap='round';
          ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
        },
        drawCircle(x,y,r,color='#000',fill=false) {
          const ctx = document.querySelector('.main-canvas').getContext('2d');
          ctx.strokeStyle=color; ctx.fillStyle=color;
          ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
          if(fill) ctx.fill(); else ctx.stroke();
        },
        drawPath(points,color='#000',width=2) {
          if(!points?.length) return;
          const ctx = document.querySelector('.main-canvas').getContext('2d');
          ctx.strokeStyle=color; ctx.lineWidth=width; ctx.lineCap='round'; ctx.lineJoin='round';
          ctx.beginPath(); ctx.moveTo(points[0][0],points[0][1]);
          for(let i=1;i<points.length;i++) ctx.lineTo(points[i][0],points[i][1]);
          ctx.stroke();
        }
      };
    });
    isReady = true;
    console.log('✅ Browser ready!');
    return true;
  } catch(e) {
    console.error('❌ Browser failed:', e.message);
    return false;
  }
}

// ─── Screenshot ───────────────────────────────────────────────────────────────
async function getScreenshot() {
  const png = await page.evaluate(() => {
    const canvas = document.querySelector('.main-canvas');
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const ctx = off.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, off.width, off.height);
    ctx.drawImage(canvas, 0, 0);
    return off.toDataURL('image/png').split(',')[1];
  });
  const buf = Buffer.from(png, 'base64');
  return await sharp(buf)
    .resize({ width: 800, withoutEnlargement: true })
    .jpeg({ quality: 75, mozjpeg: true })
    .toBuffer();
}

// ─── AI Draw ──────────────────────────────────────────────────────────────────
async function runAIDraw(ctx, prompt, imageBase64 = null, mimeType = 'image/jpeg') {
  const systemPrompt = `You are a drawing bot controller. Output ONLY a JSON object with a single key "commands" containing an array of drawing commands.
Types:
- {"type":"draw_direct","x1":n,"y1":n,"x2":n,"y2":n,"color":"#hex","width":n}
- {"type":"circle","x":n,"y":n,"r":n,"color":"#hex","fill":bool,"width":n}
- {"type":"path","points":[[x,y],...],"color":"#hex","width":n}
Canvas is 1016x1200. Use maximum 60 commands. Keep it simple.
Output ONLY valid complete JSON. No markdown, no explanation.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: imageBase64
        ? [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
          ]
        : prompt
    }
  ];

  const isVision = !!imageBase64;
  const res = await groq.chat.completions.create({
    model: isVision ? 'meta-llama/llama-4-scout-17b-16e-instruct' : 'llama-3.3-70b-versatile',
    max_tokens: 8000,
    ...(isVision ? {} : { response_format: { type: 'json_object' } }),
    messages
  });

  const raw = res.choices[0].message.content.trim();
  console.log('AI response:', raw.slice(0, 300));
  const text = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(text);
  const commands = parsed.commands || parsed;

  await ctx.reply(`✅ Got ${commands.length} commands, drawing now...`);

  // ALL commands in ONE evaluate = fast
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

  const jpg = await getScreenshot();
  await ctx.replyWithPhoto({ source: jpg }, { caption: '🖼 Done!' });
}

// ─── Download Telegram file as base64 ────────────────────────────────────────
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

// ─── Telegram Commands ────────────────────────────────────────────────────────
bot.command('start', (ctx) => ctx.reply(
  '🦠 *Parasite Bot*\n\n📎 Send URL to attach\n\n' +
  '*Commands:*\n`/line x1 y1 x2 y2 [#color] [width]`\n' +
  '`/circle x y r [#color] [fill]`\n`/undo` `/redo` `/clear`\n' +
  '`/ai [prompt]` — text to drawing\n' +
  '📸 *Send a photo* — bot will redraw it!\n' +
  '`/pic`\n`/debug`',
  { parse_mode: 'Markdown' }
));

bot.command('line', async (ctx) => {
  if (!isReady) return ctx.reply('❌ No host attached');
  const [x1,y1,x2,y2,color='#000000',width='2'] = ctx.message.text.split(' ').slice(1);
  if (!x2) return ctx.reply('Usage: /line 100 100 900 900 #ff0000 5');
  try {
    await page.evaluate((c) => {
      window.parasite.drawLine(+c.x1,+c.y1,+c.x2,+c.y2,c.color,+c.width);
    }, {x1,y1,x2,y2,color,width});
    ctx.replyWithPhoto({ source: await getScreenshot() });
  } catch(e) { ctx.reply('❌ '+e.message); }
});

bot.command('circle', async (ctx) => {
  if (!isReady) return ctx.reply('❌ No host attached');
  const [x,y,r,color='#000000',fill='false'] = ctx.message.text.split(' ').slice(1);
  if (!r) return ctx.reply('Usage: /circle 400 300 50 #3498db true');
  try {
    await page.evaluate((c) => {
      window.parasite.drawCircle(+c.x,+c.y,+c.r,c.color,c.fill==='true');
    }, {x,y,r,color,fill});
    ctx.replyWithPhoto({ source: await getScreenshot() });
  } catch(e) { ctx.reply('❌ '+e.message); }
});

bot.command('clear', async (ctx) => {
  if (!isReady) return ctx.reply('❌ No host attached');
  try {
    await page.evaluate(() => {
      ['main-canvas','temp-canvas','grid-canvas'].forEach(cls => {
        const c = document.querySelector('.'+cls);
        if(c) { const ctx=c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height); ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,c.width,c.height); }
      });
    });
    ctx.reply('🗑 Cleared');
  } catch(e) { ctx.reply('❌ '+e.message); }
});

bot.command('undo', async (ctx) => {
  if (!isReady) return ctx.reply('❌ No host attached');
  try {
    await page.keyboard.down('Control');
    await page.keyboard.press('z');
    await page.keyboard.up('Control');
    ctx.reply('↩️ Undone');
  } catch(e) { ctx.reply('❌ '+e.message); }
});

bot.command('redo', async (ctx) => {
  if (!isReady) return ctx.reply('❌ No host attached');
  try {
    await page.keyboard.down('Control');
    await page.keyboard.press('y');
    await page.keyboard.up('Control');
    ctx.reply('↪️ Redone');
  } catch(e) { ctx.reply('❌ '+e.message); }
});

bot.command('pic', async (ctx) => {
  if (!isReady) return ctx.reply('❌ No host attached');
  try { ctx.replyWithPhoto({ source: await getScreenshot() }); }
  catch(e) { ctx.reply('❌ '+e.message); }
});

bot.command('ai', async (ctx) => {
  if (!isReady) return ctx.reply('❌ No host attached');
  if (!process.env.GROQ_API_KEY) return ctx.reply('❌ GROQ_API_KEY missing');
  const prompt = ctx.message.text.replace('/ai','').trim();
  if (!prompt) return ctx.reply('Usage: /ai draw a cat');
  try {
    await ctx.reply('🤖 Generating drawing plan...');
    await runAIDraw(ctx, prompt);
  } catch(e) { ctx.reply('❌ '+e.message); }
});

bot.command('debug', async (ctx) => {
  if (!isReady) return ctx.reply('❌ No host attached');
  try {
    const info = await page.evaluate(() => {
      const canvases = document.querySelectorAll('canvas');
      return Array.from(canvases).map((c,i) => ({
        index: i, class: c.className, width: c.width, height: c.height
      }));
    });
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0,300));
    ctx.reply(`📄 Title: ${title}\n🖼 Canvases: ${info.length}\n${JSON.stringify(info,null,2)}\n📝 Body:\n${bodyText}`);
  } catch(e) { ctx.reply('❌ '+e.message); }
});

// ─── Photo handler ────────────────────────────────────────────────────────────
bot.on('photo', async (ctx) => {
  if (!isReady) return ctx.reply('❌ No host attached first');
  if (!process.env.GROQ_API_KEY) return ctx.reply('❌ GROQ_API_KEY missing');
  try {
    await ctx.reply('📸 Analyzing image...');
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const base64 = await getTelegramFileBase64(ctx, fileId);
    const caption = ctx.message.caption || 'Redraw this image as line art. Trace all main outlines and important features.';
    await runAIDraw(ctx, caption, base64, 'image/jpeg');
  } catch(e) { ctx.reply('❌ '+e.message); }
});

// ─── Text handler LAST ────────────────────────────────────────────────────────
bot.on('text', async (ctx) => {
  const t = ctx.message.text;
  if (t.startsWith('/')) return;
  if (t.startsWith('http')) {
    await ctx.reply('⏳ Attaching...');
    const ok = await initBrowser(t);
    return ctx.reply(ok ? '✅ Attached! Use /pic or send a photo 📸' : '❌ Failed.');
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
