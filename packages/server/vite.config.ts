import { defineConfig } from 'vite';

/**
 * `pnpm --filter @novaland/server build`: an ESM bundle, `dist/index.mjs`,
 * that `node` runs without tsx, plus the Rapier chunk it imports on demand
 * (`dist/assets/rapier-*.js`, ADR 0007). The sim is a workspace package of TypeScript
 * sources, so it and its own dependencies are bundled in; everything the
 * server itself depends on (Colyseus, express, ws) stays in `node_modules`.
 */
export default defineConfig({
  build: {
    ssr: 'src/index.ts',
    target: 'node22',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: { output: { entryFileNames: 'index.mjs' } },
  },
  ssr: {
    target: 'node',
    noExternal: ['@novaland/sim', '@dimforge/rapier2d-deterministic-compat', 'bitecs'],
  },
});
