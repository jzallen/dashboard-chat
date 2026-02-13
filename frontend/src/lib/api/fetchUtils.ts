/**
 * Shared fetch utilities for API and chat worker clients.
 */

export const TOKEN_KEY = "auth_token";

export function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Generic response handler with 401 → logout redirect.
 */
export async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem("auth_user");
    window.location.href = "/login";
    throw new Error("Session expired");
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed (${response.status}): ${text}`);
  }
  return response.json();
}
