import { defineConfig } from 'vitest/config';

// Each package owns its own vitest config; the root runs them all, and the tests of the root scripts with them.
export default defineConfig({
  test: {
    projects: ['packages/*', { test: { name: 'scripts', include: ['scripts/**/*.test.mjs'] } }],
  },
});
