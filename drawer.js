/**
 * drawer.js
 * Mouse simulation engine for CrocoDraw canvas control
 * Fixed: faster speeds, color via hue slider clicking
 */

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function dist(a, b) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

// Get canvas bounding box
async function getCanvasBounds(page) {
  return await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('Canvas not found');
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
}

// Convert 0-1000 coords to absolute page coords
function toAbsolute(cx, cy, bounds) {
  return {
    x: bounds.x + (cx / 1000) * bounds.width,
    y: bounds.y + (cy / 1000) * bounds.height,
  };
}

// Core stroke engine — smooth interpolated mouse drag
async function stroke(page, points, bounds) {
  if (points.length === 0) return;
  const first = toAbsolute(points[0].x, points[0].y, bounds);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await sleep(10);

  for (let i = 1; i < points.length; i++) {
    const prev = toAbsolute(points[i - 1].x, points[i - 1].y, bounds);
    const curr = toAbsolute(points[i].x, points[i].y, bounds);
    const steps = Math.max(8, Math.round(dist(prev, curr) / 4));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      await page.mouse.move(
        prev.x + (curr.x - prev.x) * t,
        prev.y + (curr.y - prev.y) * t
      );
      await sleep(2);
    }
  }

  await page.mouse.up();
  await sleep(20);
}

// Draw straight line
async function drawLine(page, x1, y1, x2, y2) {
  const bounds = await getCanvasBounds(page);
  const steps = 30;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    points.push({
      x: x1 + ((x2 - x1) * i) / steps,
      y: y1 + ((y2 - y1) * i) / steps,
    });
  }
  await stroke(page, points, bounds);
}

// Draw circle
async function drawCircle(page, cx, cy, r) {
  const bounds = await getCanvasBounds(page);
  const steps = 80;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    points.push({
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    });
  }
  await stroke(page, points, bounds);
}

// Draw rectangle
async function drawRect(page, x1, y1, x2, y2) {
  const bounds = await getCanvasBounds(page);
  const sides = [
    [{ x: x1, y: y1 }, { x: x2, y: y1 }],
    [{ x: x2, y: y1 }, { x: x2, y: y2 }],
    [{ x: x2, y: y2 }, { x: x1, y: y2 }],
    [{ x: x1, y: y2 }, { x: x1, y: y1 }],
  ];
  for (const [a, b] of sides) {
    const points = [];
    for (let i = 0; i <= 20; i++) {
      points.push({
        x: a.x + ((b.x - a.x) * i) / 20,
        y: a.y + ((b.y - a.y) * i) / 20,
      });
    }
    await stroke(page, points, bounds);
  }
}

// Free multi-point stroke
async function drawFreeStroke(page, points) {
  const bounds = await getCanvasBounds(page);
  await stroke(page, points, bounds);
}

// Click canvas position (for fill tool)
async function clickCanvas(page, x, y) {
  const bounds = await getCanvasBounds(page);
  const abs = toAbsolute(x, y, bounds);
  await page.mouse.click(abs.x, abs.y);
  await sleep(50);
}

// ── Tool button helpers ────────────────────────────────────────────────────────

// Get all toolbar buttons split into rows
async function getToolbarRows(page) {
  return await page.evaluate(() => {
    const allBtns = Array.from(document.querySelectorAll('button'));
    const toolBtns = allBtns.filter(b => {
      const rect = b.getBoundingClientRect();
      return rect.width > 30 && rect.width < 120 && rect.height > 30 && rect.height < 120;
    });
    const sorted = toolBtns.sort((a, b) => {
      const ay = a.getBoundingClientRect().y;
      const by = b.getBoundingClientRect().y;
      return ay !== by ? ay - by : a.getBoundingClientRect().x - b.getBoundingClientRect().x;
    });
    const rows = [];
    let lastY = -999;
    for (const btn of sorted) {
      const y = Math.round(btn.getBoundingClientRect().y);
      if (Math.abs(y - lastY) > 15) { rows.push([]); lastY = y; }
      rows[rows.length - 1].push({
        x: btn.getBoundingClientRect().x + btn.getBoundingClientRect().width / 2,
        y: btn.getBoundingClientRect().y + btn.getBoundingClientRect().height / 2,
      });
    }
    return rows;
  });
}

async function clickToolbarButton(page, row, index) {
  const rows = await getToolbarRows(page);
  if (!rows[row] || !rows[row][index]) {
    console.warn(`Toolbar button [${row}][${index}] not found`);
    return;
  }
  const btn = rows[row][index];
  await page.mouse.click(btn.x, btn.y);
  await sleep(200);
}

async function selectBrushTool(page) { await clickToolbarButton(page, 0, 0); }
async function selectFillTool(page) { await clickToolbarButton(page, 0, 1); }
async function undo(page) { await clickToolbarButton(page, 1, 0); }
async function redo(page) { await clickToolbarButton(page, 1, 1); }

async function clearCanvas(page) {
  await clickToolbarButton(page, 1, 2);
  await sleep(200);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const confirm = btns.find(b => /confirm|yes|ok|clear/i.test(b.textContent));
    if (confirm) confirm.click();
  });
  await sleep(200);
}

// ── Color setting via hue slider ───────────────────────────────────────────────

// Convert hex to HSV
function hexToHsv(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
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
  // Normalize hex
  if (!hex.startsWith('#')) hex = '#' + hex;
  if (hex.length === 4) {
    hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }

  // Click color ball button (5th tool, index 4)
  await clickToolbarButton(page, 0, 4);
  await sleep(400);

  const hsv = hexToHsv(hex);

  // Get color picker elements positions
  const picker = await page.evaluate(() => {
    // Find hue slider (rainbow bar)
    const inputs = Array.from(document.querySelectorAll('input[type="range"]'));
    const allEls = Array.from(document.querySelectorAll('*'));

    // Find the gradient/saturation box
    const gradBox = allEls.find(el => {
      const s = window.getComputedStyle(el);
      const bg = s.backgroundImage || '';
      return bg.includes('gradient') && bg.includes('white') && el.getBoundingClientRect().width > 100;
    });

    // Find hue slider
    const hueSlider = inputs.find(i => {
      const s = window.getComputedStyle(i);
      const bg = s.backgroundImage || s.background || '';
      return bg.includes('hsl') || bg.includes('rainbow') || bg.includes('gradient');
    }) || inputs[0];

    // Find hex display element
    const hexEl = allEls.find(el =>
      el.children.length === 0 &&
      /^#[0-9a-fA-F]{6}$/i.test(el.textContent.trim())
    );

    return {
      gradBox: gradBox ? {
        x: gradBox.getBoundingClientRect().left,
        y: gradBox.getBoundingClientRect().top,
        w: gradBox.getBoundingClientRect().width,
        h: gradBox.getBoundingClientRect().height,
      } : null,
      hueSlider: hueSlider ? {
        x: hueSlider.getBoundingClientRect().left,
        y: hueSlider.getBoundingClientRect().top,
        w: hueSlider.getBoundingClientRect().width,
        h: hueSlider.getBoundingClientRect().height,
      } : null,
    };
  });

  if (picker.hueSlider) {
    // Click on hue slider at correct hue position
    const hueX = picker.hueSlider.x + hsv.h * picker.hueSlider.w;
    const hueY = picker.hueSlider.y + picker.hueSlider.h / 2;
    await page.mouse.click(hueX, hueY);
    await sleep(150);
  }

  if (picker.gradBox) {
    // Click on saturation/brightness box
    const sx = picker.gradBox.x + hsv.s * picker.gradBox.w;
    const sy = picker.gradBox.y + (1 - hsv.v) * picker.gradBox.h;
    await page.mouse.click(sx, sy);
    await sleep(150);
  }

  // Close color picker
  await page.keyboard.press('Escape');
  await sleep(150);
}

// Set brush size
async function setBrushSize(page, size) {
  // Try clicking size display text and using keyboard
  await page.evaluate((s) => {
    const allEls = Array.from(document.querySelectorAll('*'));
    const sizeEl = allEls.find(el =>
      el.children.length === 0 && /^\d+px$/.test(el.textContent.trim())
    );
    if (sizeEl) sizeEl.click();
  }, size);
  await sleep(300);

  // Try range input
  const changed = await page.evaluate((s) => {
    const inputs = Array.from(document.querySelectorAll('input[type="range"]'));
    if (inputs.length === 0) return false;
    const input = inputs[0];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(s));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, size);

  await sleep(100);
  await page.keyboard.press('Escape');
  await sleep(100);
}

// Select brush type from list
async function selectBrushType(page, brushName) {
  await selectBrushTool(page);
  await sleep(200);

  const found = await page.evaluate((name) => {
    const all = Array.from(document.querySelectorAll('*'));
    const match = all.find(el =>
      el.children.length === 0 &&
      el.textContent.trim().toLowerCase() === name.toLowerCase()
    );
    if (match) { match.click(); return true; }
    return false;
  }, brushName);

  if (!found) console.warn('Brush not found:', brushName);
  await sleep(200);
}

// Screenshot canvas only
async function screenshotCanvas(page) {
  const canvas = await page.$('canvas');
  if (!canvas) throw new Error('Canvas not found');
  return await canvas.screenshot({ type: 'jpeg', quality: 80 });
}

module.exports = {
  drawLine,
  drawCircle,
  drawRect,
  drawFreeStroke,
  clickCanvas,
  selectBrushTool,
  selectFillTool,
  selectBrushType,
  setColor,
  setBrushSize,
  undo,
  redo,
  clearCanvas,
  screenshotCanvas,
  getCanvasBounds,
  sleep,
};
