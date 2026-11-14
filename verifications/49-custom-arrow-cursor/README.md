# 49: Custom arrow cursor

Small ticket: this folder is the proof of running the change once against `pnpm dev`.

A browser screenshot never contains the mouse cursor, so the check reads what the browser uses to draw it, the computed `cursor` of whatever is under the mouse and the images that value names, and compares those images pixel by pixel with the design in `packages/client/tools/generate-arrow-cursor.mjs`. It does this on an ordinary screen and on a 2x one.

```bash
bash verifications/49-custom-arrow-cursor/run.sh
```

| Script | What it proves | Proof |
|---|---|---|
| `cursor.mjs` | Over the running game, at every point of the window, the cursor is the arrow image for the screen's pixel ratio, with the hotspot at `0 0` (the tip) and `auto` as the fallback; the served images are 32x32 and 64x64 (32 CSS pixels either way) and every pixel is the design's colour as one flat block; the page logs no errors | `proof/cursor.txt`, `proof/cursor.json` |

The pictures are drawn from the served images, since the real cursor cannot be captured:

- `proof/arrow-enlarged.png`: the 1x file at 8 times its size.
- `proof/over-the-game-1x.png`, `proof/over-the-game-2x.png`: the file each screen picks, placed with its tip where the mouse is over the game.

Not covered by the script: online mode. It is the same page and the same rule on `html`, which the connection screens inherit; their buttons keep the hand pointer they already had.
