# 49: Custom arrow cursor

Small ticket: this folder is the proof of running the change once against `pnpm dev`.

A browser screenshot never contains the mouse cursor, so the check reads what the browser uses to draw it, the computed `cursor` of whatever is under the mouse and the images that value names, and compares those images pixel by pixel with the designs in `packages/client/tools/generate-cursors.mjs`. It does this on an ordinary screen and on a 2x one, pressing C to go through the three designs.

```bash
bash verifications/49-custom-arrow-cursor/run.sh
```

| Script | What it proves | Proof |
|---|---|---|
| `cursor.mjs` | On opening the game the cursor is the warm arrow; each press of C shows the next design (dark dart, shaded arrow) and a third press comes back to the first; each time, a 40-pixel grid of points over the window has that cursor's image for the screen's pixel ratio, its hotspot at `0 0` (the tip) and `auto` as the fallback; the served images are 32x32 and 64x64 (32 CSS pixels either way) and every pixel is the design's colour as one flat block; the picked cursor survives a reload and Ctrl+C does not switch it; the page logs no errors | `proof/cursor.txt`, `proof/cursor.json` |

The pictures are drawn from the served images, since the real cursor cannot be captured: `proof/<design>-over-the-game-1x.png` and `-2x.png` show the file each screen picks, placed with its tip where the mouse is over the game.

Not covered:

- Chromium only. Firefox and Safari are not checked; a browser that does not take `image-set()` in `cursor` keeps the plain `url()` rule, which a 2x screen may smooth.
- Crisp means pixel ratios 1 and 2. At 1.25 or 1.5 the browser resamples one of the two files.
- Online mode. It is the same page and the same rule on `html`, which the connection screens inherit; their buttons keep the hand pointer they already had.
- That the browser paints the cursor: the check proves the computed value and the served files, not the pixels on the screen.
