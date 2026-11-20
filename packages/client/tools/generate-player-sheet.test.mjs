import { characterPalettes, characterShapes, DefId, getDef } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { __testing__ as characterSheet, layerSheetsOf, paintFigure, paintLook } from '../src/render/characterSheet.ts';
import {
  DIRECTIONS,
  FIXED_PALETTE,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  FRAMES_PER_DIRECTION,
  LAYER_SHEETS,
  paintFrameLayers,
  paintLayerSheet,
  paintPlayerSheet,
  PLAYER_SHEET_KEY,
  POSES,
  TEMPLATE_PALETTE,
} from './generate-player-sheet.mjs';

describe('player sheet generator', () => {
  it('writes the sheet under the sprite key the player def declares', () => {
    expect(getDef(DefId.Player).sprite?.key).toBe(PLAYER_SHEET_KEY);
  });

  it('paints in the template colours the client swaps, and uses them for nothing else', () => {
    expect(characterSheet.TEMPLATE_COLORS).toEqual({
      skin: rgb(TEMPLATE_PALETTE.skin),
      skinShade: rgb(TEMPLATE_PALETTE.skinShade),
      hair: rgb(TEMPLATE_PALETTE.hair),
      hairShade: rgb(TEMPLATE_PALETTE.hairShade),
      hairLight: rgb(TEMPLATE_PALETTE.hairLight),
      clothes: rgb(TEMPLATE_PALETTE.shirt),
      clothesShade: rgb(TEMPLATE_PALETTE.shirtShade),
      clothesLight: rgb(TEMPLATE_PALETTE.shirtLight),
    });
    const swapped = Object.values(TEMPLATE_PALETTE).map(rgb);
    const fixed = Object.values(FIXED_PALETTE).map(rgb);
    expect(new Set([...swapped, ...fixed]).size).toBe(swapped.length + fixed.length);
    // Every swapped colour is really in the sheet, so a look changes every shade of every part.
    const painted = paintedColors(paintPlayerSheet());
    for (const color of swapped) expect(painted.has(color)).toBe(true);
    // And nothing is painted in a colour neither palette names.
    for (const color of painted) expect([...swapped, ...fixed]).toContain(color);
  });

  it('derives the template\'s own shades from its base colours the way the client derives a look\'s', () => {
    const { lightOf, shadeOf } = characterSheet;
    expect(rgb(TEMPLATE_PALETTE.skinShade)).toBe(shadeOf(rgb(TEMPLATE_PALETTE.skin)));
    expect(rgb(TEMPLATE_PALETTE.hairShade)).toBe(shadeOf(rgb(TEMPLATE_PALETTE.hair)));
    expect(rgb(TEMPLATE_PALETTE.hairLight)).toBe(lightOf(rgb(TEMPLATE_PALETTE.hair)));
    expect(rgb(TEMPLATE_PALETTE.shirtShade)).toBe(shadeOf(rgb(TEMPLATE_PALETTE.shirt)));
    expect(rgb(TEMPLATE_PALETTE.shirtLight)).toBe(lightOf(rgb(TEMPLATE_PALETTE.shirt)));
  });

  it('recolours every pixel of every part in all sixteen frames for every look', () => {
    const sheet = paintPlayerSheet();
    const template = new Uint8ClampedArray(sheet.data);
    const partOfColor = new Map(Object.entries(characterSheet.TEMPLATE_COLORS).map(([part, color]) => [color, part]));
    let looks = 0;
    for (let skin = 0; skin < characterPalettes.skin.length; skin += 1) {
      for (let hair = 0; hair < characterPalettes.hair.length; hair += 1) {
        for (let clothes = 0; clothes < characterPalettes.clothes.length; clothes += 1) {
          const look = { skin, hair, clothes };
          const expected = characterSheet.lookColors(look);
          const pixels = new Uint8ClampedArray(template);
          paintLook(pixels, look);
          let wrong = 0;
          for (let offset = 0; offset < template.length; offset += 4) {
            const before = rgb(template.subarray(offset, offset + 3));
            const after = rgb(pixels.subarray(offset, offset + 3));
            const part = template[offset + 3] === 255 ? partOfColor.get(before) : undefined;
            if (after !== (part ? expected[part] : before) || pixels[offset + 3] !== template[offset + 3]) wrong += 1;
          }
          expect(wrong, `look ${JSON.stringify(look)}`).toBe(0);
          looks += 1;
        }
      }
    }
    expect(looks).toBe(characterPalettes.skin.length * characterPalettes.hair.length * characterPalettes.clothes.length);
  });

  it('writes a layer sheet for every body type and hairstyle the sim lists, under the key the sim gives it', () => {
    expect(Object.entries(LAYER_SHEETS.body)).toEqual(characterShapes.body.map((shape) => [shape.name, shape.sheet]));
    expect(Object.entries(LAYER_SHEETS.hairStyle)).toEqual(characterShapes.hairStyle.map((shape) => [shape.name, shape.sheet]));
  });

  it('lays a hairstyle over a body type in the client exactly as the generator paints the pair, for every pairing', () => {
    expect(characterSheet.OUTLINE_COLOR).toBe(rgb(FIXED_PALETTE.outline));
    const looks = [
      { skin: 0, hair: 0, clothes: 0 },
      { skin: 5, hair: 6, clothes: 3 },
    ];
    for (const [bodyIndex, bodyShape] of characterShapes.body.entries()) {
      for (const [hairIndex, hairShape] of characterShapes.hairStyle.entries()) {
        const body = paintLayerSheet('body', { body: bodyShape.name, hairStyle: hairShape.name });
        const hair = paintLayerSheet('hair', { body: bodyShape.name, hairStyle: hairShape.name });
        for (const colors of looks) {
          const look = { ...colors, body: bodyIndex, hairStyle: hairIndex };
          expect(layerSheetsOf(look)).toEqual({ body: bodyShape.sheet, hair: hairShape.sheet });
          const expected = new Uint8ClampedArray(paintPlayerSheet({ body: bodyShape.name, hairStyle: hairShape.name }).data);
          paintLook(expected, look);
          const drawn = paintFigure({ body: new Uint8ClampedArray(body.data), hair: new Uint8ClampedArray(hair.data), width: body.width, height: body.height }, look);
          expect(Buffer.from(drawn).equals(Buffer.from(expected)), `${bodyShape.name} with ${hairShape.name} hair`).toBe(true);
        }
      }
    }
  });

  it('keeps player.png as the first body type with the first hairstyle', () => {
    expect(Buffer.from(paintPlayerSheet().data).equals(Buffer.from(paintPlayerSheet({ body: characterShapes.body[0].name, hairStyle: characterShapes.hairStyle[0].name }).data))).toBe(true);
  });

  it('gives each body type its own silhouette from every side, and only the curvy one lashes', () => {
    const eyes = rgb(FIXED_PALETTE.eye);
    for (const direction of DIRECTIONS) {
      const [straight, curvy] = ['straight', 'curvy'].map((body) => paintFrameLayers(direction, POSES[0], { body }).body);
      expect(maskOf(curvy), direction).not.toEqual(maskOf(straight));
      // The shoulders are narrower and the hips wider than the straight build's.
      if (direction === 'down') {
        const shoulderRow = 3 + 15 + 1;
        const hipRow = shoulderRow + 9;
        expect(widthOfRow(curvy, shoulderRow)).toBeLessThan(widthOfRow(straight, shoulderRow));
        expect(widthOfRow(curvy, hipRow)).toBeGreaterThan(widthOfRow(curvy, shoulderRow + 3));
      }
      if (direction !== 'up') expect(countOf(curvy, eyes), direction).toBeGreaterThan(countOf(straight, eyes));
    }
  });

  it('gives each hairstyle its own shape from every side, on any body', () => {
    for (const body of Object.keys(LAYER_SHEETS.body)) {
      for (const direction of DIRECTIONS) {
        const masks = Object.keys(LAYER_SHEETS.hairStyle).map((hairStyle) => maskOf(paintFrameLayers(direction, POSES[0], { body, hairStyle }).hair).join(''));
        expect(new Set(masks).size, `${body}, ${direction}`).toBe(masks.length);
      }
    }
  });

  it('keeps the hair on a layer of its own, over a skull painted whole', () => {
    const hairColors = new Set([TEMPLATE_PALETTE.hair, TEMPLATE_PALETTE.hairShade, TEMPLATE_PALETTE.hairLight].map(rgb));
    for (const hairStyle of Object.keys(LAYER_SHEETS.hairStyle)) {
      for (const direction of DIRECTIONS) {
        for (const pose of POSES) {
          for (const color of paintedColors(paintFrameLayers(direction, pose, { hairStyle }).hair)) expect(hairColors).toContain(color);
        }
      }
    }
    // Short hair sits on the head; longer hairstyles fall past it, over the shoulders and the back.
    for (const direction of DIRECTIONS) {
      for (const pose of POSES) {
        const { body, hair } = paintFrameLayers(direction, pose);
        // The body carries no hair but the eyebrows (in the hair's shade), so taking the hair layer away leaves a bald head.
        expect(paintedColors(body).has(rgb(TEMPLATE_PALETTE.hair))).toBe(false);
        expect(paintedColors(body).has(rgb(TEMPLATE_PALETTE.hairLight))).toBe(false);
        for (let offset = 0; offset < hair.data.length; offset += 4) {
          if (hair.data[offset + 3] === 255) expect(body.data[offset + 3], `${direction}: hair at pixel ${offset / 4} floats off the head`).toBe(255);
        }
      }
    }
  });

  it('paints the sheet in the frame layout the def declares', () => {
    const sprite = getDef(DefId.Player).sprite;
    const sheet = paintPlayerSheet();
    expect(sheet.width).toBe(sprite.frameWidth * FRAMES_PER_DIRECTION);
    expect(sheet.height).toBe(sprite.frameHeight * DIRECTIONS.length);
    expect([FRAME_WIDTH, FRAME_HEIGHT]).toEqual([sprite.frameWidth, sprite.frameHeight]);
    for (const direction of DIRECTIONS) {
      const frames = sprite.directions[direction];
      expect(Math.floor(frames.idle / FRAMES_PER_DIRECTION)).toBe(DIRECTIONS.indexOf(direction));
      expect(frames.walk.end - frames.walk.start + 1).toBe(FRAMES_PER_DIRECTION);
    }
  });

  it('keeps the figure inside its frame with a clear edge, so frames never bleed into each other', () => {
    for (const direction of DIRECTIONS) {
      for (const pose of POSES) {
        const layers = Object.keys(LAYER_SHEETS.body).flatMap((body) => Object.keys(LAYER_SHEETS.hairStyle).map((hairStyle) => paintFrameLayers(direction, pose, { body, hairStyle })));
        for (const layer of layers.flatMap(({ body, hair }) => [body, hair])) {
          for (let y = 0; y < FRAME_HEIGHT; y += 1) {
            for (let x = 0; x < FRAME_WIDTH; x += 1) {
              const onEdge = x === 0 || y === 0 || x === FRAME_WIDTH - 1 || y === FRAME_HEIGHT - 1;
              if (onEdge) expect(layer.data[(y * FRAME_WIDTH + x) * 4 + 3]).toBe(0);
            }
          }
        }
      }
    }
  });
});

// ---- Helpers ----

function rgb([r, g, b]) {
  return (r << 16) | (g << 8) | b;
}

/** Which pixels of a canvas are painted, row by row. */
function maskOf(canvas) {
  return Array.from({ length: canvas.height }, (_, y) => Array.from({ length: canvas.width }, (_, x) => (canvas.data[(y * canvas.width + x) * 4 + 3] === 255 ? '#' : '.')).join(''));
}

/** How many pixels of one row are painted. */
function widthOfRow(canvas, row) {
  return [...maskOf(canvas)[row]].filter((pixel) => pixel === '#').length;
}

function countOf(canvas, color) {
  let count = 0;
  for (let offset = 0; offset < canvas.data.length; offset += 4) {
    if (canvas.data[offset + 3] === 255 && rgb(canvas.data.subarray(offset, offset + 3)) === color) count += 1;
  }
  return count;
}

function paintedColors(canvas) {
  const painted = new Set();
  for (let offset = 0; offset < canvas.data.length; offset += 4) {
    if (canvas.data[offset + 3] === 255) painted.add(rgb(canvas.data.subarray(offset, offset + 3)));
  }
  return painted;
}
