export interface ServerUrlChoice {
  /** `VITE_SERVER_URL` at build time, if set: `ws://`, `wss://`, `http://` or `https://` plus host and port. */
  readonly configured: string | undefined;
  /** A production build (`import.meta.env.PROD`). */
  readonly isProduction: boolean;
  /** The origin the page was loaded from (`window.location.origin`). */
  readonly pageOrigin: string;
}

/**
 * Where the client finds the world server, or undefined for the solo game.
 * A production build is served by the world server itself (one process, one
 * port), so it connects to its own origin unless `VITE_SERVER_URL` says
 * otherwise; a dev build is solo unless `VITE_SERVER_URL` is set, which is
 * how `pnpm dev` and `pnpm dev:online` differ.
 */
export function worldServerUrl({ configured, isProduction, pageOrigin }: ServerUrlChoice): string | undefined {
  if (configured !== undefined && configured.trim() !== '') return configured.trim();
  return isProduction ? pageOrigin : undefined;
}
