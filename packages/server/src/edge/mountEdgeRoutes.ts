import compression from 'compression';
import express, { type Application } from 'express';
import helmet from 'helmet';
import path from 'node:path';

export interface EdgeRoutesOptions {
  /** The client build to serve (`index.html`, `assets/`, `sprites/`), or undefined to serve none: in development Vite serves the client. */
  readonly clientDirectory: string | undefined;
  /** What `/healthz` reports, or undefined while there is nothing to report yet (answered `503`). */
  readonly health: () => Readonly<Record<string, unknown>> | undefined;
}

/**
 * Mounts every HTTP route that is not Colyseus's own on the Express app
 * Colyseus hands out: the security headers, `/healthz` and the built client.
 * Colyseus answers its matchmaking routes first and passes everything else
 * here, so nothing in this file ever sees a matchmaking call.
 *
 * The work is done by libraries, on purpose: `helmet` writes the headers,
 * `express.static` serves the files (conditional and range requests, `HEAD`,
 * no path out of the directory, no dotfiles) and `compression` compresses
 * them. Only the choices are made here.
 */
export function mountEdgeRoutes(app: Application, { clientDirectory, health }: EdgeRoutesOptions): void {
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: false, directives: CONTENT_SECURITY_POLICY },
      xFrameOptions: { action: 'deny' },
      // Whether the site is HTTPS-only is the host's decision, with the certificate: this process speaks plain HTTP behind it.
      strictTransportSecurity: false,
    }),
  );
  app.get('/healthz', (_request, response) => {
    const report = health();
    response.set('cache-control', 'no-store');
    if (report === undefined) {
      response.status(503).json({ ok: false });
      return;
    }
    response.json({ ok: true, ...report });
  });
  if (clientDirectory === undefined) return;
  app.use(compression());
  // Vite names the files under `assets/` by a hash of their content, so a name never changes what it holds: cache them for a year. Everything else is revalidated on every load.
  app.use('/assets', express.static(path.join(clientDirectory, 'assets'), { index: false, immutable: true, maxAge: '1y' }));
  app.use(express.static(clientDirectory));
}

// ---- Helpers ----

/**
 * Scripts and styles come from this origin (the inline `<style>` in
 * `index.html` needs `unsafe-inline`); the sim's physics is WebAssembly
 * inlined in the on-demand `assets/rapier-*.js` chunk, which a page that runs
 * its own sim loads (`wasm-unsafe-eval`, ADR 0007); Phaser builds textures from
 * `data:` and `blob:` URLs; the world room is reached on this origin (`'self'`
 * matches `ws`/`wss` to the same host).
 */
const CONTENT_SECURITY_POLICY = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'blob:'],
  connectSrc: ["'self'"],
  workerSrc: ["'self'", 'blob:'],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  frameAncestors: ["'none'"],
  formAction: ["'self'"],
};
