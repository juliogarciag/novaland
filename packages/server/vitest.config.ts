import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'server',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The room tests run against real timers (60 ticks and 20 sends a second) and boot a server each; a slow machine must fail on a specific wait, not on the suite clock.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
