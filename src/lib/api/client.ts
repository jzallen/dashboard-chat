/**
 * API Client for FastAPI Backend
 *
 * Provides typed fetch wrapper for communicating with the backend.
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

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
  if (!response.ok) {
    const errorBody = await response.text();
    let message = `Request failed with status ${response.status}`;
    try {
      const parsed = JSON.parse(errorBody);
      message = parsed.detail || message;
    } catch {
      // Use default message
    }
    throw new ApiError(response.status, message);
  }
  return response.json();
}

/**
 * Make a GET request
 */
export async function get<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
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
    },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(response);
}

/**
 * Make a DELETE request
 */
export async function del<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
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
    body: formData,
  });

  return handleResponse<T>(response);
}
