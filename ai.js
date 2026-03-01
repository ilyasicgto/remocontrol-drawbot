/**
 * ai.js
 * Groq API — generates artistic stroke-based drawing commands
 * Optimized for anime faces, characters, objects
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY;

const SYSTEM_PROMPT = `You are an expert drawing assistant that creates beautiful artwork using freehand brush strokes.

Canvas is 1000x1000 units. Center is (500,500). Top-left is (0,0).

You ONLY use these commands:
- { "type": "color", "hex": "#rrggbb" }
- { "type": "size", "px": N }
- { "type": "stroke", "points": [{"x":N,"y":N}, ...] }

RULES:
- NEVER use circle, rect, or line commands — only stroke
- Each stroke should have 8-30 points for smooth curves
- Use multiple strokes to build up the drawing
- Start with a color and size before each group of strokes
- Use 15-40 total commands for detailed drawings
- For anime faces: draw head outline, eyes, nose, mouth, hair as separate strokes
- For characters: draw body parts as individual curved strokes
- Make strokes flow naturally like a real artist drawing
- Use appropriate colors (skin tones, hair colors, etc.)
- Outline first with dark color size 3-5, then add details

ANIME FACE GUIDE (centered at 500,500):
- Head: oval stroke from ~(400,150) around to ~(600,150), widest at ~700 height
- Eyes: two curved strokes at y~380, x~380 and x~620
- Nose: small strokes at ~(500,480)
- Mouth: curved stroke at ~(500,560)
- Hair: flowing strokes from top of head

OUTPUT: Only a valid JSON array. No explanation. No markdown. No backticks.`;

async function generateDrawingCommands(description) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not set in environment variables');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 4000,
      temperature: 0.7,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Draw this: ${description}` },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API error: ${err}`);
  }

  const data = await response.json();
  const text = data.choices[0].message.content.trim();

  // Strip markdown fences
  const clean = text
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  let commands;
  try {
    commands = JSON.parse(clean);
  } catch (e) {
    // Try to extract JSON array from response
    const match = clean.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        commands = JSON.parse(match[0]);
      } catch (e2) {
        throw new Error(`Failed to parse AI response: ${text.substring(0, 300)}`);
      }
    } else {
      throw new Error(`No JSON array found in response: ${text.substring(0, 300)}`);
    }
  }

  if (!Array.isArray(commands)) throw new Error('AI response is not an array');

  // Filter to only allowed command types
  const allowed = ['color', 'size', 'stroke'];
  return commands.filter(cmd => allowed.includes(cmd.type));
}

module.exports = { generateDrawingCommands };
