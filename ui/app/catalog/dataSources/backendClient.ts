/**
 * backendClient — the minimal HTTP read used by backend-backed catalog sources
 * (e.g. {@link metadataApiSource}). Native fetch, JSON, optional Bearer auth.
 * Unwraps the response envelope: take `.data`, then flatten JSON:API
 * `{ type, id, attributes }` → flat `{ id, ...attributes }`.
 *
 * Decoupled from `app/auth`: the token is a PARAMETER, never imported here, so
 * the catalog stays free of app-auth dependencies.
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

/**
 * POST `path` with an optional JSON `body`, returning the decoded response. Like
 * {@link apiPatch}: optional Bearer auth and a throw on any non-2xx so the
 * write-through can roll back. The body IS returned (unlike PATCH) so callers
 * that need a server-assigned id (create) can read it; callers that don't
 * (archive/restore) ignore it.
 */
export async function apiPost<T>(
  path: string,
  body?: unknown,
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST ${path} failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

/**
 * POST a multipart `FormData` body (file upload), returning the decoded response.
 * Unlike {@link apiPost} it sets NO Content-Type — the browser must set the
 * multipart boundary itself. Optional Bearer auth; throws on any non-2xx.
 */
export async function apiUpload<T>(
  path: string,
  form: FormData,
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, { method: "POST", headers, body: form });
  if (!response.ok) {
    throw new Error(`POST ${path} failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}
