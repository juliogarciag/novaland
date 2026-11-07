import { defineConfig } from 'vitest/config';

// Each package owns its own vitest config; the root just runs them all.
export default defineConfig({
  test: {
    projects: ['packages/*'],
  },
});
