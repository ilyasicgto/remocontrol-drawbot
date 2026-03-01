const { Telegraf } = require('telegraf');
const puppeteer = require('puppeteer');
const sharp = require('sharp');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.log('❌ BOT_TOKEN missing!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
let browser = null;
let page = null;
let isReady = false;

async function initBrowser(url) {
  try {
    console.log('🚀 Starting browser...');
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    
    console.log('🌐 Loading page...');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('.main-canvas', { timeout: 30000 });
    
    // Inject drawing API
    await page.evaluate(() => {
      window.parasite = {
        drawLine(x1, y1, x2, y2, color = '#000', width = 2) {
          const c = document.querySelector('.main-canvas');
          const ctx = c.getContext('2d');
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        },
        drawCircle(x, y, r, color = '#000', fill = false) {
          const c = document.querySelector('.main-canvas');
          const ctx = c.getContext('2d');
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          if (fill) ctx.fill();
          ctx.stroke();
        }
      };
    });

    isReady = true;
    console.log('✅ Browser ready!');
    return true;
  } catch (e) {
    console.error('❌ Browser failed:', e.message);
    return false;
  }
}

// Commands
bot.command('start', (ctx) => {
  ctx.reply('🦠 Parasite Bot Ready!\n\nSend me a doodlegator URL to attach.');
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  
  if (text.startsWith('http')) {
    ctx.reply('⏳ Attaching to host...');
    const success = await initBrowser(text);
    
    if (success) {
      ctx.reply('✅ Attached! Commands:\n/line x1 y1 x2 y2 color width\n/circle x y r color fill\n/pic');
    } else {
      ctx.reply('❌ Failed to attach.');
    }
    return;
  }
});

bot.command('line', async (ctx) => {
  if (!isReady) return ctx.reply('❌ No host attached');
  
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 4) return ctx.reply('Usage: /line 100 100 400 400 #ff0000 5');
  
  const [x1, y1, x2, y2, color = '#000', width = 2] = args;
  
  try {
    await page.evaluate((a) => {
      window.parasite.drawLine(+a.x1, +a.y1, +a.x2, +a.y2, a.color, +a.width);
    }, {x1, y1, x2, y2, color, width});
    
    const canvas = await page.$('.main-canvas');
    const png = await canvas.screenshot();
    const jpg = await sharp(png).jpeg({ quality: 85 }).toBuffer();
    await ctx.replyWithPhoto({ source: jpg });
  } catch (e) {
    ctx.reply('❌ Error: ' + e.message);
  }
});

bot.command('circle', async (ctx) => {
  if (!isReady) return ctx.reply('❌ No host attached');
  
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 3) return ctx.reply('Usage: /circle 400 300 50 #3498db true');
  
  const [x, y, r, color = '#000', fill = 'false'] = args;
  
  try {
    await page.evaluate((a) => {
      window.parasite.drawCircle(+a.x, +a.y, +a.r, a.color, a.fill === 'true');
    }, {x, y, r, color, fill});
    
    const canvas = await page.$('.main-canvas');
    const png = await canvas.screenshot();
    const jpg = await sharp(png).jpeg({ quality: 85 }).toBuffer();
    await ctx.replyWithPhoto({ source: jpg });
  } catch (e) {
    ctx.reply('❌ Error: ' + e.message);
  }
});

bot.command('pic', async (ctx) => {
  if (!isReady) return ctx.reply('❌ No host attached');
  
  try {
    const canvas = await page.$('.main-canvas');
    const png = await canvas.screenshot();
    const jpg = await sharp(png).jpeg({ quality: 85 }).toBuffer();
    await ctx.replyWithPhoto({ source: jpg });
  } catch (e) {
    ctx.reply('❌ Error: ' + e.message);
  }
});

bot.launch();
console.log('🤖 Bot started!');

// Keep alive
const http = require('http');
http.createServer((req, res) => {
  res.end('Bot running');
}).listen(3000);
