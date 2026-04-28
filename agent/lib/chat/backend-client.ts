export type BackendClient = {
  post: (path: string, body: unknown) => Promise<unknown>;
  get: (path: string) => Promise<unknown>;
};

export type BackendClientConfig = {
  authProxyUrl: string;
  jwt: string;
};

export class BackendClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = "BackendClientError";
  }
}

export function backendClient(config: BackendClientConfig): BackendClient {
  const { authProxyUrl, jwt } = config;
  const base = authProxyUrl.replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${jwt}`,
    "Content-Type": "application/json",
  };

  async function request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
    const init: RequestInit = {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
    const res = await fetch(url, init);
    const text = await res.text();
    if (!res.ok) {
      throw new BackendClientError(res.status, text, `${method} ${path} failed: ${res.status}`);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return {
    post: (path, body) => request("POST", path, body),
    get: (path) => request("GET", path),
  };
}
