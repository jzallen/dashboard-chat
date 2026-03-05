/**
 * API Client for FastAPI Backend
 *
 * Provides typed fetch wrapper for communicating with the backend.
 */

import { withAuth } from "../auth/withAuth";
import { API_BASE_URL } from "./config";

export { API_BASE_URL };

const authedFetch = withAuth((...args: Parameters<typeof fetch>) => fetch(...args));

/**
 * API error with status code and message
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Generic API response handler.
 * Auth retry is handled by the authedFetch decorator.
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorBody = await response.text();
    let message = `Request failed with status ${response.status}`;
    try {
      const parsed = JSON.parse(errorBody);
      // Log full detail to console for debugging
      if (parsed.detail) {
        console.error(`[API ${parsed.type || response.status}]`, parsed.detail);
      }
      // Show user-friendly title/type, never raw server internals
      message = parsed.title || parsed.type || message;
    } catch {
      // Use default message
    }
    throw new ApiError(response.status, message);
  }
  const json = await response.json();

  // Unwrap {data: ...} responses from backend
  if (json && typeof json === 'object' && 'data' in json) {
    return json.data as T;
  }

  return json;
}

/**
 * Make a GET request
 */
export async function get<T>(endpoint: string): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  try {
    const response = await authedFetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    return handleResponse<T>(response);
  } catch (e) {
    if (e instanceof Error && e.message === "Session expired") {
      throw new ApiError(401, "Session expired");
    }
    throw e;
  }
}

/**
 * Make a POST request with JSON body
 */
export async function post<T>(endpoint: string, body: unknown): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  try {
    const response = await authedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return handleResponse<T>(response);
  } catch (e) {
    if (e instanceof Error && e.message === "Session expired") {
      throw new ApiError(401, "Session expired");
    }
    throw e;
  }
}

/**
 * Make a PATCH request with JSON body
 */
export async function patch<T>(endpoint: string, body: unknown): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  try {
    const response = await authedFetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return handleResponse<T>(response);
  } catch (e) {
    if (e instanceof Error && e.message === "Session expired") {
      throw new ApiError(401, "Session expired");
    }
    throw e;
  }
}

/**
 * Make a DELETE request
 */
export async function del<T = void>(endpoint: string): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  try {
    const response = await authedFetch(url, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    if (response.status === 204) return undefined as T;
    return handleResponse<T>(response);
  } catch (e) {
    if (e instanceof Error && e.message === "Session expired") {
      throw new ApiError(401, "Session expired");
    }
    throw e;
  }
}

/**
 * Upload a file with form data
 */
export async function uploadFile<T>(
  endpoint: string,
  file: File,
  additionalFields: Record<string, string>
): Promise<T> {
  const formData = new FormData();
  formData.append("file", file);

  for (const [key, value] of Object.entries(additionalFields)) {
    formData.append(key, value);
  }

  const url = `${API_BASE_URL}${endpoint}`;
  try {
    const response = await authedFetch(url, {
      method: "POST",
      body: formData,
    });
    return handleResponse<T>(response);
  } catch (e) {
    if (e instanceof Error && e.message === "Session expired") {
      throw new ApiError(401, "Session expired");
    }
    throw e;
  }
}
