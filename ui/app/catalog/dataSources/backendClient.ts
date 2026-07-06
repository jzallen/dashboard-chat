/**
 * backendClient — the minimal HTTP read used by backend-backed catalog sources
 * (e.g. {@link metadataApiSource}). Native fetch, JSON, cookie-session auth.
 * Unwraps the response envelope: take `.data`, then flatten JSON:API
 * `{ type, id, attributes }` → flat `{ id, ...attributes }`.
 *
 * Auth rides an httpOnly `auth_token` cookie: every helper sets
 * `credentials:"include"` so the same-origin cookie is sent automatically, and
 * NO `Authorization` header is built. The `_token` parameter is retained as an
 * ignored seam (callers like {@link metadataApiSource} still pass one) but never
 * reaches the wire.
 *
 * Decoupled from `app/auth`: nothing here is imported from it, so the catalog
 * stays free of app-auth dependencies.
 */

import { handleUnauthorized } from "../../auth/unauthorized";
import { ApiError } from "../../lib/api-error";

/**
 * Re-exported from its relocation seam ({@link import("../../lib/api-error")}) so
 * every importer — old (`catalog/dataSources/backendClient`) and new
 * (`lib/api-error`) — shares ONE class identity while this module is retired.
 * Once every call site imports from the seam directly, this module (and this
 * re-export) is deleted.
 */
export { ApiError };

/** Read the error body as JSON, tolerant of a non-JSON (or empty) body → null. */
async function parseErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

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
 * GET `path` and return the unwrapped payload. Sends the session cookie via
 * `credentials:"include"`. Rejects on a non-2xx response so the catalog's
 * fallback keeps showing fixtures.
 */
export async function apiGet<T>(
  path: string,
  _token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const response = await fetch(path, {
    method: "GET",
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    if (response.status === 401) handleUnauthorized();
    throw new ApiError(
      response.status,
      await parseErrorBody(response),
      `GET ${path} failed with status ${response.status}`,
    );
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
 * PATCH `path` with a JSON `body`. Mirrors {@link apiGet}: cookie-session auth,
 * JSON content type, and a throw on any non-2xx response so the caller (the
 * catalog's optimistic write-through) can roll the optimistic state back. The
 * response body is intentionally NOT returned — the write-through revalidates the
 * affected scope from the read endpoints rather than trusting the PATCH echo.
 */
export async function apiPatch(
  path: string,
  body: unknown,
  _token?: string | null,
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const response = await fetch(path, {
    method: "PATCH",
    headers,
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 401) handleUnauthorized();
    throw new ApiError(
      response.status,
      await parseErrorBody(response),
      `PATCH ${path} failed with status ${response.status}`,
    );
  }
}

/**
 * POST `path` with an optional JSON `body`, returning the decoded response. Like
 * {@link apiPatch}: cookie-session auth and a throw on any non-2xx so the
 * write-through can roll back. The body IS returned (unlike PATCH) so callers
 * that need a server-assigned id (create) can read it; callers that don't
 * (archive/restore) ignore it.
 */
export async function apiPost<T>(
  path: string,
  body?: unknown,
  _token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const response = await fetch(path, {
    method: "POST",
    headers,
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 401) handleUnauthorized();
    throw new ApiError(
      response.status,
      await parseErrorBody(response),
      `POST ${path} failed with status ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}

/**
 * POST a multipart `FormData` body (file upload), returning the decoded response.
 * Unlike {@link apiPost} it sets NO Content-Type — the browser must set the
 * multipart boundary itself. Cookie-session auth; throws on any non-2xx.
 */
export async function apiUpload<T>(
  path: string,
  form: FormData,
  _token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {};

  const response = await fetch(path, {
    method: "POST",
    headers,
    credentials: "include",
    body: form,
  });
  if (!response.ok) {
    if (response.status === 401) handleUnauthorized();
    throw new ApiError(
      response.status,
      await parseErrorBody(response),
      `POST ${path} failed with status ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}
