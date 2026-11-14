# Verifications for #20 - Deploy to Railway on merge to main

Ticket: https://github.com/juliogarciag/novaland/issues/20. Size S: the proof is the change run once, on the real host.

`01-live.mjs <url>` checks the deployed game from a player's side: `/health` answers, a foreign origin is refused, two Chromium contexts open the URL and get seats, each one's key presses move its avatar in the authoritative world (a Node observer, #19's `observer.ts`, is the witness, since production pages have no debug API), each page receives the deltas carrying the other's movement, and both pages are captured side by side.

```bash
cd verifications/20-deploy-to-railway && pnpm install --ignore-workspace && npx playwright install chromium
node 01-live.mjs https://novaland-production.up.railway.app
```

| Proof | What it shows |
|---|---|
| `proof/01-live-railway.txt`, `.json` | 12/12 checks on https://novaland-production.up.railway.app, against the branch deployed by hand before the merge |
| `proof/01-live-railway-two-players.png` | Both players on the live URL, each drawing the other's avatar (and the observer's) |
| `proof/01-live-local*` | The same script dry-run against `pnpm build` + `pnpm start` in production mode on port 5120, before the deploy |
| `proof/02-config-plan.txt`, `03-config-apply.txt` | `railway config plan` / `apply` of `.railway/railway.ts` on the new `novaland` project: one service created, nothing else |
| `proof/04-domain.txt` | The generated domain |
| `proof/05-branch-deploy-build-log.txt`, `05-branch-deploy-runtime-log.txt` | Railway's build log (Dockerfile builder, health check on `/health` succeeded) and deploy log (`allowedOrigins` resolved to the public URL) for the by-hand deploy of this branch |
| `proof/06-curl-health.txt` | `curl -si` of `/health` on the public URL |
| `proof/07-*` | The first automatic deploy after the PR merged: CI passed, then Railway built `main` |
