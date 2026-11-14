/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where "Get an estimate" sends visitors. Defaults to the local estimator. */
  readonly VITE_APP_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
