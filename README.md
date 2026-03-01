# 🎨 CrocoDraw Controller Bot

Control CrocoDraw canvas via Telegram commands using real mouse simulation.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Set environment variables
Copy `.env.example` to `.env` and fill in your tokens:
```
BOT_TOKEN=your_telegram_bot_token
ANTHROPIC_API_KEY=your_anthropic_key  # for /ai command
```

### 3. Run locally
```bash
node bot.js
```

### Railway deployment
Add these environment variables in Railway dashboard:
- `BOT_TOKEN`
- `ANTHROPIC_API_KEY`

---

## Commands

| Command | Description | Example |
|---|---|---|
| `/attach <url>` | Attach to CrocoDraw session | `/attach https://crocodraw.top/draw/...` |
| `/pic` | Screenshot current canvas | `/pic` |
| `/line x1 y1 x2 y2` | Draw a line | `/line 100 100 900 900` |
| `/circle cx cy r` | Draw a circle | `/circle 500 500 200` |
| `/rect x1 y1 x2 y2` | Draw a rectangle | `/rect 200 200 800 600` |
| `/stroke x1,y1 x2,y2...` | Free stroke path | `/stroke 100,100 200,150 300,200` |
| `/color #hex` | Set brush color | `/color #ff0000` |
| `/size px` | Set brush size | `/size 8` |
| `/brush name` | Select brush type | `/brush Pencil` |
| `/fill #hex x y` | Fill at position | `/fill #0000ff 500 500` |
| `/undo` | Undo last stroke | `/undo` |
| `/redo` | Redo | `/redo` |
| `/clear` | Clear canvas | `/clear` |
| `/ai description` | AI auto-draw | `/ai draw a cat` |

## Coordinates
All coordinates use 0–1000 scale:
- `0,0` = top-left corner
- `1000,1000` = bottom-right corner  
- `500,500` = center

## How it works
The bot loads CrocoDraw in a headless Puppeteer browser and simulates real mouse events on the canvas. This triggers CrocoDraw's own drawing engine and WebSocket sync — so everything you draw appears for all players in the game session.
