import { withAuth } from "../auth/withAuth";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiClientOptions {
  unwrapData?: boolean;
}

export class ApiClient {
  private unwrapData: boolean;

  constructor(
    private baseUrl: string,
    options?: ApiClientOptions
  ) {
    this.unwrapData = options?.unwrapData ?? true;
  }

  private get authedFetch() {
    return withAuth((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const errorBody = await response.text();
      let message = `Request failed with status ${response.status}`;
      try {
        const parsed = JSON.parse(errorBody);
        if (parsed.detail) {
          console.error(`[API ${parsed.type || response.status}]`, parsed.detail);
        }
        message = parsed.title || parsed.type || message;
      } catch {
        // Use default message
      }
      throw new ApiError(response.status, message);
    }
    const json = await response.json();

    if (this.unwrapData && json && typeof json === 'object' && 'data' in json) {
      return json.data as T;
    }

    return json;
  }

  private async request<T>(endpoint: string, init: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    try {
      const response = await this.authedFetch(url, init);
      return this.handleResponse<T>(response);
    } catch (e) {
      if (e instanceof Error && e.message === "Session expired") {
        throw new ApiError(401, "Session expired");
      }
      throw e;
    }
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
  }

  async post<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async patch<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async del<T = void>(endpoint: string): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    try {
      const response = await this.authedFetch(url, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      if (response.status === 204) return undefined as T;
      return this.handleResponse<T>(response);
    } catch (e) {
      if (e instanceof Error && e.message === "Session expired") {
        throw new ApiError(401, "Session expired");
      }
      throw e;
    }
  }

  async uploadFile<T>(
    endpoint: string,
    file: File,
    additionalFields: Record<string, string>
  ): Promise<T> {
    const formData = new FormData();
    formData.append("file", file);

    for (const [key, value] of Object.entries(additionalFields)) {
      formData.append(key, value);
    }

    const url = `${this.baseUrl}${endpoint}`;
    try {
      const response = await this.authedFetch(url, {
        method: "POST",
        body: formData,
      });
      return this.handleResponse<T>(response);
    } catch (e) {
      if (e instanceof Error && e.message === "Session expired") {
        throw new ApiError(401, "Session expired");
      }
      throw e;
    }
  }

  async fetch(endpoint: string, init?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${endpoint}`;
    try {
      return await this.authedFetch(url, init ?? {});
    } catch (e) {
      if (e instanceof Error && e.message === "Session expired") {
        throw new ApiError(401, "Session expired");
      }
      throw e;
    }
  }
}
