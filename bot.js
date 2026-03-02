/**
 * bot.js — CrocoDraw Controller Bot
 * Controls CrocoDraw canvas via Puppeteer mouse simulation
 */

const { Telegraf } = require('telegraf');
const puppeteer = require('puppeteer');
const {
  drawLine, drawCircle, drawRect, drawFreeStroke, clickCanvas,
  selectBrushTool, selectFillTool, selectBrushType,
  setColor, setBrushSize, undo, redo, clearCanvas,
  screenshotCanvas, getCanvasBounds, sleep, focusCanvas,
} = require('./drawer');
const { generateDrawingCommands } = require('./ai');

// ── Init ───────────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.error('❌ BOT_TOKEN missing'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);
let browser = null;
let page = null;
let isReady = false;

// ── Browser launch ─────────────────────────────────────────────────────────────
async function initBrowser(url) {
  try {
    if (browser) { await browser.close().catch(() => {}); browser = null; page = null; isReady = false; }

    console.log('🚀 Launching browser...');
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,900',
      ],
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log(`🌐 Loading: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('canvas.main-canvas', { timeout: 30000 });
    await sleep(2000);

    isReady = true;
    console.log('✅ CrocoDraw loaded & ready!');
    return { success: true };
  } catch (e) {
    console.error('❌ Browser init failed:', e.message);
    return { success: false, error: e.message };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function checkReady(ctx) {
  if (!isReady) {
    ctx.reply('❌ No canvas attached.\nSend a CrocoDraw URL or use /attach <url>');
    return false;
  }
  return true;
}

function parseColor(str) {
  if (!str) return null;
  return str.startsWith('#') ? str : '#' + str;
}

async function sendPic(ctx) {
  try {
    const jpg = await screenshotCanvas(page);
    await ctx.replyWithPhoto({ source: jpg }, { caption: '🖼 Current canvas' });
  } catch (e) {
    await ctx.reply('❌ Screenshot failed: ' + e.message);
  }
}

// ── Execute AI commands ────────────────────────────────────────────────────────
async function executeCommands(page, commands) {
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'color':  await setColor(page, cmd.hex); break;
      case 'size':   await setBrushSize(page, cmd.px); break;
      case 'brush':  await selectBrushType(page, cmd.name); break;
      case 'line':   await drawLine(page, cmd.x1, cmd.y1, cmd.x2, cmd.y2); break;
      case 'circle': await drawCircle(page, cmd.cx, cmd.cy, cmd.r); break;
      case 'rect':   await drawRect(page, cmd.x1, cmd.y1, cmd.x2, cmd.y2); break;
      case 'stroke': await drawFreeStroke(page, cmd.points); break;
      case 'fill':
        await selectFillTool(page);
        await sleep(200);
        await clickCanvas(page, cmd.x || 500, cmd.y || 500);
        await selectBrushTool(page);
        break;
      default: console.warn('Unknown command type:', cmd.type);
    }
    await sleep(50);
  }
}

// ── Commands ───────────────────────────────────────────────────────────────────

bot.command('start', (ctx) => {
  ctx.reply(
`🎨 *CrocoDraw Controller Bot*

*Setup:*
/attach <url> — attach to drawing session

*Drawing:*
/line x1 y1 x2 y2
/circle cx cy r
/rect x1 y1 x2 y2
/stroke x1,y1 x2,y2 ...

*Tools:*
/color #hex
/size px
/brush name

*Actions:*
/undo — undo last stroke
/redo — redo
/clear — clear canvas
/pic — screenshot

*AI Drawing:*
/ai <description>

*Debug:*
/debugstroke — test raw stroke
/deepdebug — full UI scan

*Coordinates:* 0–1000 scale (500,500 = center)`,
    { parse_mode: 'Markdown' }
  );
});

// Attach via command
bot.command('attach', async (ctx) => {
  const url = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!url || !url.startsWith('http')) return ctx.reply('Usage: /attach <crocodraw_url>');
  await ctx.reply('⏳ Attaching to CrocoDraw...');
  const result = await initBrowser(url);
  await ctx.reply(result.success ? '✅ Attached! Use /pic to see canvas.' : '❌ Failed: ' + result.error);
});

// Auto-detect URL
bot.on('text', async (ctx, next) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('http') && text.includes('crocodraw')) {
    await ctx.reply('⏳ Attaching to CrocoDraw...');
    const result = await initBrowser(text);
    await ctx.reply(result.success ? '✅ Attached! Use /pic to see canvas.' : '❌ Failed: ' + result.error);
    return;
  }
  return next();
});

// Screenshot
bot.command('pic', async (ctx) => {
  if (!checkReady(ctx)) return;
  await sendPic(ctx);
});

// BUG6 FIX: all drawing commands — complete drawing THEN reply, never mid-stroke
bot.command('line', async (ctx) => {
  if (!checkReady(ctx)) return;
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 4) return ctx.reply('Usage: /line x1 y1 x2 y2\nExample: /line 100 100 900 900');
  const [x1, y1, x2, y2] = args.map(Number);
  await ctx.reply('⏳ Drawing line...');
  try {
    await drawLine(page, x1, y1, x2, y2);
    await sendPic(ctx);
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

bot.command('circle', async (ctx) => {
  if (!checkReady(ctx)) return;
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 3) return ctx.reply('Usage: /circle cx cy r\nExample: /circle 500 500 300');
  const [cx, cy, r] = args.map(Number);
  await ctx.reply('⏳ Drawing circle...');
  try {
    await drawCircle(page, cx, cy, r);
    await sendPic(ctx);
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

bot.command('rect', async (ctx) => {
  if (!checkReady(ctx)) return;
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 4) return ctx.reply('Usage: /rect x1 y1 x2 y2\nExample: /rect 200 200 800 600');
  const [x1, y1, x2, y2] = args.map(Number);
  await ctx.reply('⏳ Drawing rectangle...');
  try {
    await drawRect(page, x1, y1, x2, y2);
    await sendPic(ctx);
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

bot.command('stroke', async (ctx) => {
  if (!checkReady(ctx)) return;
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 2) return ctx.reply('Usage: /stroke x1,y1 x2,y2 x3,y3');
  try {
    const points = args.map(a => {
      const [x, y] = a.split(',').map(Number);
      return { x, y };
    });
    await drawFreeStroke(page, points);
    await sendPic(ctx);
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

bot.command('color', async (ctx) => {
  if (!checkReady(ctx)) return;
  const hex = ctx.message.text.split(' ')[1];
  if (!hex) return ctx.reply('Usage: /color #hex\nExample: /color #ff0000');
  try {
    await setColor(page, parseColor(hex));
    await ctx.reply('✅ Color set to ' + parseColor(hex));
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

bot.command('size', async (ctx) => {
  if (!checkReady(ctx)) return;
  const px = ctx.message.text.split(' ')[1];
  if (!px) return ctx.reply('Usage: /size <px>\nExample: /size 20');
  try {
    await setBrushSize(page, Number(px));
    await ctx.reply('✅ Brush size set to ' + px + 'px');
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

bot.command('brush', async (ctx) => {
  if (!checkReady(ctx)) return;
  const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!name) return ctx.reply(
    'Usage: /brush <name>\nAvailable: Flowing Watercolor, Flat brush, Quill, Ink, Pencil, Watercolor (texture), Rembrandt'
  );
  try {
    await selectBrushType(page, name);
    await ctx.reply('✅ Brush set to ' + name);
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

bot.command('fill', async (ctx) => {
  if (!checkReady(ctx)) return;
  const args = ctx.message.text.split(' ').slice(1);
  const hex = args[0] ? parseColor(args[0]) : null;
  const x = args[1] ? Number(args[1]) : 500;
  const y = args[2] ? Number(args[2]) : 500;
  try {
    if (hex) await setColor(page, hex);
    await selectFillTool(page);
    await sleep(300);
    await clickCanvas(page, x, y);
    await selectBrushTool(page);
    await sendPic(ctx);
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

bot.command('undo', async (ctx) => {
  if (!checkReady(ctx)) return;
  try { await undo(page); await ctx.reply('↩️ Undone'); }
  catch (e) { ctx.reply('❌ ' + e.message); }
});

bot.command('redo', async (ctx) => {
  if (!checkReady(ctx)) return;
  try { await redo(page); await ctx.reply('↪️ Redone'); }
  catch (e) { ctx.reply('❌ ' + e.message); }
});

bot.command('clear', async (ctx) => {
  if (!checkReady(ctx)) return;
  try {
    await clearCanvas(page);
    await sendPic(ctx);
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

bot.command('ai', async (ctx) => {
  if (!checkReady(ctx)) return;
  const description = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!description) return ctx.reply('Usage: /ai <description>\nExample: /ai anime girl with blue eyes');
  await ctx.reply('🤖 Generating drawing plan...');
  // Run async so bot stays responsive
  (async () => {
    try {
      const commands = await generateDrawingCommands(description);
      await ctx.reply(`✅ Got ${commands.length} commands, drawing now...`);
      await executeCommands(page, commands);
      await sendPic(ctx);
    } catch (e) { ctx.reply('❌ AI drawing failed: ' + e.message); }
  })();
});

// ── Debug: raw stroke test ─────────────────────────────────────────────────────
bot.command('debugstroke', async (ctx) => {
  if (!checkReady(ctx)) return;

  // Check canvas state BEFORE anything
  const before = await page.evaluate(() => {
    const c = document.querySelector('canvas.main-canvas');
    const r = c.getBoundingClientRect();
    const openPanels = Array.from(document.querySelectorAll('*')).filter(el => {
      const rect = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return rect.width > 150 && rect.height > 100 && rect.y > 400 && rect.y < 720
        && s.display !== 'none' && s.visibility !== 'hidden'
        && (el.className||'').toString().includes('-');
    }).map(el => (el.className||'').toString().substring(0,40));
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), panels: [...new Set(openPanels)] };
  });

  // Draw first — NO replies until drawing is complete (BUG6 FIX)
  await page.mouse.click(517, 709); // brush
  await sleep(200);
  await page.keyboard.press('Escape'); // close panel
  await sleep(200);
  await page.evaluate(() => document.querySelector('canvas.main-canvas').focus());
  await sleep(100);

  // Read bounds AFTER everything closed
  const bounds = await getCanvasBounds(page);
  const x1 = bounds.x + bounds.width * 0.2;
  const y1 = bounds.y + bounds.height * 0.2;
  const x2 = bounds.x + bounds.width * 0.8;
  const y2 = bounds.y + bounds.height * 0.8;

  await page.mouse.move(x1, y1);
  await sleep(50);
  await page.mouse.down();
  await sleep(50);
  for (let i = 1; i <= 40; i++) {
    const t = i / 40;
    await page.mouse.move(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
    await sleep(15);
  }
  await page.mouse.up();
  await sleep(300);

  // NOW take screenshot and reply
  const shot = await screenshotCanvas(page);
  await ctx.replyWithPhoto({ source: shot }, {
    caption:
      `📐 Canvas: x=${before.x} y=${before.y} w=${before.w} h=${before.h}\n` +
      `🗂 Open panels: ${before.panels.length > 0 ? before.panels.join(', ') : 'none'}\n` +
      `🖱 Stroke: (${Math.round(x1)},${Math.round(y1)})→(${Math.round(x2)},${Math.round(y2)})`
  });
});

// ── Deep debug ─────────────────────────────────────────────────────────────────
bot.command('deepdebug', async (ctx) => {
  if (!checkReady(ctx)) return;
  await ctx.reply('🔬 Starting deep UI scan — 8 steps...');
  const results = {};

  async function scanDOM(label) {
    return await page.evaluate((lbl) => {
      const getRect = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
      const all = Array.from(document.querySelectorAll('*'));
      const visible = all.filter(el => { const r = el.getBoundingClientRect(); return r.width > 3 && r.height > 3 && r.width < 1280 && r.height < 900; }).map(el => {
        const s = window.getComputedStyle(el);
        return { tag: el.tagName, class: (el.className||'').toString().substring(0,80), text: el.textContent.trim().substring(0,50), rect: getRect(el), cursor: s.cursor, bgImg: (s.backgroundImage||'').substring(0,200), isInput: el.tagName==='INPUT', inputType: el.tagName==='INPUT'?el.type:null, inputMin: el.tagName==='INPUT'?el.min:null, inputMax: el.tagName==='INPUT'?el.max:null, inputVal: el.tagName==='INPUT'?el.value:null };
      });
      return { label: lbl, total: visible.length, clickable: visible.filter(e=>e.cursor==='pointer'), gradients: visible.filter(e=>e.bgImg&&e.bgImg!=='none'&&e.bgImg.includes('gradient')), inputs: visible.filter(e=>e.isInput), panels: visible.filter(e=>e.rect.y>400&&e.rect.w>10), canvases: Array.from(document.querySelectorAll('canvas')).map(c=>({class:(c.className||'').toString(),rect:getRect(c),w:c.width,h:c.height})) };
    }, label);
  }

  async function step(label, action, closeAction) {
    try {
      await page.keyboard.press('Escape'); await sleep(300);
      await action(); await sleep(800);
      const shot = await page.screenshot({ type: 'jpeg', quality: 70 });
      await ctx.replyWithPhoto({ source: shot }, { caption: `📸 ${label}` });
      const scan = await scanDOM(label);
      results[label] = scan;
      await ctx.reply(`✅ ${label}\nClickable: ${scan.clickable.length} | Gradients: ${scan.gradients.length} | Inputs: ${scan.inputs.length}`);
      await closeAction(); await sleep(500);
    } catch(e) {
      await ctx.reply(`❌ "${label}": ${e.message}`);
      await page.keyboard.press('Escape'); await sleep(500);
    }
  }

  await step('1_baseline', async()=>{}, async()=>{});
  await step('2_color_picker', async()=>await page.mouse.click(763,709), async()=>await page.keyboard.press('Escape'));
  await step('3_brush_list', async()=>await page.mouse.click(517,709), async()=>await page.keyboard.press('Escape'));
  await step('4_layers', async()=>await page.mouse.click(700,774), async()=>await page.keyboard.press('Escape'));
  await step('5_clear_dialog', async()=>await page.mouse.click(639,774), async()=>{
    const cancelled = await page.evaluate(()=>{ const btn=document.querySelector('button.cancel-button'); if(btn){btn.click();return true;}return false; });
    if(!cancelled) await page.keyboard.press('Escape');
  });
  await step('6_word_settings', async()=>await page.mouse.click(640,17), async()=>await page.keyboard.press('Escape'));

  const fullJson = JSON.stringify(results, null, 2);
  await ctx.replyWithDocument({ source: Buffer.from(fullJson,'utf8'), filename:'deepdebug_full.json' }, { caption: '📊 Complete deep debug' });
  await ctx.reply('✅ Deep debug complete!');
});

// ── Launch ─────────────────────────────────────────────────────────────────────
bot.launch();
console.log('🤖 CrocoDraw Bot started!');

const http = require('http');
http.createServer((req, res) => res.end('CrocoDraw Bot running')).listen(process.env.PORT || 3000);

process.once('SIGINT', () => { bot.stop('SIGINT'); if (browser) browser.close(); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); if (browser) browser.close(); });
