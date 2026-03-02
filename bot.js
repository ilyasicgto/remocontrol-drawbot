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
  screenshotCanvas, getCanvasBounds, sleep,
} = require('./drawer');
const { generateDrawingCommands } = require('./ai');

// ── Init ───────────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.error('❌ BOT_TOKEN missing'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);
let browser = null;
let page = null;
let isReady = false;
let currentUrl = null;

// ── Browser launch ─────────────────────────────────────────────────────────────
async function initBrowser(url) {
  try {
    // Close existing browser if any
    if (browser) { await browser.close().catch(() => {}); browser = null; page = null; isReady = false; }

    console.log('🚀 Launching browser...');
    browser = await puppeteer.launch({
      headless: true,
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

    // Set desktop user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log(`🌐 Loading: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for canvas to appear
    await page.waitForSelector('canvas', { timeout: 30000 });
    await sleep(2000); // Let app fully initialize

    isReady = true;
    currentUrl = url;
    console.log('✅ CrocoDraw loaded & ready!');
    return { success: true };
  } catch (e) {
    console.error('❌ Browser init failed:', e.message);
    return { success: false, error: e.message };
  }
}

// ── Send canvas screenshot to Telegram ────────────────────────────────────────
async function sendPic(ctx) {
  try {
    const jpg = await screenshotCanvas(page);
    await ctx.replyWithPhoto({ source: jpg }, { caption: '🖼 Current canvas' });
  } catch (e) {
    await ctx.reply('❌ Screenshot failed: ' + e.message);
  }
}

// ── Helper: check if ready ─────────────────────────────────────────────────────
function checkReady(ctx) {
  if (!isReady) {
    ctx.reply('❌ No canvas attached.\nSend a CrocoDraw URL or use /attach <url>');
    return false;
  }
  return true;
}

// ── Parse hex color arg ────────────────────────────────────────────────────────
function parseColor(str) {
  if (!str) return null;
  return str.startsWith('#') ? str : '#' + str;
}

// ── Execute AI drawing commands ────────────────────────────────────────────────
async function executeCommands(page, commands) {
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'color':
        await setColor(page, cmd.hex);
        break;
      case 'size':
        await setBrushSize(page, cmd.px);
        break;
      case 'brush':
        await selectBrushType(page, cmd.name);
        break;
      case 'line':
        await drawLine(page, cmd.x1, cmd.y1, cmd.x2, cmd.y2);
        break;
      case 'circle':
        await drawCircle(page, cmd.cx, cmd.cy, cmd.r);
        break;
      case 'rect':
        await drawRect(page, cmd.x1, cmd.y1, cmd.x2, cmd.y2);
        break;
      case 'stroke':
        await drawFreeStroke(page, cmd.points);
        break;
      case 'fill':
        await selectFillTool(page);
        await sleep(200);
        await clickCanvas(page, cmd.x || 500, cmd.y || 500);
        await selectBrushTool(page);
        break;
      default:
        console.warn('Unknown command type:', cmd.type);
    }
    await sleep(100);
  }
}

// ── Commands ───────────────────────────────────────────────────────────────────

bot.command('start', (ctx) => {
  ctx.reply(
`🎨 *CrocoDraw Controller Bot*

Send me a CrocoDraw URL to attach, then use these commands:

*Setup:*
/attach <url> — attach to drawing session

*Drawing:*
/line x1 y1 x2 y2 — draw a line
/circle cx cy r — draw a circle
/rect x1 y1 x2 y2 — draw a rectangle
/stroke x1,y1 x2,y2 ... — free stroke

*Tools:*
/color #hex — set brush color
/size px — set brush size (e.g. /size 5)
/brush name — select brush type
/fill #hex x y — fill at position

*Actions:*
/undo — undo last stroke
/redo — redo
/clear — clear canvas
/pic — screenshot

*AI Drawing:*
/ai <description> — auto-draw from description

*Coordinates:* 0–1000 scale (500,500 = center)`,
    { parse_mode: 'Markdown' }
  );
});

// Attach via command
bot.command('attach', async (ctx) => {
  const url = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!url || !url.startsWith('http')) {
    return ctx.reply('Usage: /attach <crocodraw_url>');
  }
  const msg = await ctx.reply('⏳ Attaching to CrocoDraw...');
  const result = await initBrowser(url);
  if (result.success) {
    await ctx.reply('✅ Attached! Canvas is ready.\nUse /pic to see current state.');
  } else {
    await ctx.reply('❌ Failed: ' + result.error);
  }
});

// Auto-detect URL in message
bot.on('text', async (ctx, next) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('http') && text.includes('crocodraw')) {
    const msg = await ctx.reply('⏳ Attaching to CrocoDraw...');
    const result = await initBrowser(text);
    if (result.success) {
      await ctx.reply('✅ Attached! Canvas ready.\nUse /pic to see current state.');
    } else {
      await ctx.reply('❌ Failed: ' + result.error);
    }
    return;
  }
  return next();
});

// Screenshot
bot.command('pic', async (ctx) => {
  if (!checkReady(ctx)) return;
  await sendPic(ctx);
});

// Draw line: /line x1 y1 x2 y2
bot.command('line', async (ctx) => {
  if (!checkReady(ctx)) return;
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 4) return ctx.reply('Usage: /line x1 y1 x2 y2\nExample: /line 100 100 900 900');
  const [x1, y1, x2, y2] = args.map(Number);
  await ctx.reply('✏️ Drawing line...');
  try {
    await drawLine(page, x1, y1, x2, y2);
    await sendPic(ctx);
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

// Draw circle: /circle cx cy r
bot.command('circle', async (ctx) => {
  if (!checkReady(ctx)) return;
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 3) return ctx.reply('Usage: /circle cx cy r\nExample: /circle 500 500 200');
  const [cx, cy, r] = args.map(Number);
  await ctx.reply('⭕ Drawing circle...');
  try {
    await drawCircle(page, cx, cy, r);
    await sendPic(ctx);
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

// Draw rectangle: /rect x1 y1 x2 y2
bot.command('rect', async (ctx) => {
  if (!checkReady(ctx)) return;
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 4) return ctx.reply('Usage: /rect x1 y1 x2 y2\nExample: /rect 200 200 800 600');
  const [x1, y1, x2, y2] = args.map(Number);
  await ctx.reply('▭ Drawing rectangle...');
  try {
    await drawRect(page, x1, y1, x2, y2);
    await sendPic(ctx);
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

// Free stroke: /stroke x1,y1 x2,y2 x3,y3 ...
bot.command('stroke', async (ctx) => {
  if (!checkReady(ctx)) return;
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 2) return ctx.reply('Usage: /stroke x1,y1 x2,y2 x3,y3\nExample: /stroke 100,100 200,150 300,200');
  try {
    const points = args.map(a => {
      const [x, y] = a.split(',').map(Number);
      return { x, y };
    });
    await ctx.reply('🖊 Drawing stroke...');
    await drawFreeStroke(page, points);
    await sendPic(ctx);
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

// Set color: /color #ff0000
bot.command('color', async (ctx) => {
  if (!checkReady(ctx)) return;
  const hex = ctx.message.text.split(' ')[1];
  if (!hex) return ctx.reply('Usage: /color #hex\nExample: /color #ff0000');
  try {
    await ctx.reply('🎨 Setting color...');
    await setColor(page, parseColor(hex));
    await ctx.reply('✅ Color set to ' + parseColor(hex));
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

// Set brush size: /size 8
bot.command('size', async (ctx) => {
  if (!checkReady(ctx)) return;
  const px = ctx.message.text.split(' ')[1];
  if (!px) return ctx.reply('Usage: /size <px>\nExample: /size 8');
  try {
    await ctx.reply('📏 Setting size...');
    await setBrushSize(page, Number(px));
    await ctx.reply('✅ Brush size set to ' + px + 'px');
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

// Select brush type: /brush Marker
bot.command('brush', async (ctx) => {
  if (!checkReady(ctx)) return;
  const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!name) return ctx.reply(
    'Usage: /brush <name>\nAvailable: Marker, Pencil, Ink, Pixel Brush, Airbrush, Dry brush, Wet brush, Soft Watercolor, Quill, Dashed'
  );
  try {
    await ctx.reply('🖌 Selecting brush...');
    await selectBrushType(page, name);
    await ctx.reply('✅ Brush set to ' + name);
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

// Fill: /fill #color x y
bot.command('fill', async (ctx) => {
  if (!checkReady(ctx)) return;
  const args = ctx.message.text.split(' ').slice(1);
  const hex = args[0] ? parseColor(args[0]) : null;
  const x = args[1] ? Number(args[1]) : 500;
  const y = args[2] ? Number(args[2]) : 500;
  try {
    if (hex) await setColor(page, hex);
    await ctx.reply('🪣 Filling...');
    await selectFillTool(page);
    await sleep(300);
    await clickCanvas(page, x, y);
    await selectBrushTool(page);
    await sendPic(ctx);
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

// Undo
bot.command('undo', async (ctx) => {
  if (!checkReady(ctx)) return;
  try {
    await undo(page);
    await ctx.reply('↩️ Undone');
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

// Redo
bot.command('redo', async (ctx) => {
  if (!checkReady(ctx)) return;
  try {
    await redo(page);
    await ctx.reply('↪️ Redone');
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

// Clear canvas
bot.command('clear', async (ctx) => {
  if (!checkReady(ctx)) return;
  try {
    await ctx.reply('🗑 Clearing canvas...');
    await clearCanvas(page);
    await sendPic(ctx);
  } catch (e) { ctx.reply('❌ ' + e.message); }
});

// AI drawing: /ai draw a house
bot.command('ai', async (ctx) => {
  if (!checkReady(ctx)) return;
  const description = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!description) return ctx.reply('Usage: /ai <description>\nExample: /ai draw a cat');

  const thinking = await ctx.reply('🤖 Generating drawing plan...');
  try {
    const commands = await generateDrawingCommands(description);
    await ctx.reply(`✅ Got ${commands.length} drawing commands. Executing...`);
    await executeCommands(page, commands);
    await sendPic(ctx);
  } catch (e) {
    ctx.reply('❌ AI drawing failed: ' + e.message);
  }
});

// ── Launch ─────────────────────────────────────────────────────────────────────
// Debug — dumps DOM info to identify real selectors
bot.command('debug', async (ctx) => {
  if (!checkReady(ctx)) return;
  await ctx.reply('🔍 Scanning CrocoDraw DOM...');
  try {
    const info = await page.evaluate(() => {
      // Get all buttons with their text, classes, position
      const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
        text: b.textContent.trim().substring(0, 30),
        class: b.className.substring(0, 80),
        rect: {
          x: Math.round(b.getBoundingClientRect().x),
          y: Math.round(b.getBoundingClientRect().y),
          w: Math.round(b.getBoundingClientRect().width),
          h: Math.round(b.getBoundingClientRect().height),
        }
      })).filter(b => b.rect.w > 20);

      // Get all inputs
      const inputs = Array.from(document.querySelectorAll('input')).map(i => ({
        type: i.type,
        class: i.className.substring(0, 80),
        placeholder: i.placeholder,
        value: i.value.substring(0, 20),
        rect: {
          x: Math.round(i.getBoundingClientRect().x),
          y: Math.round(i.getBoundingClientRect().y),
          w: Math.round(i.getBoundingClientRect().width),
        }
      }));

      // Get all divs/spans with color-related classes
      const colorEls = Array.from(document.querySelectorAll('*')).filter(el => {
        const c = el.className || '';
        return typeof c === 'string' && /color|hue|picker|brush|tool|size/i.test(c) && el.getBoundingClientRect().width > 10;
      }).slice(0, 30).map(el => ({
        tag: el.tagName,
        class: el.className.substring(0, 80),
        text: el.textContent.trim().substring(0, 20),
        rect: {
          x: Math.round(el.getBoundingClientRect().x),
          y: Math.round(el.getBoundingClientRect().y),
          w: Math.round(el.getBoundingClientRect().width),
          h: Math.round(el.getBoundingClientRect().height),
        }
      }));

      return { buttons, inputs, colorEls };
    });

    // Send as file (too long for message)
    const text = JSON.stringify(info, null, 2);
    const buf = Buffer.from(text, 'utf8');
    await ctx.replyWithDocument(
      { source: buf, filename: 'dom_debug.json' },
      { caption: '📄 DOM structure — send this to dev' }
    );
  } catch (e) {
    ctx.reply('❌ Debug failed: ' + e.message);
  }
});
bot.command('debug2', async (ctx) => {
  if (!checkReady(ctx)) return;
  const screenshot = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: false });
  await ctx.replyWithPhoto({ source: screenshot }, { caption: '🖥 Full page view' });
  
  const info = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    return all.filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 5 && r.height > 5 && r.y > 600;
    }).map(el => ({
      tag: el.tagName,
      class: (el.className || '').toString().substring(0, 60),
      rect: { x: Math.round(el.getBoundingClientRect().x), y: Math.round(el.getBoundingClientRect().y), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }
    })).slice(0, 40);
  });
  
  await ctx.reply(JSON.stringify(info, null, 1).substring(0, 4000));
});
// /deepdebug command — paste into bot.js before bot.launch()

bot.command('deepdebug', async (ctx) => {
  if (!checkReady(ctx)) return;
  await ctx.reply('🔬 Starting deep UI scan — 8 steps, please wait...');

  const results = {};

  async function scanDOM(label) {
    return await page.evaluate((lbl) => {
      const getRect = el => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      const all = Array.from(document.querySelectorAll('*'));
      const visible = all.filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 3 && r.height > 3 && r.width < 1280 && r.height < 900;
      }).map(el => {
        const s = window.getComputedStyle(el);
        return {
          tag: el.tagName,
          class: (el.className || '').toString().substring(0, 80),
          text: el.textContent.trim().substring(0, 50),
          rect: getRect(el),
          cursor: s.cursor,
          bg: s.backgroundColor,
          bgImg: (s.backgroundImage || '').substring(0, 200),
          hasClick: s.cursor === 'pointer',
          isGradient: (s.backgroundImage || '').includes('gradient'),
          isInput: el.tagName === 'INPUT',
          inputType: el.tagName === 'INPUT' ? el.type : null,
          inputMin: el.tagName === 'INPUT' ? el.min : null,
          inputMax: el.tagName === 'INPUT' ? el.max : null,
          inputVal: el.tagName === 'INPUT' ? el.value : null,
        };
      });
      return {
        label: lbl,
        total: visible.length,
        clickable: visible.filter(e => e.hasClick),
        gradients: visible.filter(e => e.isGradient),
        inputs: visible.filter(e => e.isInput),
        canvases: Array.from(document.querySelectorAll('canvas')).map(c => ({
          class: (c.className||'').toString(),
          rect: getRect(c),
          w: c.width, h: c.height,
        })),
        // Everything new below y=400 (panels open here)
        panels: visible.filter(e => e.rect.y > 400 && e.rect.w > 10),
      };
    }, label);
  }

  async function step(label, action, closeAction) {
    try {
      // Reset — close anything open
      await page.keyboard.press('Escape');
      await sleep(300);

      // Do the action
      await action();
      await sleep(800);

      // Screenshot
      const shot = await page.screenshot({ type: 'jpeg', quality: 70 });
      await ctx.replyWithPhoto({ source: shot }, { caption: `📸 Step: ${label}` });

      // Scan
      const scan = await scanDOM(label);
      results[label] = scan;
      await ctx.reply(
        `✅ ${label}\n` +
        `Clickable: ${scan.clickable.length} | Gradients: ${scan.gradients.length} | Inputs: ${scan.inputs.length} | Panels: ${scan.panels.length}`
      );

      // Close
      await closeAction();
      await sleep(500);

    } catch(e) {
      await ctx.reply(`❌ Step "${label}" failed: ${e.message}`);
      await page.keyboard.press('Escape');
      await sleep(500);
    }
  }

  // ── STEP 1: Baseline (nothing open) ─────────────────────────────────────────
  await step('1_baseline',
    async () => {}, // nothing to click
    async () => {}
  );

  // ── STEP 2: Color picker ─────────────────────────────────────────────────────
  await step('2_color_picker',
    async () => await page.mouse.click(763, 709),
    async () => await page.keyboard.press('Escape')
  );

  // ── STEP 3: Brush list ───────────────────────────────────────────────────────
  await step('3_brush_list',
    async () => await page.mouse.click(517, 709),
    async () => await page.keyboard.press('Escape')
  );

  // ── STEP 4: Brush settings (open brush list, then click ⚙️ next to active brush) ──
  await step('4_brush_settings',
    async () => {
      await page.mouse.click(517, 709); // open brush list
      await sleep(600);
      // Click the ⚙️ settings icon next to the active brush (first item)
      const settingsBtn = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('*'));
        const btn = all.find(el => {
          const r = el.getBoundingClientRect();
          return el.textContent.trim() === '⚙️' ||
            ((el.className||'').toString().includes('setting') && r.y > 50 && r.y < 700);
        });
        if (btn) {
          const r = btn.getBoundingClientRect();
          return { x: r.x + r.width/2, y: r.y + r.height/2 };
        }
        return null;
      });
      if (settingsBtn) {
        await page.mouse.click(settingsBtn.x, settingsBtn.y);
      } else {
        // Fallback: try clicking area where ⚙️ would be next to first brush item
        await page.mouse.click(790, 91);
      }
    },
    async () => await page.keyboard.press('Escape')
  );

  // ── STEP 5: Size control (click+drag ns-resize element) ──────────────────────
  await step('5_size_control',
    async () => {
      // The ns-resize element is at (762, 774) — drag it up to open size panel
      await page.mouse.move(762, 774);
      await page.mouse.down();
      await sleep(200);
      await page.mouse.move(762, 700); // drag up
      await sleep(300);
      await page.mouse.up();
    },
    async () => await page.keyboard.press('Escape')
  );

  // ── STEP 6: Layers panel ─────────────────────────────────────────────────────
  await step('6_layers_panel',
    async () => await page.mouse.click(700, 774),
    async () => await page.keyboard.press('Escape')
  );

  // ── STEP 7: Clear dialog ─────────────────────────────────────────────────────
  await step('7_clear_dialog',
    async () => await page.mouse.click(639, 774),
    async () => {
      // Click CANCEL not Clear!
      const cancelled = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('*'));
        const btn = all.find(el =>
          el.textContent.trim() === 'Cancel' &&
          el.getBoundingClientRect().width > 40
        );
        if (btn) { btn.click(); return true; }
        return false;
      });
      if (!cancelled) await page.keyboard.press('Escape');
    }
  );

  // ── STEP 8: Word/game settings (⚙️ in title bar) ────────────────────────────
  await step('8_word_settings',
    async () => await page.mouse.click(640, 17), // title area with ⚙️
    async () => await page.keyboard.press('Escape')
  );

  // ── Send full JSON report ────────────────────────────────────────────────────
  await ctx.reply('📦 Sending full report...');
  const fullJson = JSON.stringify(results, null, 2);
  await ctx.replyWithDocument(
    { source: Buffer.from(fullJson, 'utf8'), filename: 'deepdebug_full.json' },
    { caption: '📊 Complete deep debug — all 8 panels scanned' }
  );

  await ctx.reply('✅ Deep debug complete! Send the JSON file to dev.');
});
// Add this to bot.js before bot.launch()
// Tests raw stroke without any color/size changes

bot.command('debugstroke', async (ctx) => {
  if (!checkReady(ctx)) return;

  // Step 1: Report canvas bounds
  const bounds = await page.evaluate(() => {
    const c = document.querySelector('canvas.main-canvas');
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  await ctx.reply(`📐 Canvas bounds: x=${bounds.x} y=${bounds.y} w=${bounds.w} h=${bounds.h}`);

  // Step 2: Draw a simple diagonal line with raw mouse events (no helper functions)
  const x1 = bounds.x + bounds.w * 0.2;
  const y1 = bounds.y + bounds.h * 0.2;
  const x2 = bounds.x + bounds.w * 0.8;
  const y2 = bounds.y + bounds.h * 0.8;

  await ctx.reply(`🖱 Moving to (${Math.round(x1)},${Math.round(y1)}) → (${Math.round(x2)},${Math.round(y2)})`);

  await page.mouse.move(x1, y1);
  await sleep(50);
  await page.mouse.down();
  await sleep(50);

  const steps = 40;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
    await sleep(20);
  }

  await page.mouse.up();
  await sleep(200);

  // Step 3: Screenshot
  const shot = await page.screenshot({ type: 'jpeg', quality: 80 });
  await ctx.replyWithPhoto({ source: shot }, { caption: '📸 After raw stroke' });
});

bot.launch();
console.log('🤖 CrocoDraw Bot started!');

// Keep-alive server for Railway
const http = require('http');
http.createServer((req, res) => res.end('CrocoDraw Bot running')).listen(process.env.PORT || 3000);

// Graceful shutdown
process.once('SIGINT', () => { bot.stop('SIGINT'); if (browser) browser.close(); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); if (browser) browser.close(); });





