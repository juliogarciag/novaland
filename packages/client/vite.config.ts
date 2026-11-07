import { defineConfig } from 'vitest/config';

// No hardcoded port: several worktrees run dev servers side by side.
// PORT=5180 pnpm dev pins one (and fails if it is taken); unset, Vite picks a
// free port starting at 5173. Only the shell environment is read here: Vite
// does not load .env files while evaluating this config.
const requested = Number.parseInt(process.env.PORT ?? '', 10);
const pinned = Number.isInteger(requested) && requested > 0;
const port = pinned ? requested : 5173;

export default defineConfig({
  server: { port, strictPort: pinned },
  preview: { port, strictPort: pinned },
  test: {
    name: 'client',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
