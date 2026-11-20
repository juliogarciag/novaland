# #66 Pick a gender and a hairstyle: verifications

These checks cover the ticket from the player's side, against the real client and the real room server. A player picks a gender and a hairstyle in the creator. Picking a gender picks the hairstyle the sim suggests for it, and the player can still pick another. Every pairing shows in the preview. They enter the world as that character and can change it from inside the world. The choices survive a reload (solo) and a rejoin (online), other players see and draw them, and a character a browser remembered before #66 goes straight in with the first gender and hairstyle. Expected values come from `window.__novaland` (`characterShapes`, `characters()`, `drawnNames()`) and from the creator's own controls, never from typed numbers. The art itself is covered by `packages/client/tools/generate-player-sheet.test.mjs`: the client's layering equals the generator's pair byte for byte, and each gender and hairstyle has its own silhouette.

```bash
bash verifications/66-pick-a-body-type-and-a-hairstyle/run.sh
```

| Script | What it proves | Proof |
|---|---|---|
| `01-solo.mjs` | The creator offers both choices by name, in the sim's order. W, A, S, D and the arrows turn the figure in the preview (also over the running game, where the player does not walk), an arrow on a picker turns it instead of picking, and in the name field the keys type. Picking each gender picks its suggested hairstyle, and the player enters with another one picked after it. All six pairings preview differently. The game loaded every body and hair layer sheet. The player enters with the pair picked, drawn from that look's texture, and the browser remembers it. The in-world creator starts from what is worn and a change keeps the same entity, name and colours. A reload goes straight in as the changed character. A character remembered before #66 skips the creator and plays as gender 0 with hairstyle 0. No page errors. | `proof/01-solo.json`, `proof/01-solo.txt`, `proof/creator.png`, `proof/creator-female-picked.png`, `proof/preview-facing-*.png`, `proof/preview-*.png`, `proof/entered.png`, `proof/change-character.png`, `proof/changed.png`, `proof/remembered-before-66.png` |
| `02-online.mjs` | The online client loaded every layer sheet. A join made in the creator carries the gender and hairstyle to the server and to the other tab's replica, which draws them. A remembered character's pair reaches the other tab too. A change in the world reaches the other tab. A rejoin keeps the change without the creator. A character remembered before #66 joins with the first of each. No page errors. | `proof/02-online.json`, `proof/02-online.txt`, `proof/online-A.png`, `proof/online-B.png`, `proof/online-B-after-change.png`, `proof/online-C-remembered-before-66.png` |

`proof/long-and-tied-back-every-frame.png` shows long and tied-back hair on the female figure in every direction and walk frame, at 6x, from the generator. `proof/pnpm-check.txt` is the transcript of `pnpm check` (tests, typecheck, lint) on the final commit.

Ports: 5966 (solo client), 2966 and 5967 (online server and client).
