/**
 * Generates the character sheets in public/sprites/: player.png, the sprite
 * of the player def in packages/sim/src/features/player/defs.ts, and the
 * layer sheets the client builds each look from: one body sheet per body
 * type and one hair sheet per hairstyle (LAYER_SHEETS, ADR 0017).
 *
 * The sheet is painted in the template colours of TEMPLATE_PALETTE: the
 * client swaps each of them for a colour it derives from the skin, hair and
 * clothes colours a player picked (src/render/characterSheet.ts, whose
 * TEMPLATE_COLORS must match; the generator's test checks it), so those must
 * not be used for anything else in the figure.
 *
 * Four rows (down, up, left, right) of four 32x48 frames. Frame 0 of each row
 * is the idle pose; the walk cycle plays the whole row: stand, left step,
 * passing pose (body two pixels taller), right step. The frame layout must
 * match the def's `sprite`.
 *
 * Each frame is painted in two layers: the body (legs, torso, arms, the face
 * with its eyebrows) and the hair above it. The skull under the hair is
 * painted whole in skin, so any hair layer can go over it; the outline goes
 * around both layers together. Body types differ in build (shoulders, waist,
 * hips) and in lashes; hairstyles in the hair layer only.
 *
 * The head is drawn as stencils, one character per pixel (see STENCIL_KEYS),
 * so the art reads as it looks. Light comes from the left: every material is
 * darker on its right edge and the hair and shirt carry a highlight.
 *
 * Plain Node, no dependencies: the figure is painted into an RGBA buffer and
 * written as a PNG by the small encoder at the bottom.
 *
 *   node tools/generate-player-sheet.mjs                # writes the sheet into public/sprites/
 *   node tools/generate-player-sheet.mjs --out <dir>    # writes it somewhere else (used by verifications)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { blit, blitOpaque, createCanvas, outline, pixel } from './pixelCanvas.mjs';

export const FRAME_WIDTH = 32;
export const FRAME_HEIGHT = 48;
export const DIRECTIONS = ['down', 'up', 'left', 'right'];
export const FRAMES_PER_DIRECTION = 4;

/** Sprite key of the player def: the sheet is written as `<key>.png`. */
export const PLAYER_SHEET_KEY = 'player';

/** Colours the client never swaps. */
export const FIXED_PALETTE = {
  outline: [0x1f, 0x1a, 0x17],
  eye: [0x14, 0x12, 0x1a],
  eyeShine: [0xff, 0xff, 0xff],
  shoe: [0x1f, 0x29, 0x37],
  shoeLight: [0x2f, 0x3b, 0x4c],
  pants: [0x37, 0x41, 0x51],
  pantsShade: [0x26, 0x2d, 0x3a],
};

/**
 * Colours the client swaps for a player's look. Each part has one colour a
 * player picks (`skin`, `hair`, `shirt`); the others are its shade and
 * highlight, which the client derives from the picked colour. The template's
 * own shades are derived from its base colours the same way.
 */
export const TEMPLATE_PALETTE = {
  skin: [0xf1, 0xc2, 0x7d],
  skinShade: [0xb5, 0x92, 0x5e],
  hair: [0x6b, 0x3e, 0x1e],
  hairShade: [0x50, 0x2f, 0x17],
  hairLight: [0x9a, 0x64, 0x3e],
  shirt: [0x3b, 0x82, 0xf6],
  shirtShade: [0x2c, 0x62, 0xb9],
  shirtLight: [0x60, 0xb6, 0xff],
};

/** The colour each stencil character paints; `.` leaves the pixel as it is. */
const STENCIL_KEYS = {
  s: 'skin',
  S: 'skinShade',
  b: 'hairShade', // eyebrows
  e: 'eye',
  w: 'eyeShine',
  h: 'hair',
  H: 'hairShade',
  l: 'hairLight',
  c: 'shirt',
  C: 'shirtShade',
  L: 'shirtLight',
  p: 'pants',
  P: 'pantsShade',
  o: 'shoe',
  q: 'shoeLight',
};

/** How the body is posed in each of the four frames of a row. `forwardLeg` is from the character's point of view. */
export const POSES = [
  { bob: 0, forwardLeg: null },
  { bob: 0, forwardLeg: 'left' },
  { bob: -2, forwardLeg: null },
  { bob: 0, forwardLeg: 'right' },
];

/**
 * The body types and hairstyles, by the name the sim's `characterShapes`
 * gives them, each with the sprite key its layer sheet is written under (the
 * `sheet` of the sim's entry; the generator's test checks they agree).
 */
export const LAYER_SHEETS = {
  body: { straight: 'player-body-straight', curvy: 'player-body-curvy' },
  hairStyle: { short: 'player-hair-short', long: 'player-hair-long', 'tied back': 'player-hair-tied-back' },
};

/** The whole sheet as RGBA bytes, rows top to bottom: a body type with a hairstyle, outlined together. The default is what `player.png` holds. */
export function paintPlayerSheet({ body: bodyType = 'straight', hairStyle = 'short' } = {}) {
  const sheet = createCanvas(FRAME_WIDTH * FRAMES_PER_DIRECTION, FRAME_HEIGHT * DIRECTIONS.length);
  DIRECTIONS.forEach((direction, row) => {
    POSES.forEach((pose, column) => {
      const { body, hair } = paintFrameLayers(direction, pose, { body: bodyType, hairStyle });
      const frame = createCanvas(FRAME_WIDTH, FRAME_HEIGHT);
      blitOpaque(frame, body);
      blitOpaque(frame, hair);
      outline(frame, FIXED_PALETTE.outline);
      blit(sheet, frame, column * FRAME_WIDTH, row * FRAME_HEIGHT);
    });
  });
  return sheet;
}

/** Last row of the figure. Its outline takes the row below; the rows under it stay clear. */
const FEET_ROW = 43;
/** First column of the head stencils, which are 18 wide: the 16-pixel skull plus a column each side for a nose in profile. */
const HEAD_LEFT = 7;

/**
 * One frame's two layers, unoutlined, each the size of a frame: the body of
 * a body type, and the hair of a hairstyle that goes over it. Any hairstyle
 * goes on any body: the hair is placed by the head, which every body type
 * carries in the same place.
 */
export function paintFrameLayers(direction, pose, { body: bodyType = 'straight', hairStyle = 'short' } = {}) {
  const build = BODY_TYPES[bodyType];
  const hairStencils = HAIR_STYLES[hairStyle];
  if (!build) throw new Error(`no body type '${bodyType}'`);
  if (!hairStencils) throw new Error(`no hairstyle '${hairStyle}'`);
  const colors = { ...FIXED_PALETTE, ...TEMPLATE_PALETTE };
  const top = 3 + pose.bob; // first row of the head; the rows above hold the outline and a clear margin
  const torsoTop = top + HEAD_STENCILS[direction].face.length + 1; // the neck sits on the row between head and torso
  const body = createCanvas(FRAME_WIDTH, FRAME_HEIGHT);
  paintLegs(body, colors, { direction, pose, top: torsoTop + TORSO.length });
  paintTorsoAndArms(body, colors, { direction, pose, top: torsoTop, build });
  paintStencil(body, colors, { rows: build.lashes ? withLashes(HEAD_STENCILS[direction].face, direction) : HEAD_STENCILS[direction].face, left: HEAD_LEFT, top });
  const hair = createCanvas(FRAME_WIDTH, FRAME_HEIGHT);
  paintStencil(hair, colors, { rows: hairStencils[direction], left: HEAD_LEFT, top });
  return { body, hair };
}

/** One layer of every frame, unoutlined, in the sheet's layout: what a body type's or a hairstyle's sheet holds. The client lays a hair sheet over a body sheet and outlines the two together. */
export function paintLayerSheet(layer, { body = 'straight', hairStyle = 'short' } = {}) {
  const sheet = createCanvas(FRAME_WIDTH * FRAMES_PER_DIRECTION, FRAME_HEIGHT * DIRECTIONS.length);
  DIRECTIONS.forEach((direction, row) => {
    POSES.forEach((pose, column) => {
      blit(sheet, paintFrameLayers(direction, pose, { body, hairStyle })[layer], column * FRAME_WIDTH, row * FRAME_HEIGHT);
    });
  });
  return sheet;
}

/**
 * The head, 18 columns from HEAD_LEFT by 15 rows: a 16-wide skull with
 * stepped corners, a column clear on each side but where a profile's nose
 * sticks out. `face` is the skin and everything on it (eyebrows, eyes with a
 * shine, nose shade, mouth); `hair` goes over it.
 */
const HEAD_STENCILS = {
  down: {
    face: [
      '....ssssssssss....',
      '..ssssssssssssss..',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '.sssbbbssssbbbssS.',
      '.sssssssssssssssS.',
      '.sssswesssswesssS.',
      '.sssseesssseesssS.',
      '.sssseesssseesssS.',
      '.ssssssssSssssssS.',
      '..ssssssSSsssssS..',
      '....sssssssssS....',
    ],
    hair: [
      '....llllhhhhhH....',
      '..hllllhhhhhhhhH..',
      '.hhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhH.',
      '.hhh.hh.hh.hh.hhH.',
      '.hh............hH.',
      '.hh............hH.',
      '.h..............H.',
      '..................',
      '..................',
      '..................',
      '..................',
      '..................',
    ],
  },
  up: {
    face: [
      '....ssssssssss....',
      '..ssssssssssssss..',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '..sssssssssssssS..',
      '....sssssssssS....',
    ],
    hair: [
      '....llllhhhhhH....',
      '..hllllhhhhhhhhH..',
      '.hhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhH.',
      '..hhhhhhhhhhhhhH..',
      '....hh.hhh.hhH....',
    ],
  },
  left: {
    face: [
      '....ssssssssss....',
      '..ssssssssssssss..',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '.ssbbbssssssssssS.',
      '.sssssssssssssssS.',
      '.sswesssssssssssS.',
      '.sseesssssssssssS.',
      'ssseesssssssssssS.',
      '.SssssssssssssssS.',
      '..ssSSsssssssssS..',
      '....sssssssssS....',
    ],
    hair: [
      '....llllhhhhhH....',
      '..hllllhhhhhhhhH..',
      '.hhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhH.',
      '.h.hh.hhhhhhhhhhH.',
      '.........hhhhhhhH.',
      '.........hhhhhhhH.',
      '.........hhhhhhhH.',
      '.........hhhhhhhH.',
      '.........hhhhhhhH.',
      '.........hhhhhhhH.',
      '.........hhhhhhH..',
      '.........hhhhH....',
    ],
  },
  right: {
    face: [
      '....ssssssssss....',
      '..ssssssssssssss..',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '.sssssssssssssssS.',
      '.sssssssssssbbbsS.',
      '.sssssssssssssssS.',
      '.sssssssssssswesS.',
      '.sssssssssssseesS.',
      '.sssssssssssseessS',
      '.sssssssssssssssS.',
      '..ssssssssssSSsS..',
      '....sssssssssS....',
    ],
    hair: [
      '....llllhhhhhH....',
      '..hllllhhhhhhhhH..',
      '.hhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhh.hh.H.',
      '.hhhhhhhH.........',
      '.hhhhhhhH.........',
      '.hhhhhhhH.........',
      '.hhhhhhhH.........',
      '.hhhhhhhH.........',
      '.hhhhhhhH.........',
      '..hhhhhhH.........',
      '....hhhhH.........',
    ],
  },
};

/**
 * Lashes: one pixel of the eyes' colour flicking up from the outer corner of
 * each eye, on the row above it. Coordinates are in the head stencil.
 */
const LASHES = {
  down: [
    [4, 8],
    [13, 8],
  ],
  up: [],
  left: [[2, 8]],
  right: [[15, 8]],
};

function withLashes(face, direction) {
  const rows = face.map((row) => [...row]);
  for (const [column, row] of LASHES[direction]) rows[row][column] = 'e';
  return rows.map((row) => row.join(''));
}

/**
 * The mirror of a profile's hair, for the other profile. A row the same
 * shape both ways is kept as it is, highlights included (the light comes from
 * the left in both). Any other row is reversed and shaded again: plain hair,
 * with the shade on the right end of every run.
 */
function mirrored(rows) {
  return rows.map((row) => {
    const mask = [...row].map((character) => character !== '.');
    if (mask.every((painted, index) => painted === mask[mask.length - 1 - index])) return row;
    const flipped = [...row].reverse().map((character) => (character === '.' ? '.' : 'h'));
    return flipped.map((character, index) => (character === 'h' && flipped[index + 1] !== 'h' ? 'H' : character)).join('');
  });
}

/** The crown every hairstyle shares: the top of the head, as the short hair has it. */
const CROWN = HEAD_STENCILS.down.hair.slice(0, 5);

const LONG_LEFT = [
  ...HEAD_STENCILS.left.hair,
  '..........hhhhhH..',
  '..........hhhhhH..',
  '..........hhhhhH..',
  '..........hhhhhH..',
  '..........hhhhhH..',
  '..........hh.hH...',
];

const TIED_BACK_LEFT = [
  ...CROWN,
  '..hhhhhhhhhhhhhhH.',
  '....hhhhhhhhhhhhH.',
  '.......hhhhhhhhhH.',
  '..........hhhhhhhH',
  '...........hhhhhhH',
  '............hhhhhH',
  '............hhhhhH',
  '.............hhhhH',
  '..............hhhH',
  '..............hhhH',
  '...............hhH',
  '...............hH.',
  '...............hH.',
  '...............hH.',
  '................H.',
]

/**
 * The hair of each hairstyle, by direction: stencils from HEAD_LEFT and the
 * head's first row, like the head's, that may run below the head (over the
 * shoulders and the back). Short is the hair #65 drew.
 */
const HAIR_STYLES = {
  short: { down: HEAD_STENCILS.down.hair, up: HEAD_STENCILS.up.hair, left: HEAD_STENCILS.left.hair, right: HEAD_STENCILS.right.hair },
  long: {
    down: [
      ...HEAD_STENCILS.down.hair.slice(0, 7),
      '.hh............hH.',
      '.hh............hH.',
      '.hh............hH.',
      '.hh............hH.',
      '.hh............hH.',
      '.hh............hH.',
      '.hhh..........hhH.',
      '.hhh..........hhH.',
      '.hhh..........hhH.',
      '.hhh..........hhH.',
      '.hhh..........hhH.',
      '.hhh..........hhH.',
      '.hh............hH.',
      '.h..............H.',
    ],
    up: [
      ...HEAD_STENCILS.up.hair.slice(0, 14),
      '..hhhhhhhhhhhhhH..',
      '..hhhhhhhhhhhhhH..',
      '..hhhhhhhhhhhhhH..',
      '..hhhhhhhhhhhhhH..',
      '..hhhhhhhhhhhhhH..',
      '..hhhhhhhhhhhhhH..',
      '...hhhhhhhhhhhH...',
      '....hh.hhh.hhH....',
    ],
    left: LONG_LEFT,
    right: mirrored(LONG_LEFT),
  },
  'tied back': {
    down: [...CROWN, '.hh............hH.', '.h..............H.', '.h..............H.'],
    up: [
      ...HEAD_STENCILS.up.hair.slice(0, 13),
      '....hhhHHHhhhH....',
      '.......hhH........',
      '.......hhH........',
      '.......hhH........',
      '.......hhH........',
      '........hH........',
      '........H.........',
    ],
    left: TIED_BACK_LEFT,
    right: mirrored(TIED_BACK_LEFT),
  },
};

/** The neck, centred under the head on the row above the torso. */
const NECK = ['sssS'];
const NECK_LEFT = 14;

/** The torso, 12 wide from TORSO_LEFT: a highlight down the left, a shade down the right, a darker hem and a round neckline. */
const TORSO = [
  'LcccsssScccC',
  'LccccsSccccC',
  ...Array.from({ length: 8 }, () => 'LccccccccccC'),
  'CCCCCCCCCCCC',
];
/** The torso from behind and in profile: no neckline. */
const TORSO_PLAIN = [...Array.from({ length: 10 }, () => 'LccccccccccC'), 'CCCCCCCCCCCC'];
const TORSO_LEFT = 10;

/**
 * The curvy torso, 14 wide from CURVY_TORSO_LEFT (a column wider than the
 * straight one on each side): shoulders two pixels narrower on each side, a
 * waist narrower still, and hips that flare past the hands.
 */
const CURVY_TORSO = [
  '...LcsssScC...',
  '...LccsSccC...',
  '...LccccccC...',
  '....LccccC....',
  '....LccccC....',
  '...LccccccC...',
  '..LccccccccC..',
  '.LccccccccccC.',
  'LccccccccccccC',
  'LccccccccccccC',
  'CCCCCCCCCCCCCC',
];
const CURVY_TORSO_PLAIN = ['...LccccccC...', ...CURVY_TORSO.slice(1)];
const CURVY_TORSO_LEFT = 9;

/**
 * The builds a player picks from: the torso from the front and from
 * elsewhere and its first column, where the arms hang (left columns, front
 * then back view: they sit against the shoulders), and whether the face has
 * lashes.
 */
const BODY_TYPES = {
  straight: { torso: TORSO, torsoPlain: TORSO_PLAIN, torsoLeft: TORSO_LEFT, arms: { down: [22, 8], up: [8, 22] }, lashes: false },
  curvy: { torso: CURVY_TORSO, torsoPlain: CURVY_TORSO_PLAIN, torsoLeft: CURVY_TORSO_LEFT, arms: { down: [20, 10], up: [10, 20] }, lashes: true },
};

/** An arm, 2 wide: a short sleeve over the skin of the forearm and hand. In profile the sleeve is in shade, so it reads over the torso. */
const ARM = ['cC', 'cC', 'cC', 'cC', 'sS', 'sS', 'sS', 'sS', 'sS', 'sS'];
const ARM_IN_PROFILE = ['CC', 'CC', 'CC', 'CC', 'sS', 'sS', 'sS', 'sS', 'sS', 'sS'];

function paintTorsoAndArms(canvas, colors, { direction, pose, top, build }) {
  paintStencil(canvas, colors, { rows: NECK, left: NECK_LEFT, top: top - 1 });
  paintStencil(canvas, colors, { rows: direction === 'down' ? build.torso : build.torsoPlain, left: build.torsoLeft, top });
  const swing = 2 * (pose.forwardLeg === 'left' ? 1 : pose.forwardLeg === 'right' ? -1 : 0);
  if (direction === 'down' || direction === 'up') {
    // The arm opposite the forward leg swings forward (drawn lower), the other one back (higher).
    const [leftArm, rightArm] = build.arms[direction];
    paintStencil(canvas, colors, { rows: ARM, left: leftArm, top: top - swing });
    paintStencil(canvas, colors, { rows: ARM, left: rightArm, top: top + swing });
  } else {
    // In profile only the near arm shows, swinging along the walk.
    const left = direction === 'left' ? 14 - swing : 16 + swing;
    paintStencil(canvas, colors, { rows: ARM_IN_PROFILE, left, top });
  }
}

function paintLegs(canvas, colors, { direction, pose, top }) {
  if (direction === 'down' || direction === 'up') {
    // Front and back view: the lifted leg is two pixels shorter, the planted one keeps its length.
    const [leftColumn, rightColumn] = direction === 'down' ? [16, 11] : [11, 16];
    paintLeg(canvas, colors, { left: leftColumn, top, lift: pose.forwardLeg === 'right' ? 2 : 0, far: false, toe: 0 });
    paintLeg(canvas, colors, { left: rightColumn, top, lift: pose.forwardLeg === 'left' ? 2 : 0, far: false, toe: 0 });
    return;
  }
  // Profile: the legs spread apart along the walk and the shoes point ahead. The far leg is drawn first and darker.
  const ahead = direction === 'left' ? -1 : 1;
  const spread = 2 * (pose.forwardLeg === null ? 0 : pose.forwardLeg === 'left' ? ahead : -ahead);
  paintLeg(canvas, colors, { left: 14 - spread, top, lift: 0, far: true, toe: ahead });
  paintLeg(canvas, colors, { left: 12 + spread, top, lift: 0, far: false, toe: ahead });
}

const LEG_WIDTH = 5;
const SHOE_ROWS = 3;

/**
 * A leg from `top` down to the feet row, `lift` pixels off the ground: pants
 * (shaded on the right; all shade for the far leg in profile), then a shoe
 * with a lighter top. `toe` (-1, 0, 1) is where the shoe's sole reaches past
 * the leg, one pixel, in profile.
 */
function paintLeg(canvas, colors, { left, top, lift, far, toe }) {
  const bottom = FEET_ROW - lift;
  const pantsRow = far ? 'P'.repeat(LEG_WIDTH) : `${'p'.repeat(LEG_WIDTH - 1)}P`;
  const pants = Array.from({ length: bottom - SHOE_ROWS + 1 - top }, () => pantsRow);
  const shoe = [`${'q'.repeat(LEG_WIDTH - 1)}o`, ...Array.from({ length: SHOE_ROWS - 1 }, () => 'o'.repeat(LEG_WIDTH))];
  paintStencil(canvas, colors, { rows: [...pants, ...shoe], left, top });
  if (toe === 0) return;
  const toeColumn = toe < 0 ? left - 1 : left + LEG_WIDTH;
  for (let row = bottom - (SHOE_ROWS - 2); row <= bottom; row += 1) pixel(canvas, toeColumn, row, colors.shoe);
}

/** Paints `rows` of STENCIL_KEYS characters with the top-left one at (left, top). */
function paintStencil(canvas, colors, { rows, left, top }) {
  rows.forEach((row, rowIndex) => {
    [...row].forEach((character, columnIndex) => {
      if (character === '.') return;
      const color = colors[STENCIL_KEYS[character]];
      if (!color) throw new Error(`stencil character '${character}' has no colour`);
      pixel(canvas, left + columnIndex, top + rowIndex, color);
    });
  });
}

// ---- PNG encoder (8-bit RGBA, no filtering, one IDAT) ----

export function encodePng(canvas) {
  const stride = canvas.width * 4;
  const filtered = new Uint8Array((stride + 1) * canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    filtered[y * (stride + 1)] = 0; // filter type: none
    filtered.set(canvas.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, canvas.width);
  view.setUint32(4, canvas.height);
  header.set([8, 6, 0, 0, 0], 8); // bit depth 8, colour type 6 (RGBA), deflate, no filter method, no interlace
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(filtered, { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
function chunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, data.length);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(concat([typeBytes, data])));
  return concat([length, typeBytes, data, crc]);
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// ---- Entry point ----

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = path.resolve(here, '../public/sprites');

/**
 * Writes the sheets into `directory` and returns their paths: `player.png`
 * (the first body type with the first hairstyle, outlined: what the def
 * names, and what the client draws if it cannot lay the layers), then one
 * layer sheet per body type and per hairstyle.
 */
export function writePlayerSheet(directory) {
  mkdirSync(directory, { recursive: true });
  const write = (key, canvas) => {
    const file = path.join(directory, `${key}.png`);
    writeFileSync(file, encodePng(canvas));
    return file;
  };
  return [
    write(PLAYER_SHEET_KEY, paintPlayerSheet()),
    ...Object.entries(LAYER_SHEETS.body).map(([body, key]) => write(key, paintLayerSheet('body', { body }))),
    ...Object.entries(LAYER_SHEETS.hairStyle).map(([hairStyle, key]) => write(key, paintLayerSheet('hair', { hairStyle }))),
  ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outFlag = process.argv.indexOf('--out');
  if (outFlag >= 0 && !process.argv[outFlag + 1]) throw new Error('--out needs a directory; without the flag the sheet goes to public/sprites');
  const directory = outFlag >= 0 ? path.resolve(process.argv[outFlag + 1]) : DEFAULT_OUTPUT_DIR;
  for (const file of writePlayerSheet(directory)) console.log(`wrote ${file}`);
}
