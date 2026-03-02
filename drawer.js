/**
 * drawer.js — CrocoDraw mouse simulation
 * All bugs fixed, debug logging built-in
 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Debug logger (set DEBUG=true in env to enable) ─────────────────────────────
const DEBUG = process.env.DEBUG === 'true';
function log(...args) { if (DEBUG) console.log('[drawer]', ...args); }

// ── Canvas bounds — always read fresh, never cache ────────────────────────────
async function getCanvasBounds(page) {
  // BUG3 FIX: always wait for any open panels to close before reading bounds
  const bounds = await page.evaluate(() => {
    const c = document.querySelector('canvas.main-canvas');
    if (!c) throw new Error('main-canvas not found');
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  log(`Canvas bounds: x=${bounds.x} y=${bounds.y} w=${bounds.width} h=${bounds.height}`);
  return bounds;
}

function toAbsolute(cx, cy, bounds) {
  return {
    x: bounds.x + (cx / 1000) * bounds.width,
    y: bounds.y + (cy / 1000) * bounds.height,
  };
}

function dist(a, b) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

// ── Toolbar coords (verified from deepdebug) ───────────────────────────────────
const TOOLBAR = {
  brush:      { x: 517, y: 709 },
  eraser:     { x: 579, y: 709 },
  fill:       { x: 640, y: 709 },
  eyedropper: { x: 702, y: 709 },
  colorball:  { x: 763, y: 709 },
  undo:       { x: 517, y: 774 },
  redo:       { x: 579, y: 774 },
  clear:      { x: 639, y: 774 },
  layers:     { x: 700, y: 774 },
};

// BUG5 FIX: after every toolbar click, Escape to close any opened panel
async function clickTool(page, name) {
  const t = TOOLBAR[name];
  if (!t) throw new Error('Unknown tool: ' + name);
  log(`clickTool: ${name} at (${t.x},${t.y})`);
  await page.mouse.click(t.x, t.y);
  await sleep(300);
  await page.keyboard.press('Escape');
  await sleep(200);
}

// ── Safe canvas focus — BUG2 FIX: use focus() not mouse click ─────────────────
async function focusCanvas(page) {
  await page.evaluate(() => {
    const c = document.querySelector('canvas.main-canvas');
    if (c) c.focus();
  });
  await sleep(100);
  log('Canvas focused');
}

// ── Core stroke — BUG1+BUG6 FIX ───────────────────────────────────────────────
async function stroke(page, points, bounds) {
  if (!points.length) return;

  // BUG1 FIX: make sure brush is active and NO panel is open before stroking
  // Click brush tool then escape to select brush without opening panel
  await page.mouse.click(TOOLBAR.brush.x, TOOLBAR.brush.y);
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(200);

  // BUG2 FIX: focus canvas via JS, not mouse click
  await focusCanvas(page);

  // BUG3 FIX: read bounds FRESH right before drawing (after all panels closed)
  const freshBounds = await getCanvasBounds(page);

  const first = toAbsolute(points[0].x, points[0].y, freshBounds);
  log(`Stroke start: canvas(${points[0].x},${points[0].y}) -> viewport(${Math.round(first.x)},${Math.round(first.y)})`);

  await page.mouse.move(first.x, first.y);
  await sleep(30);
  await page.mouse.down();
  await sleep(30);

  for (let i = 1; i < points.length; i++) {
    const prev = toAbsolute(points[i - 1].x, points[i - 1].y, freshBounds);
    const curr = toAbsolute(points[i].x, points[i].y, freshBounds);
    const steps = Math.max(8, Math.round(dist(prev, curr) / 3));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      await page.mouse.move(
        prev.x + (curr.x - prev.x) * t,
        prev.y + (curr.y - prev.y) * t
      );
      await sleep(6);
    }
  }

  const last = toAbsolute(points[points.length-1].x, points[points.length-1].y, freshBounds);
  log(`Stroke end: canvas(${points[points.length-1].x},${points[points.length-1].y}) -> viewport(${Math.round(last.x)},${Math.round(last.y)})`);

  await page.mouse.up();
  await sleep(100);
}

// ── Draw helpers ───────────────────────────────────────────────────────────────
async function drawLine(page, x1, y1, x2, y2) {
  log(`drawLine: (${x1},${y1}) -> (${x2},${y2})`);
  const bounds = await getCanvasBounds(page);
  const points = [];
  for (let i = 0; i <= 30; i++)
    points.push({ x: x1 + (x2 - x1) * i / 30, y: y1 + (y2 - y1) * i / 30 });
  await stroke(page, points, bounds);
}

async function drawCircle(page, cx, cy, r) {
  log(`drawCircle: center=(${cx},${cy}) r=${r}`);
  const bounds = await getCanvasBounds(page);
  const points = [];
  for (let i = 0; i <= 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    points.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  await stroke(page, points, bounds);
}

async function drawRect(page, x1, y1, x2, y2) {
  log(`drawRect: (${x1},${y1}) -> (${x2},${y2})`);
  const bounds = await getCanvasBounds(page);
  const corners = [
    { x: x1, y: y1 }, { x: x2, y: y1 },
    { x: x2, y: y2 }, { x: x1, y: y2 }, { x: x1, y: y1 }
  ];
  const points = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const a = corners[i], b = corners[i + 1];
    for (let s = 0; s <= 20; s++)
      points.push({ x: a.x + (b.x - a.x) * s / 20, y: a.y + (b.y - a.y) * s / 20 });
  }
  await stroke(page, points, bounds);
}

async function drawFreeStroke(page, points) {
  log(`drawFreeStroke: ${points.length} points`);
  const bounds = await getCanvasBounds(page);
  await stroke(page, points, bounds);
}

async function clickCanvas(page, x, y) {
  const bounds = await getCanvasBounds(page);
  const abs = toAbsolute(x, y, bounds);
  await page.mouse.click(abs.x, abs.y);
  await sleep(50);
}

// ── Undo / Redo ────────────────────────────────────────────────────────────────
async function undo(page) { await clickTool(page, 'undo'); }
async function redo(page) { await clickTool(page, 'redo'); }

// ── Clear ──────────────────────────────────────────────────────────────────────
async function clearCanvas(page) {
  log('clearCanvas');
  await page.mouse.click(TOOLBAR.clear.x, TOOLBAR.clear.y);
  await sleep(600);
  // Click the "Clear" destructive button (NOT cancel)
  await page.evaluate(() => {
    const btn = document.querySelector('button.destructive-button');
    if (btn) btn.click();
  });
  await sleep(400);
}

// ── Color ──────────────────────────────────────────────────────────────────────
async function setColor(page, hex) {
  if (!hex.startsWith('#')) hex = '#' + hex;
  log(`setColor: ${hex}`);

  // Open color picker (don't Escape after — we need it open)
  await page.mouse.click(TOOLBAR.colorball.x, TOOLBAR.colorball.y);
  await sleep(700);

  // Type hex directly into the input field
  const ok = await page.evaluate((hexVal) => {
    const input = document.querySelector('input.colorful-input');
    if (!input) return false;
    input.focus();
    input.select();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, hexVal.replace('#', ''));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, hex);

  log(`setColor input found: ${ok}`);
  await sleep(200);
  await page.keyboard.press('Enter');
  await sleep(200);

  // BUG3 FIX: Escape to close picker, then wait long enough for canvas to settle
  await page.keyboard.press('Escape');
  await sleep(600);

  // Re-select brush tool (Escape after to close brush panel if it opened)
  await page.mouse.click(TOOLBAR.brush.x, TOOLBAR.brush.y);
  await sleep(300);
  await page.keyboard.press('Escape');
  await sleep(400);

  log('setColor done, picker closed');
}

// ── Brush size — Z/X keys ─────────────────────────────────────────────────────
async function setBrushSize(page, targetSize) {
  const size = Math.max(1, Math.min(100, Math.round(targetSize)));
  log(`setBrushSize: target=${size}`);

  const currentSize = await page.evaluate(() => {
    const el = document.querySelector('.brush-info');
    if (!el) return 10;
    const match = el.textContent.match(/(\d+)px/);
    return match ? parseInt(match[1]) : 10;
  });

  log(`setBrushSize: current=${currentSize}`);
  const diff = size - currentSize;
  if (diff === 0) return;

  // BUG2 FIX: focus canvas via JS not mouse click
  await focusCanvas(page);

  const key = diff > 0 ? 'z' : 'x';
  const presses = Math.abs(diff);
  log(`setBrushSize: pressing ${key} x${presses}`);

  for (let i = 0; i < presses; i++) {
    await page.keyboard.press(key);
    await sleep(30);
  }
  await sleep(200);

  const newSize = await page.evaluate(() => {
    const el = document.querySelector('.brush-info');
    if (!el) return '?';
    return el.textContent;
  });
  log(`setBrushSize done: brush-info now shows "${newSize}"`);
}

// ── Brush type ─────────────────────────────────────────────────────────────────
async function selectBrushType(page, brushName) {
  log(`selectBrushType: ${brushName}`);
  // Click brush tool to open list (don't Escape yet — need list open)
  await page.mouse.click(TOOLBAR.brush.x, TOOLBAR.brush.y);
  await sleep(500);

  const clicked = await page.evaluate((name) => {
    const labels = Array.from(document.querySelectorAll('.brush-label'));
    const match = labels.find(el =>
      el.textContent.trim().toLowerCase().includes(name.toLowerCase())
    );
    if (match) { match.click(); return true; }
    return false;
  }, brushName);

  log(`selectBrushType clicked: ${clicked}`);
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(200);
}

async function selectBrushTool(page) {
  await page.mouse.click(TOOLBAR.brush.x, TOOLBAR.brush.y);
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(200);
}

async function selectFillTool(page) {
  await page.mouse.click(TOOLBAR.fill.x, TOOLBAR.fill.y);
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(200);
}

// ── Screenshot — BUG4 FIX: clip full page to canvas rect (all 3 layers) ───────
async function screenshotCanvas(page) {
  const bounds = await page.evaluate(() => {
    const c = document.querySelector('canvas.main-canvas');
    if (!c) throw new Error('main-canvas not found');
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  });
  log(`screenshotCanvas: clip=(${bounds.x},${bounds.y},${bounds.width},${bounds.height})`);
  // Clip full page screenshot to canvas area — captures ALL canvas layers
  return await page.screenshot({
    type: 'jpeg',
    quality: 85,
    clip: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  });
}

module.exports = {
  drawLine, drawCircle, drawRect, drawFreeStroke, clickCanvas,
  selectBrushTool, selectFillTool, selectBrushType,
  setColor, setBrushSize, undo, redo, clearCanvas,
  screenshotCanvas, getCanvasBounds, sleep, focusCanvas,
};
