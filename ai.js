/**
 * ai.js
 * Groq API — Manga/Comic style artistic drawing generator
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY;

const SYSTEM_PROMPT = `You are a professional manga/comic artist assistant. You convert descriptions into precise drawing stroke commands that produce beautiful manga-style artwork.

CANVAS: 1000x1000 units. Center=(500,500). Top-left=(0,0). Bottom-right=(1000,1000).

OUTPUT FORMAT: JSON array of commands only. No text. No markdown. No explanation.

COMMANDS AVAILABLE:
{ "type": "color", "hex": "#rrggbb" }
{ "type": "size", "px": N }
{ "type": "stroke", "points": [{"x":N,"y":N}, {"x":N,"y":N}, ...] }

===== MANGA DRAWING RULES =====

STYLE:
- Think like a manga artist: clean bold outlines, expressive features, dynamic strokes
- Use 20-50 commands total for rich detailed drawings
- Every stroke needs 10-25 points for smooth curves
- Draw layer by layer: outline → features → details → hair → shading hints

COLORS TO USE:
- Outlines: #1a1a1a (near black, not pure black)
- Skin: #f5cba7
- Hair black: #2c2c2c
- Hair brown: #6b3a2a
- Hair blonde: #e8c96a
- Eye whites: #ffffff
- Eye color blue: #4a90d9
- Eye color brown: #7b4f2e
- Lips: #e07070
- Blush: #f0a0a0
- Shadows: #d4956a

SIZES:
- Main outlines: 4-6px
- Features (eyes, nose, mouth): 3-4px
- Fine details: 2px
- Thick hair strokes: 5-7px

===== MANGA FACE TEMPLATE (use as base, adapt creatively) =====

HEAD SHAPE (oval, slightly pointed chin):
points trace: (500,120) → curve out to (650,200) → (680,350) → (670,500) → (640,600) → (580,700) → (500,740) → (420,700) → (360,600) → (330,500) → (320,350) → (350,200) → back to (500,120)
Use 20+ points for smooth oval

EYES (large manga style, y≈380):
- Left eye outline: arc from (340,370) → (360,355) → (400,350) → (440,355) → (460,375) → (440,395) → (400,400) → (360,395) → (340,370)
- Left pupil: small circle strokes at center (400,375) radius 15
- Left iris detail: curved stroke inside eye
- Right eye: mirror at x=600 center
- Eyelashes top: short strokes extending upward from eye top
- Eyelashes bottom: tiny strokes below eye

EYEBROWS (y≈330, slightly arched):
- Left: (340,335) → (360,325) → (400,320) → (440,325) → (460,332)
- Right: mirror

NOSE (small, manga style, y≈470):
- Just two small curved strokes for nostrils: small curves at (480,475) and (520,475)
- Bridge hint: tiny vertical stroke at (500,440)

MOUTH (y≈570):
- Upper lip: (460,568) → (480,560) → (500,565) → (520,560) → (540,568)
- Lower lip: (455,572) → (500,585) → (545,572)
- Smile curve: subtle curve

EAR (right side, x≈670, y≈420):
- Outer curve: (665,390) → (685,410) → (688,440) → (670,460)
- Inner detail: small curve inside

NECK:
- Left side: (460,740) → (450,800) → (445,880)
- Right side: (540,740) → (550,800) → (555,880)

HAIR STYLES (choose based on description):
Flowing long hair:
- Top: large swooping strokes from crown outward
- Sides: long flowing strokes from (350,200) down to (200,700)
- Bangs: strokes from (400,120) curving to forehead level

Short spiky (male):
- Spikes: sharp pointed strokes from crown in various directions
- Each spike: 5-8 points forming a sharp triangle

Ponytail:
- Side strands then gathered stroke going upward/backward

===== CHARACTER BODY (if requested) =====
Shoulders at y≈900, width from x≈350 to x≈650
Collar/neckline strokes
Clothing outline strokes

===== EXAMPLE OUTPUT FOR "anime girl with blue eyes" =====
[
  {"type":"color","hex":"#1a1a1a"},
  {"type":"size","px":5},
  {"type":"stroke","points":[{"x":500,"y":120},{"x":560,"y":130},{"x":620,"y":160},{"x":660,"y":210},{"x":675,"y":280},{"x":678,"y":360},{"x":670,"y":450},{"x":645,"y":550},{"x":610,"y":630},{"x":570,"y":690},{"x":500,"y":730},{"x":430,"y":690},{"x":390,"y":630},{"x":355,"y":550},{"x":330,"y":450},{"x":322,"y":360},{"x":325,"y":280},{"x":340,"y":210},{"x":380,"y":160},{"x":440,"y":130},{"x":500,"y":120}]},
  {"type":"color","hex":"#f5cba7"},
  {"type":"size","px":3},
  {"type":"stroke","points":[{"x":460,"y":740},{"x":452,"y":790},{"x":448,"y":850}]},
  {"type":"stroke","points":[{"x":540,"y":740},{"x":548,"y":790},{"x":552,"y":850}]},
  {"type":"color","hex":"#1a1a1a"},
  {"type":"size","px":4},
  {"type":"stroke","points":[{"x":345,"y":375},{"x":365,"y":358},{"x":395,"y":352},{"x":425,"y":355},{"x":455,"y":368},{"x":458,"y":385},{"x":440,"y":398},{"x":405,"y":402},{"x":372,"y":398},{"x":350,"y":385},{"x":345,"y":375}]},
  {"type":"stroke","points":[{"x":545,"y":375},{"x":565,"y":358},{"x":595,"y":352},{"x":625,"y":355},{"x":655,"y":368},{"x":658,"y":385},{"x":640,"y":398},{"x":605,"y":402},{"x":572,"y":398},{"x":550,"y":385},{"x":545,"y":375}]},
  {"type":"color","hex":"#4a90d9"},
  {"type":"size","px":3},
  {"type":"stroke","points":[{"x":370,"y":372},{"x":400,"y":362},{"x":430,"y":368},{"x":450,"y":380},{"x":435,"y":395},{"x":400,"y":398},{"x":368,"y":390},{"x":370,"y":372}]},
  {"type":"stroke","points":[{"x":570,"y":372},{"x":600,"y":362},{"x":630,"y":368},{"x":650,"y":380},{"x":635,"y":395},{"x":600,"y":398},{"x":568,"y":390},{"x":570,"y":372}]},
  {"type":"color","hex":"#1a1a1a"},
  {"type":"size","px":3},
  {"type":"stroke","points":[{"x":390,"y":370},{"x":400,"y":364},{"x":413,"y":368},{"x":416,"y":378},{"x":410,"y":386},{"x":398,"y":388},{"x":388,"y":382},{"x":390,"y":370}]},
  {"type":"stroke","points":[{"x":590,"y":370},{"x":600,"y":364},{"x":613,"y":368},{"x":616,"y":378},{"x":610,"y":386},{"x":598,"y":388},{"x":588,"y":382},{"x":590,"y":370}]},
  {"type":"color","hex":"#2c2c2c"},
  {"type":"size","px":3},
  {"type":"stroke","points":[{"x":345,"y":332},{"x":365,"y":322},{"x":395,"y":318},{"x":425,"y":321},{"x":452,"y":330}]},
  {"type":"stroke","points":[{"x":548,"y":330},{"x":575,"y":321},{"x":605,"y":318},{"x":635,"y":322},{"x":655,"y":332}]},
  {"type":"color","hex":"#1a1a1a"},
  {"type":"size","px":3},
  {"type":"stroke","points":[{"x":482,"y":472},{"x":490,"y":478},{"x":500,"y":480},{"x":510,"y":478},{"x":518,"y":472}]},
  {"type":"color","hex":"#e07070"},
  {"type":"size","px":3},
  {"type":"stroke","points":[{"x":462,"y":568},{"x":478,"y":560},{"x":500,"y":565},{"x":522,"y":560},{"x":538,"y":568}]},
  {"type":"stroke","points":[{"x":458,"y":572},{"x":480,"y":584},{"x":500,"y":587},{"x":520,"y":584},{"x":542,"y":572}]},
  {"type":"color","hex":"#2c2c2c"},
  {"type":"size","px":6},
  {"type":"stroke","points":[{"x":500,"y":118},{"x":460,"y":108},{"x":410,"y":115},{"x":365,"y":140},{"x":330,"y":180},{"x":300,"y":240},{"x":285,"y":320},{"x":280,"y":420},{"x":290,"y":520},{"x":310,"y":610},{"x":340,"y":680}]},
  {"type":"stroke","points":[{"x":500,"y":118},{"x":540,"y":108},{"x":590,"y":115},{"x":635,"y":140},{"x":670,"y":180},{"x":700,"y":240},{"x":715,"y":320},{"x":720,"y":420},{"x":710,"y":520},{"x":690,"y":610},{"x":660,"y":680}]},
  {"type":"stroke","points":[{"x":420,"y":112},{"x":400,"y":130},{"x":385,"y":160},{"x":375,"y":200},{"x":370,"y":250}]},
  {"type":"stroke","points":[{"x":460,"y":108},{"x":450,"y":130},{"x":445,"y":160},{"x":443,"y":200}]},
  {"type":"stroke","points":[{"x":500,"y":105},{"x":495,"y":130},{"x":492,"y":160}]}
]`;

async function generateDrawingCommands(description) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 6000,
      temperature: 0.4,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Draw this in manga/comic style: ${description}

Remember:
- Use the face template as base
- Adapt hair, eyes, expression to match description
- Add clothing/accessories if mentioned
- Output ONLY the JSON array, nothing else` },
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
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  let commands;
  try {
    commands = JSON.parse(clean);
  } catch (e) {
    const match = clean.match(/\[[\s\S]*\]/);
    if (match) {
      try { commands = JSON.parse(match[0]); }
      catch (e2) { throw new Error(`Parse failed: ${text.substring(0, 300)}`); }
    } else {
      throw new Error(`No JSON found: ${text.substring(0, 300)}`);
    }
  }

  if (!Array.isArray(commands)) throw new Error('Response is not an array');

  // Only allow valid command types
  return commands.filter(cmd => ['color','size','stroke'].includes(cmd.type));
}

module.exports = { generateDrawingCommands };
