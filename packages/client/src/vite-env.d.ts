/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The world server to join (`ws://host:port` or `http://host:port`). Unset: a dev build runs its own sim (solo mode); a production build joins the origin it was served from. */
  readonly VITE_SERVER_URL?: string;
  /** `off` draws the local player from server states instead of predicting it (ADR 0012). Anything else, or unset, predicts. */
  readonly VITE_PREDICTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
