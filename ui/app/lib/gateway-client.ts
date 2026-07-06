/**
 * gateway-client — the browser's ONLY HTTP transport to the backend, and it
 * reaches it exclusively through the same-origin `/ui-server/*` gateway (the SSR
 * broker that forwards to the backend through auth-proxy). It is the successor to
 * the retired `catalog/dataSources/backendClient`, which fetched the backend
 * `/api` data plane browser-direct; every call here targets a `/ui-server/*` path
 * instead, so the browser never touches `/api`.
 *
 * Auth rides the httpOnly session cookie: each helper sets `credentials:"include"`
 * so the same-origin cookie is sent to the `/ui-server` route, which re-verifies
 * it and mints the downstream Bearer server-side. No `Authorization` header is
 * built in the browser.
 *
 * The contract mirrors the retired transport so its consumers (the onboarding
 * client adapter, the catalog write ports) port over unchanged: a 2xx GET returns
 * the envelope-unwrapped payload; a 2xx POST/upload returns the RAW decoded body
 * (callers that need a JSON:API `data.id` read it themselves); a non-2xx throws
 * {@link ApiError}(status, body); a 401 also trips {@link handleUnauthorized}.
 */
import { handleUnauthorized } from "../auth/unauthorized";
import { ApiError } from "./api-error";

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
 * GET `path` (a same-origin `/ui-server/*` route) and return the unwrapped
 * payload. Sends the session cookie via `credentials:"include"`. Rejects on a
 * non-2xx response so the catalog's fallback keeps showing fixtures.
 */
export async function gatewayGet<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
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
 * PATCH `path` (a same-origin `/ui-server/*` action) with a JSON `body`. Cookie
 * session auth; throws on any non-2xx so the caller's optimistic write-through can
 * roll back. The response body is intentionally NOT returned — the write-through
 * revalidates the affected scope rather than trusting the PATCH echo.
 */
export async function gatewayPatch(path: string, body: unknown): Promise<void> {
  const response = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
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
 * POST `path` (a same-origin `/ui-server/*` action) with an optional JSON `body`,
 * returning the RAW decoded response. Cookie session auth; throws on any non-2xx.
 * The body IS returned (unlike PATCH) so callers that need a server-assigned id
 * (create) can read it off the JSON:API `data`.
 */
export async function gatewayPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
 * POST a multipart `FormData` body (file upload) to `path` (a same-origin
 * `/ui-server/*` action), returning the RAW decoded response. Unlike
 * {@link gatewayPost} it sets NO Content-Type — the browser must set the multipart
 * boundary itself. Cookie session auth; throws on any non-2xx.
 */
export async function gatewayUpload<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {},
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
