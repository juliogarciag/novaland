/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The world server to join (`ws://host:port` or `http://host:port`). Unset: a dev build runs its own sim (solo mode); a production build joins the origin it was served from. */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
