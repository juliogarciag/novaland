# #65 Player at 32x48 with shade-aware recolouring: verification

What a player sees, in the real client (`pnpm dev`, solo): the character is the new 32x48 sheet, drawn at the def's size on today's 16 px tiles (half scale, 1.5 m tall as before), every shade and highlight of every part takes the look's colours, it walks all four directions through the four frames of each row, and the creator previews it.

Every combination of the palettes (6 skins x 8 hairs x 8 clothes) in all 16 frames is checked headless by `packages/client/tools/generate-player-sheet.test.mjs`; this script checks four looks in the browser, with the lightest and darkest swatches among them.

```bash
bash verifications/65-player-at-32x48-with-shade-aware-recolouring/run.sh
```

| Script | What it proves | Proof |
|---|---|---|
| `01-player-sheet.mjs` | The def declares 32x48 frames and the loaded sheet is 4x4 of them; the sprite is drawn 16x24 world pixels (half scale); for four looks, each template colour becomes exactly one colour: the picked swatch for a base, darker for a shade, lighter for a highlight, and no fixed colour changes; walking S, W, A, D plays frames 0-3, 4-7, 8-11, 12-15; the creator preview is 96x144; no page errors | `proof/01-player-sheet.json`, `proof/01-player-sheet.txt`, `proof/walk-{down,up,left,right}.png`, `proof/look-{0..3}.png`, `proof/creator.png` |
