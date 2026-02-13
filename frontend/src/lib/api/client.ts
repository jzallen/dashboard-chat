/**
 * API Client for FastAPI Backend
 *
 * Provides typed fetch wrapper for communicating with the backend.
 */

import { TOKEN_KEY, getAuthHeaders } from "./fetchUtils";

const API_BASE_URL = import.meta.env.VITE_API_URL || "";

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
 * Generic API response handler
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem("auth_user");
    window.location.href = "/login";
    throw new ApiError(401, "Session expired");
  }
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
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
  });
  return handleResponse<T>(response);
}

/**
 * Make a POST request with JSON body
 */
export async function post<T>(endpoint: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(response);
}

/**
 * Make a PATCH request with JSON body
 */
export async function patch<T>(endpoint: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(response);
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

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: formData,
  });

  return handleResponse<T>(response);
}
