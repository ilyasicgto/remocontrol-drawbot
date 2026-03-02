/**
 * ai.js
 * Manga drawing using hardcoded SVG-based templates + Groq for style selection
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ── SVG path to points converter ───────────────────────────────────────────────
function sampleBezier(p0, p1, p2, p3, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push({
      x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
      y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y,
    });
  }
  return pts;
}

function sampleQuad(p0, p1, p2, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push({
      x: u*u*p0.x + 2*u*t*p1.x + t*t*p2.x,
      y: u*u*p0.y + 2*u*t*p1.y + t*t*p2.y,
    });
  }
  return pts;
}

function ellipsePoints(cx, cy, rx, ry, startAngle, endAngle, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = startAngle + (endAngle - startAngle) * (i / steps);
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return pts;
}

// ── MANGA TEMPLATE LIBRARY ─────────────────────────────────────────────────────

const TEMPLATES = {

  // ── HEAD ──────────────────────────────────────────────────────────────────────
  head_female: () => {
    // Smooth oval with pointed chin
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
      let rx = 165, ry = 195;
      // Narrow bottom for chin
      if (a > 0.3 && a < Math.PI - 0.3) ry = 210;
      const chinFactor = Math.pow(Math.max(0, Math.sin(a)), 0.6);
      pts.push({
        x: 500 + Math.cos(a) * rx,
        y: 370 + Math.sin(a) * ry * (a > 0 && a < Math.PI ? 1 + chinFactor * 0.15 : 1),
      });
    }
    return pts;
  },

  head_male: () => {
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
      pts.push({
        x: 500 + Math.cos(a) * 175,
        y: 370 + Math.sin(a) * 200,
      });
    }
    return pts;
  },

  head_child: () => {
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
      pts.push({
        x: 500 + Math.cos(a) * 185,
        y: 350 + Math.sin(a) * 175,
      });
    }
    return pts;
  },

  // ── EYES ──────────────────────────────────────────────────────────────────────
  eye_left_female: () => ellipsePoints(390, 370, 62, 38, 0, Math.PI * 2, 40),
  eye_right_female: () => ellipsePoints(610, 370, 62, 38, 0, Math.PI * 2, 40),

  eye_left_male: () => {
    // More angular male eye
    return [
      {x:330,y:375},{x:350,y:360},{x:380,y:352},{x:415,y:353},
      {x:448,y:360},{x:460,y:375},{x:448,y:388},{x:415,y:395},
      {x:380,y:394},{x:350,y:388},{x:330,y:375}
    ];
  },
  eye_right_male: () => {
    return [
      {x:540,y:375},{x:552,y:360},{x:585,y:352},{x:620,y:353},
      {x:650,y:360},{x:670,y:375},{x:650,y:388},{x:620,y:395},
      {x:585,y:394},{x:552,y:388},{x:540,y:375}
    ];
  },

  // Upper eyelid — thick line on top
  eyelid_left: () => [
    {x:328,y:372},{x:345,y:358},{x:370,y:349},{x:395,y:346},
    {x:420,y:349},{x:445,y:358},{x:460,y:372}
  ],
  eyelid_right: () => [
    {x:540,y:372},{x:555,y:358},{x:580,y:349},{x:605,y:346},
    {x:630,y:349},{x:655,y:358},{x:672,y:372}
  ],

  // Iris
  iris_left:  () => ellipsePoints(390, 373, 28, 28, 0, Math.PI*2, 30),
  iris_right: () => ellipsePoints(610, 373, 28, 28, 0, Math.PI*2, 30),

  // Pupil
  pupil_left:  () => ellipsePoints(390, 373, 14, 14, 0, Math.PI*2, 20),
  pupil_right: () => ellipsePoints(610, 373, 14, 14, 0, Math.PI*2, 20),

  // Shine dot
  shine_left:  () => ellipsePoints(378, 362, 7, 7, 0, Math.PI*2, 12),
  shine_right: () => ellipsePoints(598, 362, 7, 7, 0, Math.PI*2, 12),

  // Eyelashes top left
  lashes_top_left: () => {
    const lashes = [];
    const positions = [[340,362,-15,-12],[358,352,-8,-14],[378,347,0,-15],[398,346,5,-15],[418,349,10,-13],[440,356,12,-10]];
    return positions.reduce((acc,[x,y,dx,dy]) => {
      acc.push(...[{x,y},{x:x+dx,y:y+dy},{x,y}]);
      return acc;
    }, []);
  },
  lashes_top_right: () => {
    const positions = [[560,356,-12,-10],[582,349,-10,-13],[602,346,-5,-15],[622,347,0,-15],[642,352,8,-14],[660,362,15,-12]];
    return positions.reduce((acc,[x,y,dx,dy]) => {
      acc.push(...[{x,y},{x:x+dx,y:y+dy},{x,y}]);
      return acc;
    }, []);
  },

  // ── EYEBROWS ──────────────────────────────────────────────────────────────────
  brow_left_female: () => sampleQuad(
    {x:330,y:325}, {x:392,y:305}, {x:455,y:322}, 20
  ),
  brow_right_female: () => sampleQuad(
    {x:545,y:322}, {x:608,y:305}, {x:670,y:325}, 20
  ),
  brow_left_male: () => [
    {x:325,y:332},{x:345,y:320},{x:375,y:314},{x:415,y:315},{x:455,y:324}
  ],
  brow_right_male: () => [
    {x:545,y:324},{x:585,y:315},{x:625,y:314},{x:655,y:320},{x:675,y:332}
  ],

  // ── NOSE ──────────────────────────────────────────────────────────────────────
  nose_female: () => [
    // Just a tiny cute button nose
    {x:488,y:455},{x:484,y:468},{x:482,y:478},
    {x:490,y:483},{x:500,y:484},{x:510,y:483},
    {x:518,y:478},{x:516,y:468},{x:512,y:455}
  ],
  nose_male: () => [
    {x:480,y:448},{x:474,y:462},{x:472,y:476},
    {x:482,y:485},{x:500,y:487},{x:518,y:485},
    {x:528,y:476},{x:526,y:462},{x:520,y:448}
  ],

  // ── MOUTH ─────────────────────────────────────────────────────────────────────
  mouth_smile: () => {
    const upper = sampleQuad({x:460,y:562}, {x:500,y:552}, {x:540,y:562}, 16);
    const lower = sampleBezier({x:455,y:566}, {x:480,y:585}, {x:520,y:585}, {x:545,y:566}, 16);
    return [...upper, ...lower.slice(1)];
  },
  mouth_neutral: () => {
    const upper = sampleQuad({x:462,y:564}, {x:500,y:558}, {x:538,y:564}, 16);
    const lower = sampleQuad({x:460,y:568}, {x:500,y:578}, {x:540,y:568}, 16);
    return [...upper, ...lower.slice(1)];
  },
  mouth_open_happy: () => {
    const outer = sampleBezier({x:455,y:562}, {x:480,y:555}, {x:520,y:555}, {x:545,y:562}, 16);
    const lower = sampleBezier({x:455,y:566}, {x:478,y:595}, {x:522,y:595}, {x:545,y:566}, 16);
    return [...outer, ...lower.slice(1)];
  },
  mouth_serious: () => [
    {x:465,y:565},{x:482,y:562},{x:500,y:561},{x:518,y:562},{x:535,y:565}
  ],

  // ── EAR ───────────────────────────────────────────────────────────────────────
  ear_right: () => [
    {x:663,y:345},{x:678,y:355},{x:688,y:375},{x:692,y:400},
    {x:690,y:425},{x:682,y:448},{x:668,y:460},{x:655,y:455}
  ],
  ear_left: () => [
    {x:337,y:345},{x:322,y:355},{x:312,y:375},{x:308,y:400},
    {x:310,y:425},{x:318,y:448},{x:332,y:460},{x:345,y:455}
  ],

  // ── NECK ──────────────────────────────────────────────────────────────────────
  neck_left:  () => [{x:458,y:555},{x:452,y:620},{x:448,y:700},{x:445,y:780}],
  neck_right: () => [{x:542,y:555},{x:548,y:620},{x:552,y:700},{x:555,y:780}],

  // ── HAIR STYLES ───────────────────────────────────────────────────────────────
  hair_long_left: () => {
    const pts = [];
    const ctrl = [{x:340,y:170},{x:290,y:280},{x:260,y:420},{x:240,y:570},{x:230,y:700},{x:235,y:820}];
    for (let i = 0; i < ctrl.length-1; i++) {
      for (let t = 0; t <= 8; t++) {
        pts.push({
          x: ctrl[i].x + (ctrl[i+1].x-ctrl[i].x)*t/8,
          y: ctrl[i].y + (ctrl[i+1].y-ctrl[i].y)*t/8,
        });
      }
    }
    return pts;
  },
  hair_long_right: () => {
    const pts = [];
    const ctrl = [{x:660,y:170},{x:710,y:280},{x:740,y:420},{x:760,y:570},{x:770,y:700},{x:765,y:820}];
    for (let i = 0; i < ctrl.length-1; i++) {
      for (let t = 0; t <= 8; t++) {
        pts.push({
          x: ctrl[i].x + (ctrl[i+1].x-ctrl[i].x)*t/8,
          y: ctrl[i].y + (ctrl[i+1].y-ctrl[i].y)*t/8,
        });
      }
    }
    return pts;
  },
  hair_top_female: () => {
    const pts = [];
    for (let i = 0; i <= 30; i++) {
      const a = Math.PI + (i/30)*Math.PI;
      pts.push({ x: 500 + Math.cos(a)*170, y: 175 + Math.sin(a)*80 });
    }
    return pts;
  },
  hair_bangs_center: () => [
    {x:390,y:175},{x:400,y:210},{x:405,y:250},{x:410,y:290},{x:415,y:310},
    {x:430,y:295},{x:445,y:270},{x:455,y:245},{x:465,y:220},
    {x:478,y:215},{x:500,y:210},{x:522,y:215},
    {x:535,y:220},{x:545,y:245},{x:555,y:270},{x:570,y:295},
    {x:585,y:310},{x:590,y:290},{x:595,y:250},{x:600,y:210},{x:610,y:175}
  ],
  hair_bangs_side_left: () => [
    {x:335,y:185},{x:325,y:220},{x:318,y:260},{x:315,y:300},{x:318,y:335},
    {x:328,y:360},{x:342,y:375}
  ],
  hair_bangs_side_right: () => [
    {x:665,y:185},{x:675,y:220},{x:682,y:260},{x:685,y:300},{x:682,y:335},
    {x:672,y:360},{x:658,y:375}
  ],

  // Spiky male hair
  hair_spiky_top: () => {
    const spikes = [
      // Each spike: base-left, tip, base-right
      [{x:420,y:180},{x:400,y:100},{x:445,y:178}],
      [{x:455,y:172},{x:445,y:90},{x:480,y:170}],
      [{x:485,y:168},{x:490,y:82},{x:515,y:168}],
      [{x:518,y:170},{x:530,y:90},{x:548,y:172}],
      [{x:548,y:172},{x:570,y:100},{x:578,y:180}],
    ];
    return spikes.reduce((acc, s) => [...acc, s[0], s[1], s[2]], []);
  },
  hair_spiky_sides: () => [
    {x:335,y:175},{x:308,y:220},{x:295,y:275},{x:298,y:330},
    {x:308,y:370},{x:322,y:395},
  ],

  // Short bob
  hair_bob_left: () => [
    {x:338,y:175},{x:318,y:220},{x:308,y:290},{x:312,y:370},
    {x:325,y:440},{x:345,y:490},{x:370,y:520},{x:405,y:535}
  ],
  hair_bob_right: () => [
    {x:662,y:175},{x:682,y:220},{x:692,y:290},{x:688,y:370},
    {x:675,y:440},{x:655,y:490},{x:630,y:520},{x:595,y:535}
  ],
  hair_bob_bottom: () => [
    {x:405,y:535},{x:440,y:545},{x:470,y:548},{x:500,y:549},
    {x:530,y:548},{x:560,y:545},{x:595,y:535}
  ],

  // ── SHOULDERS / BODY ──────────────────────────────────────────────────────────
  shoulders_female: () => [
    {x:340,y:800},{x:320,y:830},{x:310,y:870},{x:310,y:920},
    {x:360,y:950},{x:430,y:965},{x:500,y:968},
    {x:570,y:965},{x:640,y:950},{x:690,y:920},
    {x:690,y:870},{x:680,y:830},{x:660,y:800}
  ],
  shoulders_male: () => [
    {x:310,y:790},{x:280,y:830},{x:265,y:880},{x:268,y:940},
    {x:340,y:968},{x:420,y:978},{x:500,y:980},
    {x:580,y:978},{x:660,y:968},{x:732,y:940},
    {x:735,y:880},{x:720,y:830},{x:690,y:790}
  ],

  // ── BLUSH ─────────────────────────────────────────────────────────────────────
  blush_left:  () => ellipsePoints(348, 420, 42, 18, 0, Math.PI*2, 20),
  blush_right: () => ellipsePoints(652, 420, 42, 18, 0, Math.PI*2, 20),
};

// ── COLOR PALETTES ─────────────────────────────────────────────────────────────
const COLORS = {
  outline:      '#1a1a1a',
  skin_light:   '#f5cba7',
  skin_medium:  '#e0a882',
  skin_dark:    '#c47b50',
  hair_black:   '#2c2c2c',
  hair_brown:   '#5c3317',
  hair_dark_brown: '#3d2008',
  hair_blonde:  '#d4a017',
  hair_light_blonde: '#f0d060',
  hair_red:     '#c0392b',
  hair_pink:    '#e8829a',
  hair_blue:    '#3a6fc4',
  hair_white:   '#e8e8e8',
  hair_silver:  '#b0b8c8',
  hair_purple:  '#7b3fa0',
  eye_blue:     '#3a7bd5',
  eye_green:    '#2e8b57',
  eye_brown:    '#6b3a2a',
  eye_red:      '#c0392b',
  eye_purple:   '#8e44ad',
  eye_teal:     '#16a085',
  eye_gold:     '#d4ac0d',
  eye_gray:     '#7f8c8d',
  iris_shadow:  '#1a3a6a',
  pupil:        '#0d0d0d',
  shine:        '#ffffff',
  lips_pink:    '#e07070',
  lips_red:     '#c0392b',
  lips_natural: '#d4856a',
  blush:        '#f0a0a0',
  blush_light:  '#f5c5c5',
  shirt_white:  '#f0f0f0',
  shirt_dark:   '#2c3e50',
};

// ── COMMAND BUILDER ────────────────────────────────────────────────────────────
function cmd_color(hex) { return { type:'color', hex }; }
function cmd_size(px)   { return { type:'size', px }; }
function cmd_stroke(points) { return { type:'stroke', points: points.map(p=>({x:Math.round(p.x),y:Math.round(p.y)})) }; }

// ── DRAWING RECIPES ────────────────────────────────────────────────────────────

function draw_face_base(gender, skinColor) {
  const headFn = gender === 'male' ? 'head_male' : gender === 'child' ? 'head_child' : 'head_female';
  return [
    cmd_color(COLORS.outline), cmd_size(5),
    cmd_stroke(TEMPLATES[headFn]()),
    cmd_color(COLORS[skinColor] || COLORS.skin_light), cmd_size(3),
    cmd_stroke(TEMPLATES.neck_left()),
    cmd_stroke(TEMPLATES.neck_right()),
    cmd_color(COLORS.outline), cmd_size(4),
    cmd_stroke(TEMPLATES.ear_left()),
    cmd_stroke(TEMPLATES.ear_right()),
  ];
}

function draw_eyes(gender, eyeColor) {
  const isMale = gender === 'male';
  const eyeL = isMale ? 'eye_left_male' : 'eye_left_female';
  const eyeR = isMale ? 'eye_right_male' : 'eye_right_female';
  const browL = isMale ? 'brow_left_male' : 'brow_left_female';
  const browR = isMale ? 'brow_right_male' : 'brow_right_female';
  const ec = COLORS[`eye_${eyeColor}`] || COLORS.eye_blue;

  const cmds = [
    // Eye whites
    cmd_color('#f8f8f8'), cmd_size(2),
    cmd_stroke(TEMPLATES[eyeL]()),
    cmd_stroke(TEMPLATES[eyeR]()),
    // Iris
    cmd_color(ec), cmd_size(3),
    cmd_stroke(TEMPLATES.iris_left()),
    cmd_stroke(TEMPLATES.iris_right()),
    // Pupil
    cmd_color(COLORS.pupil), cmd_size(2),
    cmd_stroke(TEMPLATES.pupil_left()),
    cmd_stroke(TEMPLATES.pupil_right()),
    // Shine
    cmd_color(COLORS.shine), cmd_size(2),
    cmd_stroke(TEMPLATES.shine_left()),
    cmd_stroke(TEMPLATES.shine_right()),
    // Outlines + eyelid
    cmd_color(COLORS.outline), cmd_size(4),
    cmd_stroke(TEMPLATES[eyeL]()),
    cmd_stroke(TEMPLATES[eyeR]()),
    cmd_size(5),
    cmd_stroke(TEMPLATES.eyelid_left()),
    cmd_stroke(TEMPLATES.eyelid_right()),
  ];

  if (!isMale) {
    cmds.push(
      cmd_color(COLORS.outline), cmd_size(2),
      cmd_stroke(TEMPLATES.lashes_top_left()),
      cmd_stroke(TEMPLATES.lashes_top_right()),
    );
  }

  // Eyebrows
  cmds.push(
    cmd_color(COLORS.outline), cmd_size(isMale ? 5 : 4),
    cmd_stroke(TEMPLATES[browL]()),
    cmd_stroke(TEMPLATES[browR]()),
  );

  return cmds;
}

function draw_nose_mouth(gender, expression) {
  const noseFn = gender === 'male' ? 'nose_male' : 'nose_female';
  const mouthFn = expression === 'happy' ? 'mouth_open_happy'
    : expression === 'neutral' || expression === 'serious' ? 'mouth_serious'
    : 'mouth_smile';

  return [
    cmd_color(COLORS.outline), cmd_size(3),
    cmd_stroke(TEMPLATES[noseFn]()),
    cmd_color(COLORS.lips_pink), cmd_size(3),
    cmd_stroke(TEMPLATES[mouthFn]()),
    cmd_color(COLORS.outline), cmd_size(2),
    cmd_stroke(TEMPLATES[mouthFn]()),
  ];
}

function draw_hair(style, hairColor) {
  const hc = COLORS[`hair_${hairColor}`] || COLORS.hair_black;
  const cmds = [cmd_color(hc)];

  switch (style) {
    case 'long':
      cmds.push(
        cmd_size(7), cmd_stroke(TEMPLATES.hair_long_left()),
        cmd_stroke(TEMPLATES.hair_long_right()),
        cmd_size(6), cmd_stroke(TEMPLATES.hair_top_female()),
        cmd_size(5), cmd_stroke(TEMPLATES.hair_bangs_center()),
        cmd_stroke(TEMPLATES.hair_bangs_side_left()),
        cmd_stroke(TEMPLATES.hair_bangs_side_right()),
      );
      break;
    case 'spiky':
      cmds.push(
        cmd_size(5), cmd_stroke(TEMPLATES.hair_spiky_top()),
        cmd_stroke(TEMPLATES.hair_spiky_sides()),
        cmd_stroke(TEMPLATES.hair_top_female()),
      );
      break;
    case 'bob':
    case 'short':
      cmds.push(
        cmd_size(6), cmd_stroke(TEMPLATES.hair_bob_left()),
        cmd_stroke(TEMPLATES.hair_bob_right()),
        cmd_stroke(TEMPLATES.hair_bob_bottom()),
        cmd_size(5), cmd_stroke(TEMPLATES.hair_bangs_center()),
      );
      break;
    default: // medium
      cmds.push(
        cmd_size(6), cmd_stroke(TEMPLATES.hair_top_female()),
        cmd_stroke(TEMPLATES.hair_bangs_center()),
        cmd_stroke(TEMPLATES.hair_bangs_side_left()),
        cmd_stroke(TEMPLATES.hair_bangs_side_right()),
      );
  }

  // Outline over hair
  cmds.push(cmd_color(COLORS.outline), cmd_size(2));
  return cmds;
}

function draw_blush() {
  return [
    cmd_color(COLORS.blush_light), cmd_size(8),
    cmd_stroke(TEMPLATES.blush_left()),
    cmd_stroke(TEMPLATES.blush_right()),
  ];
}

function draw_body(gender) {
  const fn = gender === 'male' ? 'shoulders_male' : 'shoulders_female';
  return [
    cmd_color(COLORS.outline), cmd_size(4),
    cmd_stroke(TEMPLATES[fn]()),
  ];
}

// ── FULL CHARACTER BUILDER ─────────────────────────────────────────────────────
function buildCharacter(options) {
  const {
    gender = 'female',
    hairStyle = 'long',
    hairColor = 'black',
    eyeColor = 'blue',
    expression = 'smile',
    skin = 'skin_light',
    blush = true,
    body = true,
  } = options;

  const commands = [];

  // 1. Body/shoulders first (behind everything)
  if (body) commands.push(...draw_body(gender));

  // 2. Head base + neck
  commands.push(...draw_face_base(gender, skin));

  // 3. Hair (back layer — drawn before face features)
  commands.push(...draw_hair(hairStyle, hairColor));

  // 4. Re-draw head outline on top of hair
  const headFn = gender === 'male' ? 'head_male' : 'head_female';
  commands.push(cmd_color(COLORS.outline), cmd_size(5), cmd_stroke(TEMPLATES[headFn]()));

  // 5. Eyes
  commands.push(...draw_eyes(gender, eyeColor));

  // 6. Nose + mouth
  commands.push(...draw_nose_mouth(gender, expression));

  // 7. Blush
  if (blush) commands.push(...draw_blush());

  return commands;
}

// ── GROQ: parse description into options ──────────────────────────────────────
async function parseDescription(description) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-maverick-17b-128e-instruct',
      max_tokens: 300,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: `Extract drawing options from description. Output ONLY valid JSON, no explanation.

Options to extract:
- gender: "female" | "male" | "child"
- hairStyle: "long" | "short" | "bob" | "spiky" | "medium"
- hairColor: "black" | "brown" | "dark_brown" | "blonde" | "light_blonde" | "red" | "pink" | "blue" | "white" | "silver" | "purple"
- eyeColor: "blue" | "green" | "brown" | "red" | "purple" | "teal" | "gold" | "gray"
- expression: "smile" | "happy" | "neutral" | "serious"
- skin: "skin_light" | "skin_medium" | "skin_dark"
- blush: true | false
- body: true | false

Default: female, long, black, blue, smile, skin_light, true, true`
        },
        { role: 'user', content: description }
      ],
    }),
  });

  const data = await response.json();
  const text = data.choices[0].message.content.trim();
  const clean = text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
  try { return JSON.parse(clean); }
  catch(e) { return {}; } // use defaults
}

// ── MAIN EXPORT ────────────────────────────────────────────────────────────────
async function generateDrawingCommands(description) {
  const options = await parseDescription(description);
  console.log('🎨 Drawing options:', JSON.stringify(options));
  return buildCharacter(options);
}

module.exports = { generateDrawingCommands };
