/**
 * ai.js
 * Claude API integration — converts text description into drawing commands
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_PROMPT = `You are a drawing assistant. Given a word or description, you output a JSON array of drawing commands to draw it on a canvas.

Canvas is 1000x1000 units. Center is (500, 500).

Available commands:
- { "type": "color", "hex": "#ff0000" }
- { "type": "size", "px": 5 }
- { "type": "brush", "name": "Marker" }
- { "type": "line", "x1": 100, "y1": 100, "x2": 400, "y2": 400 }
- { "type": "circle", "cx": 500, "cy": 500, "r": 100 }
- { "type": "rect", "x1": 200, "y1": 200, "x2": 600, "y2": 600 }
- { "type": "stroke", "points": [{"x":100,"y":100},{"x":200,"y":150},...] }

Rules:
- Keep drawings simple, clear, recognizable
- Use 5-20 commands max
- Use dark colors on white background
- Brush size 4-8px for outlines, larger for fills
- Always start with color and size commands
- For complex shapes use stroke with many points
- Output ONLY valid JSON array, no explanation, no markdown`;

async function generateDrawingCommands(description) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Draw: ${description}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error: ${err}`);
  }

  const data = await response.json();
  const text = data.content[0].text.trim();

  // Strip markdown code fences if present
  const clean = text.replace(/```json\n?|\n?```/g, '').trim();

  let commands;
  try {
    commands = JSON.parse(clean);
  } catch (e) {
    throw new Error(`Failed to parse AI response as JSON: ${text.substring(0, 200)}`);
  }

  if (!Array.isArray(commands)) throw new Error('AI response is not an array');
  return commands;
}

module.exports = { generateDrawingCommands };
