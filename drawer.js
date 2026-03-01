/**
 * drawer.js
 * CrocoDraw mouse simulation — uses exact pixel coordinates from DOM inspection
 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function dist(a, b) { return Math.sqrt((b.x-a.x)**2 + (b.y-a.y)**2); }

// ── Canvas bounds ──────────────────────────────────────────────────────────────
async function getCanvasBounds(page) {
  return await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('Canvas not found');
    const r = canvas.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
}

function toAbsolute(cx, cy, bounds) {
  return {
    x: bounds.x + (cx / 1000) * bounds.width,
    y: bounds.y + (cy / 1000) * bounds.height,
  };
}

// ── Core stroke ────────────────────────────────────────────────────────────────
async function stroke(page, points, bounds) {
  if (!points.length) return;
  const first = toAbsolute(points[0].x, points[0].y, bounds);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await sleep(10);
  for (let i = 1; i < points.length; i++) {
    const prev = toAbsolute(points[i-1].x, points[i-1].y, bounds);
    const curr = toAbsolute(points[i].x, points[i].y, bounds);
    const steps = Math.max(6, Math.round(dist(prev, curr) / 4));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      await page.mouse.move(prev.x + (curr.x - prev.x) * t, prev.y + (curr.y - prev.y) * t);
      await sleep(2);
    }
  }
  await page.mouse.up();
  await sleep(20);
}

// ── Draw commands ──────────────────────────────────────────────────────────────
async function drawLine(page, x1, y1, x2, y2) {
  const bounds = await getCanvasBounds(page);
  const points = [];
  for (let i = 0; i <= 30; i++) points.push({ x: x1+((x2-x1)*i/30), y: y1+((y2-y1)*i/30) });
  await stroke(page, points, bounds);
}

async function drawCircle(page, cx, cy, r) {
  const bounds = await getCanvasBounds(page);
  const points = [];
  for (let i = 0; i <= 60; i++) {
    const a = (i/60)*Math.PI*2;
    points.push({ x: cx+Math.cos(a)*r, y: cy+Math.sin(a)*r });
  }
  await stroke(page, points, bounds);
}

async function drawRect(page, x1, y1, x2, y2) {
  const bounds = await getCanvasBounds(page);
  const corners = [{x:x1,y:y1},{x:x2,y:y1},{x:x2,y:y2},{x:x1,y:y2},{x:x1,y:y1}];
  const points = [];
  for (let i = 0; i < corners.length-1; i++) {
    const a = corners[i], b = corners[i+1];
    for (let s = 0; s <= 20; s++) points.push({ x: a.x+((b.x-a.x)*s/20), y: a.y+((b.y-a.y)*s/20) });
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

// ── Toolbar buttons — EXACT pixel coords from DOM debug ───────────────────────
// Row 1 (tools) y=709:  brush=517  eraser=579  fill=640  eyedropper=702  color=763
// Row 2 (actions) y=774: undo=517  redo=579  clear=640  layers=701  transform=762

const TOOLBAR = {
  brush:       { x: 517, y: 709 },
  eraser:      { x: 579, y: 709 },
  fill:        { x: 640, y: 709 },
  eyedropper:  { x: 702, y: 709 },
  colorball:   { x: 763, y: 709 },
  undo:        { x: 517, y: 774 },
  redo:        { x: 579, y: 774 },
  clear:       { x: 640, y: 774 },
  layers:      { x: 701, y: 774 },
  transform:   { x: 762, y: 774 },
};

async function clickTool(page, name) {
  const t = TOOLBAR[name];
  if (!t) throw new Error('Unknown tool: ' + name);
  await page.mouse.click(t.x, t.y);
  await sleep(250);
}

async function selectBrushTool(page) { await clickTool(page, 'brush'); }
async function selectFillTool(page)  { await clickTool(page, 'fill'); }

async function undo(page) { await clickTool(page, 'undo'); }
async function redo(page) { await clickTool(page, 'redo'); }

async function clearCanvas_REPLACED(page) {
  await clickTool(page, 'clear');
  await sleep(300);
  // Confirm dialog if appears
  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('.circle-switch, [class*="confirm"], [class*="ok"]'));
    const confirm = all.find(el => /yes|ok|confirm|clear/i.test(el.textContent));
    if (confirm) confirm.click();
  });
  await sleep(200);
}

// ── Color picker ───────────────────────────────────────────────────────────────
function hexToHsv(hex) {
  if (hex.startsWith('#')) hex = hex.slice(1);
  if (hex.length === 3) hex = hex.split('').map(c=>c+c).join('');
  let r = parseInt(hex.slice(0,2),16)/255;
  let g = parseInt(hex.slice(2,4),16)/255;
  let b = parseInt(hex.slice(4,6),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
  let h = 0, s = max===0 ? 0 : d/max, v = max;
  if (max !== min) {
    switch(max) {
      case r: h=((g-b)/d+(g<b?6:0))/6; break;
      case g: h=((b-r)/d+2)/6; break;
      case b: h=((r-g)/d+4)/6; break;
    }
  }
  return { h, s, v };
}

async function setColor(page, hex) {
  if (!hex.startsWith('#')) hex = '#' + hex;

  // Open color picker
  await clickTool(page, 'colorball');
  await sleep(500);

  const hsv = hexToHsv(hex);

  // Get color picker bounds
  const picker = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));

    // Gradient saturation box — large square with gradient
    const gradBox = all.find(el => {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 80 && r.height > 80 && r.width < 400 &&
             (s.backgroundImage||'').includes('gradient') &&
             r.y > 400;
    });

    // Hue slider — wide thin element (rainbow)
    const hueEl = all.find(el => {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 100 && r.height > 5 && r.height < 30 &&
             (s.backgroundImage||'').includes('hsl') &&
             r.y > 400;
    });

    // Opacity slider
    const opEl = all.find(el => {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 100 && r.height > 5 && r.height < 30 &&
             (s.backgroundImage||'').includes('rgba') &&
             r.y > 400;
    });

    return {
      grad: gradBox ? { x: gradBox.getBoundingClientRect().left, y: gradBox.getBoundingClientRect().top, w: gradBox.getBoundingClientRect().width, h: gradBox.getBoundingClientRect().height } : null,
      hue:  hueEl  ? { x: hueEl.getBoundingClientRect().left,  y: hueEl.getBoundingClientRect().top,  w: hueEl.getBoundingClientRect().width,  h: hueEl.getBoundingClientRect().height  } : null,
      op:   opEl   ? { x: opEl.getBoundingClientRect().left,   y: opEl.getBoundingClientRect().top,   w: opEl.getBoundingClientRect().width,   h: opEl.getBoundingClientRect().height   } : null,
    };
  });

  // Click hue slider
  if (picker.hue) {
    await page.mouse.click(
      picker.hue.x + hsv.h * picker.hue.w,
      picker.hue.y + picker.hue.h / 2
    );
    await sleep(150);
  }

  // Click saturation/brightness box
  if (picker.grad) {
    await page.mouse.click(
      picker.grad.x + hsv.s * picker.grad.w,
      picker.grad.y + (1 - hsv.v) * picker.grad.h
    );
    await sleep(150);
  }

  // Set opacity to 100% if opacity slider exists
  if (picker.op) {
    await page.mouse.click(picker.op.x + picker.op.w, picker.op.y + picker.op.h / 2);
    await sleep(100);
  }

  // Close picker by clicking outside / pressing Escape
  await page.keyboard.press('Escape');
  await sleep(150);
}

// ── Brush size ─────────────────────────────────────────────────────────────────
// brush-info div is at x=782,y=749 — click it to open size control
async function setBrushSize(page, size) {
  // Click the brush-info element
  await page.evaluate(() => {
    const el = document.querySelector('.brush-info');
    if (el) el.click();
  });
  await sleep(400);

  // Find any slider that appeared and set it
  await page.evaluate((s) => {
    const inputs = Array.from(document.querySelectorAll('input[type="range"]'));
    if (!inputs.length) return;
    const input = inputs[0];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(s));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, size);

  await sleep(150);

  // Try clicking a visible size option or dragging slider
  const sliderPos = await page.evaluate((targetSize) => {
    const all = Array.from(document.querySelectorAll('*'));
    // Look for a slider track
    const slider = all.find(el => {
      const r = el.getBoundingClientRect();
      return r.width > 80 && r.height < 20 && r.height > 3 && r.y > 600;
    });
    if (!slider) return null;
    const r = slider.getBoundingClientRect();
    // Map size 1-100 to slider position
    const ratio = Math.min(targetSize / 100, 1);
    return { x: r.x + ratio * r.width, y: r.y + r.height/2 };
  }, size);

  if (sliderPos) {
    await page.mouse.click(sliderPos.x, sliderPos.y);
    await sleep(150);
  }

  await page.keyboard.press('Escape');
  await sleep(100);
}

// ── Brush type selection ───────────────────────────────────────────────────────
async function selectBrushType(page, brushName) {
  // Click brush tool to open brush list
  await clickTool(page, 'brush');
  await sleep(300);

  const found = await page.evaluate((name) => {
    const all = Array.from(document.querySelectorAll('*'));
    const match = all.find(el =>
      el.children.length <= 1 &&
      el.textContent.trim().toLowerCase() === name.toLowerCase() &&
      el.getBoundingClientRect().width > 50
    );
    if (match) { match.click(); return true; }
    return false;
  }, brushName);

  if (!found) console.warn('⚠️ Brush not found:', brushName);
  await sleep(200);
}

// ── Screenshot ─────────────────────────────────────────────────────────────────
async function screenshotCanvas(page) {
  const canvas = await page.$('canvas');
  if (!canvas) throw new Error('Canvas not found');
  return await canvas.screenshot({ type: 'jpeg', quality: 80 });
}



// ── FIXED FUNCTIONS (overrides above) ─────────────────────────────────────────

// FIXED: Clear — clicks "Clear" button in confirmation dialog
async function clearCanvas(page) {
  await clickTool(page, 'clear');
  await sleep(500);
  // Click the "Clear" confirm button (not "Cancel")
  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    const btn = all.find(el =>
      el.textContent.trim() === 'Clear' &&
      el.getBoundingClientRect().width > 40 &&
      el.getBoundingClientRect().width < 300
    );
    if (btn) btn.click();
  });
  await sleep(300);
}

// FIXED: Size — uses X key (smaller) and Z key (bigger) 
// currentSize is tracked globally, we press X or Z repeatedly
async function setBrushSize(page, targetSize) {
  // Click canvas first to make sure keyboard events go to the app
  const bounds = await getCanvasBounds(page);
  await page.mouse.click(bounds.x + bounds.width/2, bounds.y + bounds.height/2);
  await sleep(200);

  // Read current size from brush-info div
  const currentSize = await page.evaluate(() => {
    const el = document.querySelector('.brush-info');
    if (!el) return 10;
    const match = el.textContent.match(/[\d.]+/);
    return match ? parseFloat(match[0]) : 10;
  });

  const diff = targetSize - currentSize;
  if (Math.abs(diff) < 0.5) return; // already at target

  // Z = bigger (+), X = smaller (-)
  const key = diff > 0 ? 'z' : 'x';
  const presses = Math.min(Math.round(Math.abs(diff) * 2), 80); // cap at 80 presses

  for (let i = 0; i < presses; i++) {
    await page.keyboard.press(key);
    await sleep(15);
  }
  await sleep(100);
}

// FIXED: Color — set color then click brush tool to re-apply it
async function setColor(page, hex) {
  if (!hex.startsWith('#')) hex = '#' + hex;

  // Open color picker
  await clickTool(page, 'colorball');
  await sleep(500);

  const hsv = hexToHsv(hex);

  // Get color picker element positions
  const picker = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));

    const gradBox = all.find(el => {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 80 && r.height > 80 && r.width < 500 &&
             (s.backgroundImage||'').includes('gradient') && r.y > 300;
    });

    const hueEl = all.find(el => {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      const bg = s.backgroundImage || s.background || '';
      return r.width > 100 && r.height > 5 && r.height < 35 &&
             (bg.includes('hsl') || bg.includes('linear-gradient')) && r.y > 300;
    });

    return {
      grad: gradBox ? {
        x: gradBox.getBoundingClientRect().left,
        y: gradBox.getBoundingClientRect().top,
        w: gradBox.getBoundingClientRect().width,
        h: gradBox.getBoundingClientRect().height
      } : null,
      hue: hueEl ? {
        x: hueEl.getBoundingClientRect().left,
        y: hueEl.getBoundingClientRect().top,
        w: hueEl.getBoundingClientRect().width,
        h: hueEl.getBoundingClientRect().height
      } : null,
    };
  });

  if (picker.hue) {
    await page.mouse.click(
      picker.hue.x + hsv.h * picker.hue.w,
      picker.hue.y + picker.hue.h / 2
    );
    await sleep(200);
  }

  if (picker.grad) {
    await page.mouse.click(
      picker.grad.x + hsv.s * picker.grad.w,
      picker.grad.y + (1 - hsv.v) * picker.grad.h
    );
    await sleep(200);
  }

  // Close picker by clicking outside (click canvas area)
  const bounds = await getCanvasBounds(page);
  await page.mouse.click(bounds.x + bounds.width/2, bounds.y + 50);
  await sleep(300);

  // ⚡ KEY FIX: re-select brush tool so color gets applied
  await clickTool(page, 'brush');
  await sleep(200);
}

module.exports = {
  drawLine, drawCircle, drawRect, drawFreeStroke, clickCanvas,
  selectBrushTool, selectFillTool, selectBrushType,
  setColor, setBrushSize, undo, redo, clearCanvas,
  screenshotCanvas, getCanvasBounds, sleep,
};
