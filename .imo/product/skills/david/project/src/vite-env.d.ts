/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Dev/test-only override for the loopback feedback service base URL.
   * Undefined in production builds; consumed by feedbackTransport.ts.
   */
  readonly VITE_DAVID_FEEDBACK_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
