import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Package boundaries.
 *
 * sim    -> may import: bitecs, rapier. Never phaser, DOM, client, server, colyseus.
 *           Rapier at runtime only in packages/sim/src/core/physics.ts, which loads it on demand (ADR 0007); types anywhere.
 * client -> may import: phaser, @novaland/sim (package entry only). Never rapier, bitecs, server.
 *           @colyseus/sdk only inside packages/client/src/online: the rest of the client plays a PlayableWorld and does not know the transport.
 * server -> may import: @novaland/sim (package entry only), colyseus. Never phaser, client.
 *           Two halves that never import each other (ADR 0008): src/front (HTTP: express, helmet, never colyseus) and src/world (the room: colyseus).
 *           The rest of the server reaches each through its entry file only (src/front/index.ts, src/world/index.ts).
 *
 * Violations fail `pnpm lint`. Keep the lists below in sync with AGENTS.md.
 */
const group = (patterns, message) => ({ group: patterns, message });

const PHASER = group(['phaser', 'phaser/*'], 'Phaser is rendering/input only and lives in packages/client.');
const RAPIER = group(['@dimforge/*'], 'Physics lives in packages/sim. The client only reads sim state.');
const BITECS = group(['bitecs', 'bitecs/*'], 'The ECS lives in packages/sim. Use the sim public API.');
const COLYSEUS = group(['colyseus', 'colyseus/*', '@colyseus/*'], 'Networking belongs to packages/server (and later a client adapter), not here.');
const COLYSEUS_OUTSIDE_ONLINE = group(['colyseus', 'colyseus/*', '@colyseus/*'], 'The Colyseus SDK lives in packages/client/src/online. Everything else in the client plays a PlayableWorld.');
const CLIENT_PKG = group(['@novaland/client', '@novaland/client/*', '**/packages/client/**', '../**/client/**'], 'Nothing may depend on the client. It is a view.');
const SERVER_PKG = group(['@novaland/server', '@novaland/server/*', '**/packages/server/**', '../**/server/**'], 'Nothing may depend on the server.');
const NODE_BUILTINS = group(['node:*', 'fs', 'fs/*', 'path', 'os', 'crypto', 'child_process', 'worker_threads', 'http', 'https', 'net', 'events', 'stream', 'util', 'url'], 'The sim is headless and pure: no Node APIs in packages/sim.');
const FRONT_DEEP = group(['**/front/*'], 'Import the HTTP front through its entry file (packages/server/src/front) so its public surface stays explicit (ADR 0008).');
const WORLD_DEEP = group(['**/world/*'], 'Import the world through its entry file (packages/server/src/world) so its public surface stays explicit (ADR 0008).');
const FRONT_ANY = group(['**/front', '**/front/**'], 'The world knows nothing about the HTTP front: it declares what it needs in WorldFront and is handed it (ADR 0008).');
const WORLD_ANY = group(['**/world', '**/world/**'], 'The HTTP front knows nothing about the world room (ADR 0008).');
const OUT_OF_HALF = group(['../*', '../**'], 'Each half of the server is self-contained: nothing in src/front or src/world imports from outside its own folder, which would be a way round to the other half (ADR 0008).');
const HTTP_LIBRARIES_IN_WORLD = group(['express', 'express/*', 'helmet', 'compression'], 'HTTP belongs to src/front. The world names the Express app through Colyseus (RoutesApp) and imports no HTTP library (ADR 0008).');
const COLYSEUS_IN_FRONT = group(['colyseus', 'colyseus/*', '@colyseus/*'], 'The HTTP front does not know Colyseus: it shapes its pieces for Colyseus\'s hooks and the world plugs them in (ADR 0008).');
const SIM_DEEP = group(['@novaland/sim/*', '**/packages/sim/**', '../**/sim/**'], 'Import the sim through its package entry (@novaland/sim) so its public API stays explicit.');

const restrictImports = (...groups) => ({
  'no-restricted-imports': ['error', { patterns: groups }],
});

const BROWSER_AND_NODE_GLOBALS = [
  'window', 'document', 'navigator', 'self', 'localStorage', 'sessionStorage', 'indexedDB',
  'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'setInterval', 'setImmediate',
  'queueMicrotask', 'fetch', 'XMLHttpRequest', 'WebSocket', 'Worker', 'Image', 'Audio',
  'HTMLElement', 'CanvasRenderingContext2D', 'btoa', 'atob', 'crypto', 'console',
  'process', 'require', 'Buffer', 'globalThis',
].map((name) => ({ name, message: `The sim is headless and pure: "${name}" is not allowed in packages/sim.` }));

const NEW_DATE = { selector: 'NewExpression[callee.name="Date"]', message: 'Non-deterministic. Use sim.tick instead.' };
const TESTING_IMPORT = {
  selector: 'ImportSpecifier[imported.name="__testing__"]',
  message: '`__testing__` exports are for *.test.ts files only.',
};

export default defineConfig([
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '.worktrees/**',
      'verifications/**/proof/**',
      'verifications/**/node_modules/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['*.js', '*.ts', 'scripts/**/*.mjs', 'packages/server/**/*.ts', 'packages/client/vite.config.ts', 'packages/client/tools/**/*.mjs', 'verifications/**/*.{js,mjs,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['packages/client/src/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['packages/sim/**/*.ts'],
    rules: {
      ...restrictImports(PHASER, COLYSEUS, CLIENT_PKG, SERVER_PKG, NODE_BUILTINS),
      'no-restricted-globals': ['error', ...BROWSER_AND_NODE_GLOBALS],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Non-deterministic. Use sim.rng instead.' },
        { object: 'Date', property: 'now', message: 'Non-deterministic. Use sim.tick instead.' },
        { object: 'performance', property: 'now', message: 'Non-deterministic. Use sim.tick instead.' },
      ],
      'no-restricted-syntax': ['error', NEW_DATE],
    },
  },
  // A runtime import of Rapier anywhere but core/physics.ts would pull its WASM back into every client bundle (ADR 0007).
  {
    files: ['packages/sim/**/*.ts'],
    ignores: ['packages/sim/src/core/physics.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [{ group: ['@dimforge/*'], allowTypeImports: true, message: 'Rapier loads on demand in core/physics.ts (ADR 0007). Import its types only, and use the helpers in core/physics.ts.' }],
      }],
    },
  },
  {
    files: ['packages/client/**/*.ts'],
    ignores: ['packages/client/src/online/**'],
    rules: restrictImports(RAPIER, BITECS, SERVER_PKG, SIM_DEEP, COLYSEUS_OUTSIDE_ONLINE),
  },
  {
    files: ['packages/client/src/online/**/*.ts'],
    rules: restrictImports(RAPIER, BITECS, SERVER_PKG, SIM_DEEP),
  },
  // Later blocks replace a rule's whole setting, so each of the three repeats what all server files share.
  {
    files: ['packages/server/**/*.ts'],
    ignores: ['packages/server/src/front/**', 'packages/server/src/world/**'],
    rules: restrictImports(PHASER, CLIENT_PKG, SIM_DEEP, FRONT_DEEP, WORLD_DEEP),
  },
  {
    files: ['packages/server/src/front/**/*.ts'],
    rules: restrictImports(PHASER, CLIENT_PKG, SIM_DEEP, WORLD_ANY, COLYSEUS_IN_FRONT, OUT_OF_HALF),
  },
  {
    files: ['packages/server/src/world/**/*.ts'],
    rules: restrictImports(PHASER, CLIENT_PKG, SIM_DEEP, FRONT_ANY, HTTP_LIBRARIES_IN_WORLD, OUT_OF_HALF),
  },
  // `__testing__` exports exist for tests only. Later blocks replace a rule's
  // whole setting, so the sim block repeats NEW_DATE here.
  {
    files: ['packages/sim/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: { 'no-restricted-syntax': ['error', NEW_DATE, TESTING_IMPORT] },
  },
  {
    files: ['packages/client/**/*.ts', 'packages/server/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: { 'no-restricted-syntax': ['error', TESTING_IMPORT] },
  },
]);
