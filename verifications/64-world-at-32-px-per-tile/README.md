# #64 World at 32 px per tile: verifications

What is verified: the world's art is drawn at 32 pixels per metre and a player sees the world at the same scale as at 16, solo and online. Every expected number comes from `window.__novaland` (defs, camera, map) or from what the 16-pixel world was (the rule the camera used, the metres its frames stood); the before/after script measures the second against the real base commit.

Run everything (the first run installs Playwright here):

```bash
bash verifications/64-world-at-32-px-per-tile/run.sh
```

| Script | What it proves | Proof |
|---|---|---|
| `solo.mjs` | Every terrain sheet the page loads is art at 32 px per metre at the size its def declares, and the ground tileset fits a 4096 texture. On six screens (1280x800 to 3456 device pixels across, 1x and 2x) the zoom is whole, shows at least 20 m and about the metres the 16-px rule showed (the same where that zoom was even); trees, rocks and the player stand as many metres as before (the 16x24 player sheet at 2x); names are lettered at the same device pixels and sit 1/16 m above the head; the minimap paints. Walks the player east, then points the camera at the nearest lake. | `proof/solo.json`, `proof/solo.txt`, `proof/solo-spawn-1280x800.png`, `proof/solo-spawn-1920x1080.png`, `proof/solo-walked-east-1280x800.png`, `proof/solo-lake-1280x800.png` |
| `online.mjs` | Against the real room server, two players in their own browser contexts: each tab draws the world at 32 px per metre at the zoom the old rule gave, both characters at 1 x 1.5 m and each name above its own head. | `proof/online.json`, `proof/online.txt`, `proof/online-A.png`, `proof/online-B.png` |
| `before-after.mjs` | Checks out the commit this branch was cut from into a temporary worktree (removed after) and opens it and this branch at 1280x800 at the spawn: a metre, a tree, a rock, the player and a letter of a name take the same device pixels on screen, the camera shows the same metres and the player stands at the same spot. | `proof/before-after.json`, `proof/before-after.txt`, `proof/before-16px-1280x800.png`, `proof/after-32px-1280x800.png` |

Notes:

- `solo.mjs` shows the lake by replacing, in the page, the world scene's per-frame call that centres the camera on the player. It moves the view only; the sim is untouched.
- Ports: 5264 (solo), 5265 and 5266 (online), 5267 and 5268 (before and after). The dev server left running for the human is 5164.
