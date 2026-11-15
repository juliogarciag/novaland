import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Runs this folder's own tests with the repo's vitest. They may reach inside the sim (the physics world), which a script outside it cannot.
export default defineConfig({
  root: path.resolve(import.meta.dirname, '../..'),
  test: { include: ['verifications/47-world-as-chunks/*.test.ts'], testTimeout: 60000 },
});
