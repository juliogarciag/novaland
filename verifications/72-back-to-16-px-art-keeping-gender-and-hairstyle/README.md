# #72 Back to 16 px art, keeping gender and hairstyle

What the ticket promises, checked from the player's side: the game at 16 px looks like `c466e78` (main before #67, #68 and #69), gender and hairstyle work solo and online in all four directions, characters saved by the 32 px version (and by the version before genders) still load, and `pnpm check` passes.

`02-solo.mjs` compares against the copy of `c466e78` the main session runs at http://localhost:5150; it only reads it.

```bash
bash verifications/72-back-to-16-px-art-keeping-gender-and-hairstyle/run.sh
```

| Script | What it proves | Proof |
|---|---|---|
| `01-art.mjs` | `grass`, `water`, `shallows`, `tree`, `rock` and `player.png` are `c466e78`'s bytes; the files that size a metre, a tile, a name and the view (units, zoom, name labels, ground tileset, terrain drawing, terrain defs, terrain generators) are `c466e78`'s files; the two body sheets and two hair sheets are 64x96 (4x4 frames of 16x24) and what the generator paints today | `proof/01-art.json`, `proof/01-every-look.png` (male short, male long, female short, female long; every direction and walk frame, 6x) |
| `02-solo.mjs` | Same pixels per metre (16), zoom and metres on screen as `c466e78` at 960x720, and the middle of the screen identical pixel for pixel, with a character remembered before genders existed; each of the four looks, turned in all four directions, drawn from its own look texture on that direction's 16x24 idle frame, with four different figures from the front and the sides and two from behind; the creator's 96x144 preview, gender and hairstyle pickers, the suggested hairstyle, the turning keys and the saved character; a character saved by the 32 px version going straight into the world with its look | `proof/02-solo.json`, `proof/02-side-by-side.png`, `proof/02-c466e78.png`, `proof/02-now.png`, `proof/02-every-look-every-direction.png`, `proof/02-creator*.png`, `proof/02-saved-at-32-px.png` |
| `03-online.mjs` | With the real room server: a woman with long hair and a man with short hair joined from two browsers, each tab draws both from their own look textures; when Ada turns in each direction, Ben's tab shows her 16x24 idle frame for it | `proof/03-online.json`, `proof/03-online-A.png`, `proof/03-online-B.png`, `proof/03-B-sees-Ada-*.png` |
| `pnpm check` | Tests, typecheck and lint across the repo | `proof/pnpm-check.txt` |
