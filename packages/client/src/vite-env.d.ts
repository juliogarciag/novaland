/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The world server to join (`ws://host:port` or `http://host:port`). Unset: the client runs its own sim (solo mode). */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
