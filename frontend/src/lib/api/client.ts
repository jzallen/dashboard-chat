/**
 * API Client for FastAPI Backend
 *
 * Provides typed fetch wrapper for communicating with the backend.
 */

import { getAuthHeaders, withAuthRetry } from "./fetchUtils";

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
 * Generic API response handler with 401 → refresh → replay.
 * Delegates 401 retry logic to the shared withAuthRetry in fetchUtils.
 */
async function handleResponse<T>(
  response: Response,
  url: string,
  init: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await withAuthRetry(response, url, init);
  } catch {
    // withAuthRetry throws plain Error("Session expired") after hardLogout
    throw new ApiError(401, "Session expired");
  }
  if (!res.ok) {
    const errorBody = await res.text();
    let message = `Request failed with status ${res.status}`;
    try {
      const parsed = JSON.parse(errorBody);
      // Log full detail to console for debugging
      if (parsed.detail) {
        console.error(`[API ${parsed.type || res.status}]`, parsed.detail);
      }
      // Show user-friendly title/type, never raw server internals
      message = parsed.title || parsed.type || message;
    } catch {
      // Use default message
    }
    throw new ApiError(res.status, message);
  }
  const json = await res.json();

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
  const init: RequestInit = {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
  };
  const response = await fetch(url, init);
  return handleResponse<T>(response, url, init);
}

/**
 * Make a POST request with JSON body
 */
export async function post<T>(endpoint: string, body: unknown): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    body: JSON.stringify(body),
  };
  const response = await fetch(url, init);
  return handleResponse<T>(response, url, init);
}

/**
 * Make a PATCH request with JSON body
 */
export async function patch<T>(endpoint: string, body: unknown): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const init: RequestInit = {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    body: JSON.stringify(body),
  };
  const response = await fetch(url, init);
  return handleResponse<T>(response, url, init);
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
  const init: RequestInit = {
    method: "POST",
    headers: getAuthHeaders(),
    body: formData,
  };
  const response = await fetch(url, init);
  return handleResponse<T>(response, url, init);
}
