# 0009 - Hosting on Railway: one service, settings as code, deploys gated by CI

Status: accepted. Date: 2026-11-14. Builds on [0008](0008-http-front.md), whose one process and `Dockerfile` this deploys. Ticket #20.

## Context

The game is one Node process that serves the client and the one world room on one port. The world lives only in that process's memory. So the host must run exactly one instance, never put it to sleep, carry WebSockets, inject `PORT`, and check `GET /health`. Starting each deploy with an empty world is acceptable. The human chose Railway on 2026-11-14 because they already have an account there. That account also holds unrelated projects, which Novaland must never touch.

The ticket asked for `railway.json`. Railway deprecated that format (Config as Code) before the ticket was worked: new services cannot opt into it, and existing files stop being read on 2026-12-01. Its replacement is Infrastructure as Code: a TypeScript file, `.railway/railway.ts`, written with the `railway` SDK's `railway/iac` entry and applied with the CLI (`railway config plan`, `railway config apply`, CLI 5.42.1 or newer).

## Decision

- **A Railway project of its own**, `novaland`, with one service, `novaland`. Projects share no variables or private network, so nothing in it can reach the other projects in the account, and nothing there reaches it.
- **Settings live in `.railway/railway.ts`**: the Dockerfile builder, health check `/health`, restart on failure, one replica in `us-east4-eqdc4a` (US East, nearest most players), `sleepApplication: false`, no overlap between the old deploy and the new one, the GitHub source on `main` with `checkSuites` ("Wait for CI"), and `ALLOWED_ORIGINS`. `pnpm typecheck`, and so CI, checks the field names against the SDK's types. The SDK is a root dev dependency, pinned in the catalog.
- **The file is a named partial, `novaland`.** A named partial only deletes resources it owns. The account holds unrelated projects, so a file applied while linked to the wrong one cannot remove anything there; the README also says to read the plan's project and environment before applying.
- **Deploys come from Railway's GitHub autodeploy**, not from the file and not from GitHub Actions. A push to `main` builds once CI on that commit passes. The CI workflow already runs on pushes to `main`, which is what makes the toggle available. No Railway token is stored in GitHub.
- **The file is applied by hand** from a machine where the human is logged in, after it changes. Railway offers a GitHub Action that applies it on merge, but that needs a project token as a repository secret, and the file will change rarely.
- **`ALLOWED_ORIGINS` is `https://${{RAILWAY_PUBLIC_DOMAIN}}`**, a Railway reference that resolves to the service's generated domain. It names no secret, so it can live in the repo, and it follows the domain if the domain is regenerated.

## Consequences

- Every deploy drops the world and the players in it; they reconnect to a fresh one. Overlap is zero so nobody stays in the old world, and the health check holds traffic until the new process answers.
- A setting changed in the dashboard drifts from the file. `railway config plan` shows the drift; the file wins on the next apply. Variables are managed by the file too: one added only in the dashboard is removed by the next apply. A secret goes in the file as `preserve()`, which keeps the value set in Railway, never as its value.
- Before the domain exists, `ALLOWED_ORIGINS` resolves to `https://`, which the server rejects at boot. Generate the domain before the first deploy, as the README's steps say.
- One region and one replica mean players far from US East have more latency. More regions would need more than one world, which is a different design.
- If the deploy hook itself ever needs to change (say, a GitHub Action that applies the file), it is a new record; this one does not change.
