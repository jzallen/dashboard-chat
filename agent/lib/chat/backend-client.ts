// SCAFFOLD: true — DISTILL RED scaffold for worker-tool-dispatch-refactor.
// Real implementation lands in PR 0 (DELIVER): a thin fetch wrapper that
// targets AUTH_PROXY_URL and forwards the user's JWT verbatim.

export const __SCAFFOLD__ = true;

const NOT_IMPLEMENTED = "Not yet implemented — RED scaffold (DISTILL output for worker-tool-dispatch-refactor)";

export type BackendClient = {
  post: (path: string, body: unknown) => Promise<unknown>;
  get: (path: string) => Promise<unknown>;
};

export type BackendClientConfig = {
  authProxyUrl: string;
  jwt: string;
};

export function backendClient(_config: BackendClientConfig): BackendClient {
  return {
    async post(_path, _body) { throw new Error(NOT_IMPLEMENTED); },
    async get(_path) { throw new Error(NOT_IMPLEMENTED); },
  };
}
