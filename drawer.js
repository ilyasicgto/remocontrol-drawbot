/**
 * drawer.js — Controls doodle.gator via Puppeteer
 * All coordinates from deepdebug_full.json (exact pixels)
 *
 * Canvas displayed: x=379, y=37, w=523, h=617
 * Canvas internal:  1016 x 1200
 * Toolbar Row 1 y=709: Brush=517  Eraser=578  Fill=640  Eyedrop=702  ColorBall=763
 * Toolbar Row 2 y=774: Undo=517   Redo=578    Clear=639 Layers=700   SizeBall=762
 * Size slider: x=507, topY=473 (size=100), botY=650 (size=1)
 * Hex input: center (640, 675)
 * Clear confirm: (721, 535)
 */

const CANVAS = { x: 379, y: 37, w: 523, h: 617 };
const CANVAS_INTERNAL = { w: 1016, h: 1200 };

const TOOLS = {
  brush:     { x: 517, y: 709 },
  eraser:    { x: 578, y: 709 },
  fill:      { x: 640, y: 709 },
  eyedrop:   { x: 702, y: 709 },
  colorball: { x: 763, y: 709 },
  undo:      { x: 517, y: 774 },
  redo:      { x: 578, y: 774 },
  clear:     { x: 639, y: 774 },
  layers:    { x: 700, y: 774 },
  sizeball:  { x: 762, y: 774 },
};

const BRUSHES = {
  'Marker':               { x: 640, y: 96  },
  'Pixel Brush':          { x: 640, y: 139 },
  'Shapes':               { x: 640, y: 182 },
  'Airbrush':             { x: 640, y: 225 },
  'Dry brush':            { x: 640, y: 268 },
  'Wet brush':            { x: 640, y: 311 },
  'Velvet Pastel':        { x: 640, y: 354 },
  'Soft Watercolor':      { x: 640, y: 397 },
  'Flowing Watercolor':   { x: 640, y: 440 },
  'Flat brush':           { x: 640, y: 483 },
  'Quill':                { x: 640, y: 526 },
  'Ink':                  { x: 640, y: 569 },
  'Pencil':               { x: 640, y: 612 },
  'Watercolor (texture)': { x: 640, y: 655 },
  'Rembrandt':            { x: 640, y: 698 },
  'Dashed':               { x: 640, y: 741 },
  'Outline':              { x: 640, y: 784 },
  'Neon':                 { x: 640, y: 827 },
  'Particles':            { x: 640, y: 870 },
  'Glyph':                { x: 640, y: 913 },
};

const SIZE_SLIDER = { x: 507, topY: 473, botY: 650 };
const CLEAR_DIALOG = { cancel: { x: 603, y: 535 }, confirm: { x: 721, y: 535 } };
const HEX_INPUT = { x: 640, y: 675 };

function toScreen(nx, ny) {
  return {
    x: Math.round(CANVAS.x + (nx / 1000) * CANVAS.w),
    y: Math.round(CANVAS.y + (ny / 1000) * CANVAS.h),
  };
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function click(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await sleep(50);
  await page.mouse.up();
  await sleep(50);
}

async function setBrushSize(page, size) {
  size = Math.max(1, Math.min(100, Math.round(size)));
  const t = (100 - size) / 99;
  const y = Math.round(SIZE_SLIDER.topY + t * (SIZE_SLIDER.botY - SIZE_SLIDER.topY));
  await page.mouse.move(SIZE_SLIDER.x, y);
  await page.mouse.down();
  await sleep(30);
  await page.mouse.up();
}

async function setColor(page, hex) {
  if (!hex.startsWith('#')) hex = '#' + hex;
  await click(page, TOOLS.colorball.x, TOOLS.colorball.y);
  await sleep(200);
  await click(page, HEX_INPUT.x, HEX_INPUT.y);
  await sleep(100);
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await sleep(50);
  await page.keyboard.type(hex, { delay: 30 });
  await page.keyboard.press('Enter');
  await sleep(150);
  await click(page, CANVAS.x + CANVAS.w / 2, CANVAS.y + CANVAS.h / 2);
  await sleep(100);
}

async function setBrush(page, brushName) {
  const brush = BRUSHES[brushName];
  if (!brush) throw new Error(`Unknown brush: "${brushName}". Use /brushes`);
  await click(page, TOOLS.brush.x, TOOLS.brush.y);
  await sleep(300);
  await click(page, brush.x, brush.y);
  await sleep(200);
}

async function drawStroke(page, points) {
  if (!points || points.length < 2) return;
  const first = toScreen(points[0].x, points[0].y);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await sleep(10);
  for (let i = 1; i < points.length; i++) {
    const p = toScreen(points[i].x, points[i].y);
    await page.mouse.move(p.x, p.y, { steps: 1 });
    await sleep(2);
  }
  await page.mouse.up();
  await sleep(20);
}

async function drawLine(page, x1, y1, x2, y2, steps = 40) {
  const pts = [];
  for (let i = 0; i <= steps; i++)
    pts.push({ x: x1+(x2-x1)*(i/steps), y: y1+(y2-y1)*(i/steps) });
  await drawStroke(page, pts);
}

async function drawCircle(page, cx, cy, r, steps = 60) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i/steps)*Math.PI*2;
    pts.push({ x: cx+Math.cos(a)*r, y: cy+Math.sin(a)*r });
  }
  await drawStroke(page, pts);
}

async function drawRect(page, x1, y1, x2, y2) {
  const corners = [{x:x1,y:y1},{x:x2,y:y1},{x:x2,y:y2},{x:x1,y:y2},{x:x1,y:y1}];
  const pts = [];
  for (let i = 0; i < corners.length-1; i++) {
    const a=corners[i], b=corners[i+1];
    for (let s=0; s<=20; s++)
      pts.push({ x: a.x+(b.x-a.x)*s/20, y: a.y+(b.y-a.y)*s/20 });
  }
  await drawStroke(page, pts);
}

async function undo(page) { await click(page, TOOLS.undo.x, TOOLS.undo.y); await sleep(100); }
async function redo(page) { await click(page, TOOLS.redo.x, TOOLS.redo.y); await sleep(100); }

async function clearCanvas(page) {
  await click(page, TOOLS.clear.x, TOOLS.clear.y);
  await sleep(300);
  await click(page, CLEAR_DIALOG.confirm.x, CLEAR_DIALOG.confirm.y);
  await sleep(200);
}

module.exports = {
  CANVAS, CANVAS_INTERNAL, TOOLS, BRUSHES,
  toScreen, sleep, click,
  drawStroke, drawLine, drawCircle, drawRect,
  setColor, setBrushSize, setBrush,
  undo, redo, clearCanvas,
};
