/// <reference types="vite/client" />

/**
 * Typed view of the environment variables this app is allowed to read.
 *
 * Everything here is compiled into the browser bundle and is therefore PUBLIC.
 * Secrets (database URLs, JWT signing keys, SMTP credentials) live only in the
 * server's .env and must never appear in this interface.
 */
interface ImportMetaEnv {
  /** Base URL for API calls. Defaults to the same-origin '/api' proxy. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv & {
    readonly DEV: boolean;
    readonly PROD: boolean;
    readonly MODE: string;
  };
}
