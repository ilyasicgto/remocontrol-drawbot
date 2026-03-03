/**
 * drawer.js — Direct canvas injection (no mouse simulation)
 * Fast and reliable on headless servers
 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const DEBUG = process.env.DEBUG === 'true';
function log(...args) { if (DEBUG) console.log('[drawer]', ...args); }

// ── State ─────────────────────────────────────────────────────────────────────
let currentColor = '#1a1a1a';
let currentSize = 10;
let currentBrush = 'Pencil';

// ── Get canvas bounds (for screenshot) ───────────────────────────────────────
async function getCanvasBounds(page) {
  const bounds = await page.evaluate(() => {
    const c = document.querySelector('canvas.main-canvas') || document.querySelector('canvas');
    if (!c) throw new Error('main-canvas not found');
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  return bounds;
}

function toAbsolute(cx, cy, bounds) {
  return {
    x: bounds.x + (cx / 1000) * bounds.width,
    y: bounds.y + (cy / 1000) * bounds.height,
  };
}

async function focusCanvas(page) {
  await page.evaluate(() => {
    const c = document.querySelector('canvas.main-canvas') || document.querySelector('canvas');
    if (c) c.focus();
  });
  await sleep(50);
}

// ── Direct canvas drawing ─────────────────────────────────────────────────────
async function drawOnCanvas(page, fn) {
  await page.evaluate(fn);
}

async function drawLine(page, x1, y1, x2, y2) {
  log(`drawLine: (${x1},${y1}) -> (${x2},${y2})`);
  const color = currentColor;
  const size = currentSize;
  await page.evaluate((x1, y1, x2, y2, color, size) => {
    const canvas = document.querySelector('canvas.main-canvas') || document.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    // Generate intermediate points for smooth line
    const steps = Math.max(30, Math.round(Math.sqrt((x2-x1)**2 + (y2-y1)**2) / 10));
    const w = canvas.width, h = canvas.height;
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo((x1/1000)*w, (y1/1000)*h);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      ctx.lineTo(((x1 + (x2-x1)*t)/1000)*w, ((y1 + (y2-y1)*t)/1000)*h);
    }
    ctx.stroke();
  }, x1, y1, x2, y2, color, size);

  // Also fire synthetic mouse events so app registers the stroke
  await simulateStroke(page, [
    {x: x1, y: y1},
    {x: (x1+x2)/2, y: (y1+y2)/2},
    {x: x2, y: y2}
  ]);
}

async function drawCircle(page, cx, cy, r) {
  log(`drawCircle: (${cx},${cy}) r=${r}`);
  const color = currentColor;
  const size = currentSize;
  await page.evaluate((cx, cy, r, color, size) => {
    const canvas = document.querySelector('canvas.main-canvas') || document.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc((cx/1000)*w, (cy/1000)*h, (r/1000)*Math.min(w,h), 0, Math.PI * 2);
    ctx.stroke();
  }, cx, cy, r, color, size);

  const points = [];
  for (let i = 0; i <= 20; i++) {
    const a = (i/20) * Math.PI * 2;
    points.push({ x: cx + Math.cos(a)*r, y: cy + Math.sin(a)*r });
  }
  await simulateStroke(page, points);
}

async function drawRect(page, x1, y1, x2, y2) {
  log(`drawRect: (${x1},${y1}) -> (${x2},${y2})`);
  const color = currentColor;
  const size = currentSize;
  await page.evaluate((x1, y1, x2, y2, color, size) => {
    const canvas = document.querySelector('canvas.main-canvas') || document.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.strokeRect((x1/1000)*w, (y1/1000)*h, ((x2-x1)/1000)*w, ((y2-y1)/1000)*h);
  }, x1, y1, x2, y2, color, size);
}

async function drawFreeStroke(page, points) {
  log(`drawFreeStroke: ${points.length} points`);
  if (!points.length) return;
  const color = currentColor;
  const size = currentSize;
  await page.evaluate((pts, color, size) => {
    const canvas = document.querySelector('canvas.main-canvas') || document.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo((pts[0].x/1000)*w, (pts[0].y/1000)*h);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo((pts[i].x/1000)*w, (pts[i].y/1000)*h);
    }
    ctx.stroke();
  }, points, color, size);
}

// ── Simulate mouse stroke so app registers it ─────────────────────────────────
async function simulateStroke(page, points) {
  try {
    const bounds = await getCanvasBounds(page);
    const abs = points.map(p => toAbsolute(p.x, p.y, bounds));
    await page.mouse.move(abs[0].x, abs[0].y);
    await page.mouse.down();
    for (let i = 1; i < abs.length; i++) {
      await page.mouse.move(abs[i].x, abs[i].y, { steps: 3 });
      await sleep(5);
    }
    await page.mouse.up();
  } catch(e) {
    log('simulateStroke failed (ok):', e.message);
  }
}

// ── Color ─────────────────────────────────────────────────────────────────────
async function setColor(page, hex) {
  if (!hex.startsWith('#')) hex = '#' + hex;
  currentColor = hex;
  log(`setColor: ${hex}`);
  // Try to set color in the app UI
  try {
    await page.evaluate((hex) => {
      // Try to find and set color input
      const inputs = document.querySelectorAll('input');
      for (const input of inputs) {
        if (input.type === 'color') {
          input.value = hex;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }, hex);
  } catch(e) { log('setColor UI failed (ok):', e.message); }
}

// ── Brush size ────────────────────────────────────────────────────────────────
async function setBrushSize(page, targetSize) {
  const size = Math.max(1, Math.min(100, Math.round(targetSize)));
  currentSize = size;
  log(`setBrushSize: ${size}`);

  // Try Z/X keys
  try {
    await page.bringToFront();
    await focusCanvas(page);
    const currentSizeFromUI = await page.evaluate(() => {
      const el = document.querySelector('.brush-info');
      if (!el) return 10;
      const match = el.textContent.match(/(\d+)px/);
      return match ? parseInt(match[1]) : 10;
    });
    const diff = size - currentSizeFromUI;
    if (diff !== 0) {
      const key = diff > 0 ? 'z' : 'x';
      for (let i = 0; i < Math.abs(diff); i++) {
        await page.keyboard.press(key);
        await sleep(20);
      }
    }
  } catch(e) { log('setBrushSize keys failed (ok):', e.message); }
}

// ── Brush type ────────────────────────────────────────────────────────────────
async function selectBrushType(page, brushName) {
  currentBrush = brushName;
  log(`selectBrushType: ${brushName}`);
  try {
    await page.mouse.click(517, 709);
    await sleep(500);
    const clicked = await page.evaluate((name) => {
      const labels = Array.from(document.querySelectorAll('.brush-label'));
      const match = labels.find(el => el.textContent.trim().toLowerCase().includes(name.toLowerCase()));
      if (match) { match.click(); return true; }
      return false;
    }, brushName);
    await sleep(200);
    await page.keyboard.press('Escape');
    await sleep(200);
    return clicked;
  } catch(e) { log('selectBrushType failed (ok):', e.message); return false; }
}

async function selectBrushTool(page) {
  try {
    await page.mouse.click(517, 709);
    await sleep(200);
    await page.keyboard.press('Escape');
    await sleep(200);
  } catch(e) {}
}

async function selectFillTool(page) {
  try {
    await page.mouse.click(640, 709);
    await sleep(200);
  } catch(e) {}
}

// ── Undo / Redo ───────────────────────────────────────────────────────────────
async function undo(page) {
  await focusCanvas(page);
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await sleep(200);
}

async function redo(page) {
  await focusCanvas(page);
  await page.keyboard.down('Control');
  await page.keyboard.press('y');
  await page.keyboard.up('Control');
  await sleep(200);
}

// ── Clear ─────────────────────────────────────────────────────────────────────
async function clearCanvas(page) {
  log('clearCanvas');
  // Direct clear via canvas API
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
  // Also try UI clear button
  try {
    await page.mouse.click(639, 774);
    await sleep(600);
    await page.evaluate(() => {
      const btn = document.querySelector('button.destructive-button');
      if (btn) btn.click();
    });
    await sleep(400);
  } catch(e) {}
}

// ── Screenshot ────────────────────────────────────────────────────────────────
async function screenshotCanvas(page) {
  const bounds = await page.evaluate(() => {
    const c = document.querySelector('canvas.main-canvas') || document.querySelector('canvas');
    if (!c) throw new Error('main-canvas not found');
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  });
  return await page.screenshot({
    type: 'jpeg',
    quality: 85,
    clip: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  });
}

async function clickCanvas(page, x, y) {
  const bounds = await getCanvasBounds(page);
  const abs = toAbsolute(x, y, bounds);
  await page.mouse.click(abs.x, abs.y);
  await sleep(50);
}

module.exports = {
  drawLine, drawCircle, drawRect, drawFreeStroke, clickCanvas,
  selectBrushTool, selectFillTool, selectBrushType,
  setColor, setBrushSize, undo, redo, clearCanvas,
  screenshotCanvas, getCanvasBounds, sleep, focusCanvas,
};
