/**
 * server.js — WebSocket server, controls browser via drawer.js
 */

const http = require('http');
const WebSocket = require('ws');
const puppeteer = require('puppeteer');
const sharp = require('sharp');
const Groq = require('groq-sdk');

const {
  drawLine, drawCircle, drawRect, drawFreeStroke,
  selectBrushTool, setColor, setBrushSize,
  undo, redo, clearCanvas, screenshotCanvas, sleep,
} = require('./drawer');
const { generateDrawingCommands } = require('./ai');

const PORT = process.env.PORT || 3000;
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

let browser = null, page = null, isReady = false, isDrawing = false;

// ── Browser init ──────────────────────────────────────────────────────────────
async function initBrowser(url) {
  if (browser) { await browser.close().catch(() => {}); browser = null; page = null; isReady = false; }
  console.log('🚀 Launching browser for:', url);
  browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--window-size=1280,900'],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  try { await page.waitForSelector('canvas.main-canvas', { timeout: 15000 }); }
  catch(e) { await page.waitForSelector('canvas', { timeout: 15000 }); }
  await sleep(2000);
  isReady = true;
  console.log('✅ Browser ready!');
}

// ── Screenshot ────────────────────────────────────────────────────────────────
async function getScreenshot() {
  const jpg = await screenshotCanvas(page);
  return Buffer.from(jpg).toString('base64');
}

// ── AI image draw via Groq vision ─────────────────────────────────────────────
async function runAIImage(base64, caption) {
  const systemPrompt = `You are a drawing bot controller. Output ONLY a JSON object with key "commands" containing an array.
Types:
- {"type":"stroke","points":[{"x":n,"y":n},...]} 
Coordinates 0-1000. Max 60 strokes. Trace main outlines only.
No markdown, only JSON.`;

  const res = await groq.chat.completions.create({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    max_tokens: 8000,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: [
        { type: 'text', text: caption },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } }
      ]}
    ]
  });

  const raw = res.choices[0].message.content.trim().replace(/```json|```/g, '');
  const parsed = JSON.parse(raw);
  return parsed.commands || parsed;
}

// ── Execute drawing commands ───────────────────────────────────────────────────
async function executeCommands(commands) {
  for (const cmd of commands) {
    switch(cmd.type) {
      case 'color':  await setColor(page, cmd.hex); break;
      case 'size':   await setBrushSize(page, cmd.px); break;
      case 'line':   await drawLine(page, cmd.x1, cmd.y1, cmd.x2, cmd.y2); break;
      case 'circle': await drawCircle(page, cmd.cx, cmd.cy, cmd.r); break;
      case 'rect':   await drawRect(page, cmd.x1, cmd.y1, cmd.x2, cmd.y2); break;
      case 'stroke': await drawFreeStroke(page, cmd.points); break;
    }
    await sleep(20);
  }
}

// ── WebSocket server ──────────────────────────────────────────────────────────
const server = http.createServer((req, res) => res.end('Parasite Server 🦠'));
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('🔌 Bot connected');

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch(e) { return; }

    const { id, type } = msg;

    // Lock for drawing operations
    if (isDrawing && ['line','circle','rect','stroke','ai','ai_image','color','size','undo','redo','clear'].includes(type)) {
      return ws.send(JSON.stringify({ id, ok: false, error: 'Already drawing' }));
    }

    try {
      switch(type) {

        case 'attach': {
          await initBrowser(msg.url);
          ws.send(JSON.stringify({ id, ok: true }));
          break;
        }

        case 'screenshot': {
          if (!isReady) throw new Error('No canvas attached');
          const data = await getScreenshot();
          ws.send(JSON.stringify({ id, ok: true, data }));
          break;
        }

        case 'line': {
          if (!isReady) throw new Error('No canvas attached');
          isDrawing = true;
          await drawLine(page, msg.x1, msg.y1, msg.x2, msg.y2);
          isDrawing = false;
          ws.send(JSON.stringify({ id, ok: true }));
          break;
        }

        case 'circle': {
          if (!isReady) throw new Error('No canvas attached');
          isDrawing = true;
          await drawCircle(page, msg.cx, msg.cy, msg.r);
          isDrawing = false;
          ws.send(JSON.stringify({ id, ok: true }));
          break;
        }

        case 'rect': {
          if (!isReady) throw new Error('No canvas attached');
          isDrawing = true;
          await drawRect(page, msg.x1, msg.y1, msg.x2, msg.y2);
          isDrawing = false;
          ws.send(JSON.stringify({ id, ok: true }));
          break;
        }

        case 'color': {
          if (!isReady) throw new Error('No canvas attached');
          await setColor(page, msg.hex);
          ws.send(JSON.stringify({ id, ok: true }));
          break;
        }

        case 'size': {
          if (!isReady) throw new Error('No canvas attached');
          await setBrushSize(page, msg.px);
          ws.send(JSON.stringify({ id, ok: true }));
          break;
        }

        case 'undo': {
          if (!isReady) throw new Error('No canvas attached');
          await undo(page);
          ws.send(JSON.stringify({ id, ok: true }));
          break;
        }

        case 'redo': {
          if (!isReady) throw new Error('No canvas attached');
          await redo(page);
          ws.send(JSON.stringify({ id, ok: true }));
          break;
        }

        case 'clear': {
          if (!isReady) throw new Error('No canvas attached');
          await clearCanvas(page);
          ws.send(JSON.stringify({ id, ok: true }));
          break;
        }

        case 'ai': {
          if (!isReady) throw new Error('No canvas attached');
          isDrawing = true;
          const commands = await generateDrawingCommands(msg.description);
          await executeCommands(commands);
          isDrawing = false;
          ws.send(JSON.stringify({ id, ok: true, count: commands.length }));
          break;
        }

        case 'ai_image': {
          if (!isReady) throw new Error('No canvas attached');
          isDrawing = true;
          const cmds = await runAIImage(msg.base64, msg.caption);
          await executeCommands(cmds);
          isDrawing = false;
          ws.send(JSON.stringify({ id, ok: true, count: cmds.length }));
          break;
        }

        default:
          ws.send(JSON.stringify({ id, ok: false, error: 'Unknown command: ' + type }));
      }
    } catch(e) {
      isDrawing = false;
      console.error('Error:', e.message);
      ws.send(JSON.stringify({ id, ok: false, error: e.message }));
    }
  });

  ws.on('close', () => console.log('🔌 Bot disconnected'));
});

server.listen(PORT, () => console.log(`🌐 Server running on :${PORT}`));

process.once('SIGINT', () => { if (browser) browser.close(); process.exit(); });
process.once('SIGTERM', () => { if (browser) browser.close(); process.exit(); });
