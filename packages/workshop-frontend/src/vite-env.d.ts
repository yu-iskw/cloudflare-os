/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Override the local backend host used by Vite dev, e.g. "localhost:8080".
  readonly VITE_BACKEND_HOST?: string;

  // Set to "true" to enable Identity-Aware Proxy session mode.
  // Password login is hidden and the app calls authenticateFromIap().
  readonly VITE_IAP_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare type Fetcher<T = unknown> = import('capnweb').RpcStub<T>;
