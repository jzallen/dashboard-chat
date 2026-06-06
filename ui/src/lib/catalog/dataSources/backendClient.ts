/**
 * backendClient — the minimal HTTP read used by backend-backed catalog sources
 * (e.g. {@link metadataApiSource}). Native fetch, JSON, optional Bearer auth,
 * and the same envelope-unwrap the main frontend uses
 * (frontend/src/lib/http/apiClient.ts `handleResponse`): take `.data`, then
 * flatten JSON:API `{ type, id, attributes }` → flat `{ id, ...attributes }`.
 *
 * Decoupled from `ui/src/auth`: the token is a PARAMETER, never imported here, so
 * `lib/catalog` stays free of app-auth dependencies.
 */

/** Flatten a JSON:API resource `{ type, id, attributes }` into `{ id, ...attributes }`. */
function unwrapResource(item: unknown): unknown {
  if (
    item &&
    typeof item === "object" &&
    "attributes" in (item as Record<string, unknown>)
  ) {
    const record = item as Record<string, unknown>;
    return { id: record.id, ...(record.attributes as object) };
  }
  return item;
}

/**
 * GET `path` and return the unwrapped payload. Adds `Authorization: Bearer
 * <token>` when a token is given. Rejects on a non-2xx response so the catalog's
 * fallback keeps showing fixtures.
 */
export async function apiGet<T>(
  path: string,
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, { method: "GET", headers });
  if (!response.ok) {
    throw new Error(`GET ${path} failed with status ${response.status}`);
  }

  const json = await response.json();
  if (json && typeof json === "object" && "data" in json) {
    const data = (json as { data: unknown }).data;
    const result = Array.isArray(data)
      ? data.map(unwrapResource)
      : unwrapResource(data);
    return result as T;
  }
  return json as T;
}

/**
 * PATCH `path` with a JSON `body`. Mirrors {@link apiGet}: optional Bearer auth,
 * JSON content type, and a throw on any non-2xx response so the caller (the
 * catalog's optimistic write-through) can roll the optimistic state back. The
 * response body is intentionally NOT returned — the write-through revalidates the
 * affected scope from the read endpoints rather than trusting the PATCH echo.
 */
export async function apiPatch(
  path: string,
  body: unknown,
  token?: string | null,
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`PATCH ${path} failed with status ${response.status}`);
  }
}
