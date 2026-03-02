/**
 * drawer.js — CrocoDraw mouse simulation
 * All coordinates verified from deepdebug scan
 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Canvas bounds ──────────────────────────────────────────────────────────────
async function getCanvasBounds(page) {
  return await page.evaluate(() => {
    const c = document.querySelector('canvas.main-canvas');
    if (!c) throw new Error('main-canvas not found');
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
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

// ── Core stroke ────────────────────────────────────────────────────────────────
async function stroke(page, points, bounds) {
  if (!points.length) return;
  const first = toAbsolute(points[0].x, points[0].y, bounds);
  await page.mouse.move(first.x, first.y);
  await sleep(30);
  await page.mouse.down();
  await sleep(30);
  for (let i = 1; i < points.length; i++) {
    const prev = toAbsolute(points[i - 1].x, points[i - 1].y, bounds);
    const curr = toAbsolute(points[i].x, points[i].y, bounds);
    // More steps, slower movement so CrocoDraw registers every point
    const steps = Math.max(10, Math.round(dist(prev, curr) / 2));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      await page.mouse.move(
        prev.x + (curr.x - prev.x) * t,
        prev.y + (curr.y - prev.y) * t
      );
      await sleep(8);
    }
  }
  await page.mouse.up();
  await sleep(50);
}

// ── Draw helpers ───────────────────────────────────────────────────────────────
async function drawLine(page, x1, y1, x2, y2) {
  const bounds = await getCanvasBounds(page);
  const points = [];
  for (let i = 0; i <= 30; i++)
    points.push({ x: x1 + (x2 - x1) * i / 30, y: y1 + (y2 - y1) * i / 30 });
  await stroke(page, points, bounds);
}

async function drawCircle(page, cx, cy, r) {
  const bounds = await getCanvasBounds(page);
  const points = [];
  for (let i = 0; i <= 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    points.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  await stroke(page, points, bounds);
}

async function drawRect(page, x1, y1, x2, y2) {
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
  const bounds = await getCanvasBounds(page);
  await stroke(page, points, bounds);
}

async function clickCanvas(page, x, y) {
  const bounds = await getCanvasBounds(page);
  const abs = toAbsolute(x, y, bounds);
  await page.mouse.click(abs.x, abs.y);
  await sleep(50);
}

// ── Toolbar — exact pixel coords from deepdebug ────────────────────────────────
// Row 1 (y=709): brush=517  eraser=579  fill=640  eyedropper=702  colorball=763
// Row 2 (y=774): undo=517   redo=579    clear=639  layers=700     size=762
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
  sizeknob:   { x: 762, y: 774 }, // ns-resize drag element
};

async function clickTool(page, name) {
  const t = TOOLBAR[name];
  if (!t) throw new Error('Unknown tool: ' + name);
  await page.mouse.click(t.x, t.y);
  await sleep(250);
}

async function selectBrushTool(page) { await clickTool(page, 'brush'); }
async function selectFillTool(page)  { await clickTool(page, 'fill'); }

// ── Undo / Redo ────────────────────────────────────────────────────────────────
async function undo(page) { await clickTool(page, 'undo'); }
async function redo(page) { await clickTool(page, 'redo'); }

// ── Clear ──────────────────────────────────────────────────────────────────────
// Dialog has: BUTTON.cancel-button "Cancel" and BUTTON.destructive-button "Clear"
async function clearCanvas(page) {
  await clickTool(page, 'clear');
  await sleep(500);
  // Click the destructive "Clear" button
  await page.evaluate(() => {
    const btn = document.querySelector('button.destructive-button');
    if (btn) btn.click();
  });
  await sleep(300);
}

// ── Color ──────────────────────────────────────────────────────────────────────
// Color picker uses react-colorful:
//   saturation box:  pos=(540,459) size=200x136  — click at (x=sat, y=1-val)
//   hue slider:      pos=(540,610) size=200x12   — click at x=hue
//   alpha slider:    pos=(540,637) size=200x12   — click far right for 100%
//   hex input:       pos=(595,659) size=90x32    — class "colorful-input input-field"
//   widthSlider:     pos=(495,473) size=25x177   — VERTICAL range input min=1 max=100

function hexToHsv(hex) {
  if (hex.startsWith('#')) hex = hex.slice(1);
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0, s = max === 0 ? 0 : d / max, v = max;
  if (max !== min) {
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h, s, v };
}

async function setColor(page, hex) {
  if (!hex.startsWith('#')) hex = '#' + hex;

  // Open color picker
  await clickTool(page, 'colorball');
  await sleep(600);

  // Use hex input — fastest and most accurate
  // Selector: input.colorful-input.input-field at pos=(595,659)
  await page.evaluate((hexVal) => {
    const input = document.querySelector('input.colorful-input');
    if (!input) return;
    input.focus();
    input.select();
    // Use native setter to trigger React's onChange
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(input, hexVal.replace('#', ''));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, hex);
  await sleep(200);

  // Press Enter to confirm
  await page.keyboard.press('Enter');
  await sleep(200);

  // Close picker by pressing Escape first, then click brush tool to reselect
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.mouse.click(TOOLBAR.brush.x, TOOLBAR.brush.y);
  await sleep(400);
  // Extra wait to ensure picker is fully closed before any drawing happens
  await sleep(300);
}

// ── Brush size ─────────────────────────────────────────────────────────────────
// widthSlider: INPUT.widthSlider — vertical range, pos=(495,473) size=25x177
// min=1 max=100, currently inside the color picker panel
// Strategy: open color picker (which also shows widthSlider), set value, close

async function setBrushSize(page, targetSize) {
  const size = Math.max(1, Math.min(100, Math.round(targetSize)));

  // Read current size from brush-info text e.g. "12px100%"
  const currentSize = await page.evaluate(() => {
    const el = document.querySelector('.brush-info');
    if (!el) return 10;
    const match = el.textContent.match(/(\d+)px/);
    return match ? parseInt(match[1]) : 10;
  });

  const diff = size - currentSize;
  if (diff === 0) return;

  // Click brush tool to select it, then focus canvas for keyboard events
  await page.mouse.click(TOOLBAR.brush.x, TOOLBAR.brush.y);
  await sleep(200);

  // Focus the canvas by clicking its very top-left corner (outside drawable area)
  // This gives canvas keyboard focus without triggering a visible stroke
  const bounds = await getCanvasBounds(page);
  await page.mouse.click(bounds.x + 2, bounds.y + 2);
  await sleep(150);

  // Z = +1px per press, X = -1px per press
  const key = diff > 0 ? 'z' : 'x';
  const presses = Math.abs(diff);
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press(key);
    await sleep(25);
  }
  await sleep(200);
}

// ── Brush type selection ───────────────────────────────────────────────────────
// Available brushes from deepdebug (brush-option-row / brush-label):
// Flowing Watercolor, Flat brush, Quill, Ink, Pencil, Watercolor (texture), Rembrandt...
async function selectBrushType(page, brushName) {
  // Open brush list
  await clickTool(page, 'brush');
  await sleep(500);

  const clicked = await page.evaluate((name) => {
    const labels = Array.from(document.querySelectorAll('.brush-label'));
    const match = labels.find(el =>
      el.textContent.trim().toLowerCase().includes(name.toLowerCase())
    );
    if (match) { match.click(); return true; }
    return false;
  }, brushName);

  if (!clicked) {
    await page.keyboard.press('Escape');
    throw new Error(`Brush "${brushName}" not found`);
  }
  await sleep(200);
}

// ── Screenshot ─────────────────────────────────────────────────────────────────
async function screenshotCanvas(page) {
  const canvas = await page.$('canvas.main-canvas');
  if (!canvas) throw new Error('main-canvas not found');
  return await canvas.screenshot({ type: 'jpeg', quality: 80 });
}

module.exports = {
  drawLine, drawCircle, drawRect, drawFreeStroke, clickCanvas,
  selectBrushTool, selectFillTool, selectBrushType,
  setColor, setBrushSize, undo, redo, clearCanvas,
  screenshotCanvas, getCanvasBounds, sleep,
};
