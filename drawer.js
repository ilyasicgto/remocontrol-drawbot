/**
 * drawer.js
 * Mouse simulation engine for CrocoDraw canvas control
 */

// Get canvas bounding box from page
async function getCanvasBounds(page) {
  return await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('Canvas not found');
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
}

// Convert relative canvas coords (0-1000 scale) to absolute page coords
function toAbsolute(cx, cy, bounds) {
  return {
    x: bounds.x + (cx / 1000) * bounds.width,
    y: bounds.y + (cy / 1000) * bounds.height,
  };
}

// Smooth stroke: mousedown → interpolated moves → mouseup
async function stroke(page, points, bounds) {
  if (points.length === 0) return;

  const first = toAbsolute(points[0].x, points[0].y, bounds);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await sleep(30);

  for (let i = 1; i < points.length; i++) {
    const prev = toAbsolute(points[i - 1].x, points[i - 1].y, bounds);
    const curr = toAbsolute(points[i].x, points[i].y, bounds);
    const steps = Math.max(10, Math.round(dist(prev, curr) / 3));

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      await page.mouse.move(
        prev.x + (curr.x - prev.x) * t,
        prev.y + (curr.y - prev.y) * t,
        { steps: 1 }
      );
      await sleep(5);
    }
  }

  await page.mouse.up();
  await sleep(50);
}

// Draw a straight line between two points
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

// Draw a circle using many points
async function drawCircle(page, cx, cy, r) {
  const bounds = await getCanvasBounds(page);
  const steps = 60;
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

// Draw a rectangle
async function drawRect(page, x1, y1, x2, y2) {
  const bounds = await getCanvasBounds(page);
  const points = [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
    { x: x1, y: y1 },
  ];
  // interpolate each side
  const expanded = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const steps = 20;
    for (let s = 0; s <= steps; s++) {
      expanded.push({
        x: a.x + ((b.x - a.x) * s) / steps,
        y: a.y + ((b.y - a.y) * s) / steps,
      });
    }
  }
  await stroke(page, expanded, bounds);
}

// Free multi-point stroke from array of {x,y}
async function drawFreeStroke(page, points) {
  const bounds = await getCanvasBounds(page);
  await stroke(page, points, bounds);
}

// Click a canvas position (for fill tool)
async function clickCanvas(page, x, y) {
  const bounds = await getCanvasBounds(page);
  const abs = toAbsolute(x, y, bounds);
  await page.mouse.click(abs.x, abs.y);
  await sleep(100);
}

// ── Tool & UI helpers ──────────────────────────────────────────────────────────

// Click a button by its position index in the bottom toolbar
// Row 1 (tools): 0=brush, 1=fill, 2=colorfill, 3=eyedropper, 4=colorball
// Row 2 (actions): 0=undo, 1=redo, 2=clear, 3=layers, 4=transform
async function clickToolbarButton(page, row, index) {
  const buttons = await page.$$('.toolbar button, [class*="tool"] button, [class*="Tool"]');
  // Fallback: click by evaluating all visible round buttons
  await page.evaluate((r, i) => {
    const allBtns = Array.from(document.querySelectorAll('button'));
    const toolBtns = allBtns.filter(b => {
      const rect = b.getBoundingClientRect();
      return rect.width > 30 && rect.width < 100 && rect.height > 30;
    });
    // Split into rows by Y position
    const sorted = toolBtns.sort((a, b) => {
      const ay = a.getBoundingClientRect().y;
      const by = b.getBoundingClientRect().y;
      return ay - by;
    });
    const rows = [];
    let lastY = -999;
    for (const btn of sorted) {
      const y = btn.getBoundingClientRect().y;
      if (Math.abs(y - lastY) > 20) { rows.push([]); lastY = y; }
      rows[rows.length - 1].push(btn);
    }
    if (rows[r] && rows[r][i]) rows[r][i].click();
  }, row, index);
  await sleep(300);
}

// Select brush tool (first button row 1)
async function selectBrushTool(page) {
  await clickToolbarButton(page, 0, 0);
}

// Select fill tool (second button row 1)
async function selectFillTool(page) {
  await clickToolbarButton(page, 0, 1);
}

// Undo
async function undo(page) {
  await clickToolbarButton(page, 1, 0);
}

// Redo
async function redo(page) {
  await clickToolbarButton(page, 1, 1);
}

// Clear canvas
async function clearCanvas(page) {
  await clickToolbarButton(page, 1, 2);
  await sleep(200);
  // Confirm if a dialog appears
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const confirm = btns.find(b => /confirm|yes|ok|clear/i.test(b.textContent));
    if (confirm) confirm.click();
  });
  await sleep(300);
}

// Set color by clicking the color ball and typing hex
async function setColor(page, hex) {
  // Click color ball (5th tool button)
  await clickToolbarButton(page, 0, 4);
  await sleep(500);

  // Find hex input field and set value
  await page.evaluate((color) => {
    const inputs = Array.from(document.querySelectorAll('input'));
    const hexInput = inputs.find(i =>
      i.value && /^#?[0-9a-fA-F]{3,6}$/.test(i.value.trim())
    ) || inputs.find(i => i.type === 'text' && i.placeholder && /hex|color/i.test(i.placeholder));

    if (hexInput) {
      hexInput.focus();
      hexInput.value = color.startsWith('#') ? color : '#' + color;
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));
      hexInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, hex);
  await sleep(200);

  // Press Enter to confirm
  await page.keyboard.press('Enter');
  await sleep(300);

  // Close color picker by pressing Escape
  await page.keyboard.press('Escape');
  await sleep(200);
}

// Set brush size — clicks the size text (30px) and types new value
async function setBrushSize(page, size) {
  await page.evaluate((s) => {
    // Find element showing "30px" or similar
    const allEls = Array.from(document.querySelectorAll('*'));
    const sizeEl = allEls.find(el =>
      el.children.length === 0 && /^\d+px$/.test(el.textContent.trim())
    );
    if (sizeEl) sizeEl.click();
  }, size);
  await sleep(400);

  // Try to find a size input or slider
  await page.evaluate((s) => {
    const inputs = Array.from(document.querySelectorAll('input[type="range"], input[type="number"]'));
    const sizeInput = inputs[0];
    if (sizeInput) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(sizeInput, s);
      sizeInput.dispatchEvent(new Event('input', { bubbles: true }));
      sizeInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, String(size));
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(200);
}

// Select brush type from the brush list panel
async function selectBrushType(page, brushName) {
  // Open brush panel by clicking brush tool
  await selectBrushTool(page);
  await sleep(300);

  // Click the brush name in the list
  const found = await page.evaluate((name) => {
    const items = Array.from(document.querySelectorAll('li, [class*="brush"], [class*="Brush"]'));
    const match = items.find(el => el.textContent.trim().toLowerCase() === name.toLowerCase());
    if (match) { match.click(); return true; }
    return false;
  }, brushName);

  if (!found) {
    // Try clicking any element containing the brush name
    await page.evaluate((name) => {
      const all = Array.from(document.querySelectorAll('*'));
      const match = all.find(el =>
        el.children.length === 0 &&
        el.textContent.trim().toLowerCase() === name.toLowerCase()
      );
      if (match) match.click();
    }, brushName);
  }
  await sleep(300);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function dist(a, b) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

// Take screenshot of just the canvas
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
