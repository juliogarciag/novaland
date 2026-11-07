import { defineConfig } from 'vitest/config';

// No hardcoded port: several worktrees run dev servers side by side.
// PORT=5180 pnpm dev pins one; unset, Vite picks a free port starting at 5173.
const port = process.env.PORT ? Number(process.env.PORT) : 5173;
const strictPort = process.env.PORT !== undefined;

export default defineConfig({
  server: { port, strictPort },
  preview: { port, strictPort },
  test: {
    name: 'client',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
