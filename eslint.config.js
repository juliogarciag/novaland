import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Package boundaries.
 *
 * sim    -> may import: bitecs, rapier. Never phaser, DOM, client, server, colyseus.
 * client -> may import: phaser, @novaland/sim (package entry only). Never rapier, bitecs, server.
 * server -> may import: @novaland/sim (package entry only), colyseus. Never phaser, client.
 *
 * Violations fail `pnpm lint`. Keep the lists below in sync with AGENTS.md.
 */
const group = (patterns, message) => ({ group: patterns, message });

const PHASER = group(['phaser', 'phaser/*'], 'Phaser is rendering/input only and lives in packages/client.');
const RAPIER = group(['@dimforge/*'], 'Physics lives in packages/sim. The client only reads sim state.');
const BITECS = group(['bitecs', 'bitecs/*'], 'The ECS lives in packages/sim. Use the sim public API.');
const COLYSEUS = group(['colyseus', 'colyseus/*', '@colyseus/*'], 'Networking belongs to packages/server (and later a client adapter), not here.');
const CLIENT_PKG = group(['@novaland/client', '@novaland/client/*', '**/packages/client/**', '../**/client/**'], 'Nothing may depend on the client. It is a view.');
const SERVER_PKG = group(['@novaland/server', '@novaland/server/*', '**/packages/server/**', '../**/server/**'], 'Nothing may depend on the server.');
const NODE_BUILTINS = group(['node:*', 'fs', 'fs/*', 'path', 'os', 'crypto', 'child_process', 'worker_threads', 'http', 'https', 'net', 'events', 'stream', 'util', 'url'], 'The sim is headless and pure: no Node APIs in packages/sim.');
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
    files: ['*.js', '*.ts', 'packages/server/**/*.ts', 'packages/client/vite.config.ts', 'packages/client/tools/**/*.mjs', 'verifications/**/*.{js,mjs,ts}'],
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
  {
    files: ['packages/client/**/*.ts'],
    rules: restrictImports(RAPIER, BITECS, SERVER_PKG, SIM_DEEP),
  },
  {
    files: ['packages/server/**/*.ts'],
    rules: restrictImports(PHASER, CLIENT_PKG, SIM_DEEP),
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
