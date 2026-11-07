# Novaland

A 2D open world built as a long-lived playground, expanded mostly by AI agents working in parallel.

Everything an agent (or a human) needs to work here is in [AGENTS.md](AGENTS.md): the architecture rules, the package layout, the commands, and how to add a feature without breaking the rules. Architecture decisions live in [docs/decisions](docs/decisions).

```bash
pnpm install
pnpm dev        # client in the browser (PORT=5180 pnpm dev to pick a port)
pnpm test       # all tests, headless
pnpm typecheck
pnpm lint
```
