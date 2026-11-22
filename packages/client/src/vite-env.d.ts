/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The world server to join (`ws://host:port` or `http://host:port`). Unset: a dev build runs its own sim (solo mode); a production build joins the origin it was served from. */
  readonly VITE_SERVER_URL?: string;
  /** `off` draws the local player from server states instead of predicting it (ADR 0012). Anything else, or unset, predicts. */
  readonly VITE_PREDICTION?: string;
  /** Dev builds, solo only: a size such as `400x300` plays a generated map of that size instead of the world, to measure big maps. */
  readonly VITE_GENERATED_MAP?: string;
  /** Dev builds, solo only: the name of a region of the real Earth, such as `alps`, played instead of the world. Adding `?at=46.2,6.15` (a latitude and a longitude) to the address starts the walk on the walkable tile nearest to that place. */
  readonly VITE_REGION_MAP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
