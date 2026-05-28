import { randomBytes } from "node:crypto";

import { Hono } from "hono";

import { IDENTITY_HEADERS, isPublicPath, verifyToken } from "./lib/auth.ts";
import {
  authenticateClient,
  isM2mEnabled,
  isM2mToken,
  issueM2mToken,
} from "./lib/m2m.ts";
import { openApiDocument } from "./lib/openapi.ts";
import {
  isPatToken,
  issuePat,
  listPatsForUser,
  patListItem,
  revokePat,
} from "./lib/pat.ts";
import {
  deleteSession,
  getSession,
  getSessionStatus,
  setSession,
} from "./lib/session-store.ts";
import { isUserToken, verifyUserToken } from "./lib/user-token.ts";
import {
  computeOrgCreateReissue,
  type ReissueBaseClaims,
} from "./lib/post-response-reissue.ts";
import { createDevProvider } from "./lib/user-auth/dev.ts";
import {
  type SessionStorePort,
  type UserAuthProvider,
  WorkOsUserAuthProvider,
  type WorkOsConfig,
} from "./lib/user-auth/workos.ts";

const BACKEND_URL = process.env.BACKEND_URL || "http://api:8000";
const UI_STATE_URL = process.env.UI_STATE_URL || "http://ui-state:8788";

// Reissue headers that ONLY auth-proxy may set (Stage 2 of
// auth-proxy-mints-user-tokens). Mirrors the inbound IDENTITY_HEADERS strip:
// any value an upstream tries to set is dropped before relaying, so a
// compromised backend cannot smuggle a token the FE would silently adopt
// (design.md R7). auth-proxy's own injection is applied AFTER this strip.
const REISSUE_HEADERS = ["x-new-access-token", "x-new-token-expires-in"];

/** Copy `src` minus any upstream-supplied reissue headers (R7). */
function stripReissueHeaders(src: Headers): Headers {
  const headers = new Headers(src);
  for (const name of REISSUE_HEADERS) headers.delete(name);
  return headers;
}

// Test-mirror cell for the frontend-coexistence acceptance suite (DD-10,
// Phase 02). Captures the most-recent `Authorization` header observed on
// `/ui-state/*` proxy calls so the `@bearer-forward` scenario can verify
// the SSR loader forwarded the browser's bearer verbatim. Dev-mode gated:
// in production both the capture branch and the read endpoint are 404.
let lastSeenAuthorization: string | null = null;

const app = new Hono();

// Health endpoint — handled locally, not proxied
app.get("/health", (c) => c.json({ status: "ok" }));

// OpenAPI 3.x spec for the auth-proxy's owned surface (token + PAT lifecycle).
// Built once at module load from the Zod schemas in lib/schemas.ts.
app.get("/openapi.json", (c) => c.json(openApiDocument));

// User-token login — initiates the OIDC/dev login flow.
// In AUTH_MODE=dev the auth-proxy short-circuits the WorkOS round-trip and
// returns a redirect URL that carries the synthetic "dev-auth-code" the
// `/api/auth/callback` handler recognises. In AUTH_MODE=workos this will
// (under later rows) return the WorkOS authorize URL with a CSRF state.
app.get("/api/auth/login", async (c) => {
  const authMode = process.env.AUTH_MODE || "dev";
  if (authMode === "dev") {
    const redirectUri =
      process.env.WORKOS_REDIRECT_URI || "http://localhost:5173/auth/callback";
    return c.json({ url: `${redirectUri}?code=dev-auth-code` });
  }

  // workos mode: build the authorize URL with a per-request CSRF state
  // that /api/auth/callback validates against the value remembered here.
  const clientId = process.env.WORKOS_CLIENT_ID || "";
  const redirectUri = process.env.WORKOS_REDIRECT_URI || "";
  const state = randomBytes(24).toString("base64url");
  rememberLoginState(state);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    provider: "authkit",
    state,
  });
  return c.json({
    url: `https://api.workos.com/user_management/authorize?${params.toString()}`,
  });
});

// In-memory CSRF state store for OIDC login. States are short-lived
// (one-shot per login) so an in-process Set is sufficient; we'll
// replace this with the session-store seam once row #4 lands.
const pendingLoginStates = new Set<string>();
function rememberLoginState(state: string): void {
  pendingLoginStates.add(state);
}
function consumeLoginState(state: string): boolean {
  return pendingLoginStates.delete(state);
}

// Exchange an auth code for a user token. The mode-dispatched provider
// validates the code (and, in WorkOS mode, the CSRF state that must
// round-trip through a prior /api/auth/login).
app.post("/api/auth/callback", async (c) => {
  const authMode = process.env.AUTH_MODE || "dev";

  let body: { code?: unknown; state?: unknown } = {};
  try {
    body = (await c.req.raw.json()) as { code?: unknown; state?: unknown };
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const code = typeof body.code === "string" ? body.code : "";
  const state = typeof body.state === "string" ? body.state : "";

  if (authMode !== "dev") {
    if (!state || !consumeLoginState(state)) {
      return c.json({ error: "state_mismatch" }, 400);
    }
  }

  try {
    const { accessToken, expiresIn } = await createProviderForRequest()
      .handleCallback({ code, state });
    return c.json({ access_token: accessToken, expires_in: expiresIn });
  } catch (e) {
    return mapProviderError(c, e);
  }
});

// Exchange a still-valid user token for a fresh one. The Bearer carries
// the sid; the session-store entry resolves the user_claims to embed in
// the freshly-minted token. The session-store's WorkOS refresh token is
// NOT returned in the body — it never leaves the server (OQ1 (b)).
app.post("/api/auth/refresh", async (c) => {
  const authHeader = c.req.header("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return c.json({ error: "invalid_session" }, 401);
  }
  const inbound = authHeader.slice(7);

  let payload: Awaited<ReturnType<typeof verifyUserToken>>;
  try {
    payload = await verifyUserToken(inbound);
  } catch {
    return c.json({ error: "invalid_session" }, 401);
  }

  const sid = typeof payload.sid === "string" ? payload.sid : "";
  if (!sid) {
    return c.json({ error: "invalid_session" }, 401);
  }
  const lookup = getSessionStatus(sid);
  if (lookup.status === "missing") {
    return c.json({ error: "invalid_session" }, 401);
  }
  if (lookup.status === "expired") {
    return c.json({ error: "session_expired" }, 401);
  }

  try {
    const { accessToken, expiresIn } =
      await createProviderForRequest().refresh(sid);
    return c.json({ access_token: accessToken, expires_in: expiresIn });
  } catch (e) {
    return mapProviderError(c, e);
  }
});

// Log out: delete the server-held session entry so subsequent refresh
// attempts with the same token fail with invalid_session. 204 is
// returned regardless of whether the Bearer was valid — the FE just
// wants to know the server let go (idempotency by design).
app.post("/api/auth/logout", async (c) => {
  const authHeader = c.req.header("Authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const payload = await verifyUserToken(token);
      const sid = typeof payload.sid === "string" ? payload.sid : "";
      if (sid) await createProviderForRequest().logout(sid);
    } catch {
      // Verification failure: treat as already-logged-out, no-op delete.
    }
  }
  return c.body(null, 204);
});

/**
 * Construct the right `UserAuthProvider` for the current request based on
 * `AUTH_MODE`. Built per-request so each call observes the live env; the
 * session-store port is the shared module so dev/workos see the same
 * entries.
 */
function createProviderForRequest(): UserAuthProvider {
  const sessionStore: SessionStorePort = {
    set: setSession,
    get: getSession,
    getStatus: getSessionStatus,
    delete: deleteSession,
  };
  if ((process.env.AUTH_MODE || "dev") === "dev") {
    return createDevProvider({ sessionStore });
  }
  const config: WorkOsConfig = {
    baseUrl: process.env.WORKOS_BASE || "https://api.workos.com",
    clientId: process.env.WORKOS_CLIENT_ID || "",
    clientSecret: process.env.WORKOS_API_KEY || "",
    redirectUri: process.env.WORKOS_REDIRECT_URI || "",
    sessionTtlSeconds: 3600,
    revokeOnLogout: process.env.WORKOS_REVOKE_ON_LOGOUT === "true",
  };
  return new WorkOsUserAuthProvider({ sessionStore, config });
}

/**
 * Translate a provider exception into the HTTP response the OAuth-style
 * endpoints already returned for the inlined-fetch path.
 */
function mapProviderError(
  c: { json: (body: unknown, status: number) => Response },
  err: unknown,
): Response {
  const message = err instanceof Error ? err.message : "";
  if (message === "invalid_code") {
    return c.json({ error: "invalid_code" }, 401);
  }
  if (message === "unauthorized") {
    return c.json({ error: "unauthorized" }, 401);
  }
  if (message === "invalid_session") {
    return c.json({ error: "invalid_session" }, 401);
  }
  return c.json({ error: "service_error" }, 502);
}

// M2M token issuance — OAuth2 client_credentials grant.
// Flag-gated by M2M_ENABLED. Disabled by default; returns 404 until enabled.
app.post("/api/auth/token", async (c) => {
  if (!isM2mEnabled()) {
    return c.json({ error: "not_found" }, 404);
  }

  const body = await readTokenRequest(c.req.raw);
  if (!body) {
    return c.json(
      { error: "invalid_request", error_description: "malformed body" },
      400,
    );
  }

  const grantType = body.get("grant_type");
  if (grantType !== "client_credentials") {
    return c.json({ error: "unsupported_grant_type" }, 400);
  }

  const clientId = body.get("client_id");
  const clientSecret = body.get("client_secret");
  if (!clientId || !clientSecret) {
    return c.json(
      {
        error: "invalid_request",
        error_description: "client_id and client_secret are required",
      },
      400,
    );
  }

  const client = await authenticateClient(clientId, clientSecret);
  if (!client) {
    return c.json({ error: "invalid_client" }, 401);
  }

  const { token, expiresIn } = await issueM2mToken(client);
  return c.json({
    access_token: token,
    token_type: "Bearer",
    expires_in: expiresIn,
  });
});

// PAT (Personal Access Token) lifecycle — issue / list / revoke.
// All endpoints require a real user JWT (NOT a PAT, NOT an M2M token);
// see `requireUserAuth`. Flag-gated by M2M_ENABLED.
app.post("/api/auth/pats", async (c) => {
  if (!isM2mEnabled()) return c.json({ error: "not_found" }, 404);

  const user = await requireUserAuth(c.req.header("Authorization") || "");
  if (user.kind === "missing") {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }
  if (user.kind === "invalid") {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
  if (user.kind === "non-user") {
    return c.json(
      { error: "PATs may only be issued by an authenticated user" },
      403,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await c.req.raw.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return c.json(
      { error: "invalid_request", error_description: "name is required" },
      400,
    );
  }

  const expiresInRaw = body.expires_in_seconds;
  const expiresInSeconds =
    typeof expiresInRaw === "number" && Number.isFinite(expiresInRaw)
      ? expiresInRaw
      : null;

  const { record, token } = await issuePat(
    { sub: user.identity.userId, orgId: user.identity.orgId, email: user.identity.email },
    { name, expiresInSeconds },
  );

  return c.json(
    {
      id: record.id,
      token,
      name: record.name,
      created_at: record.createdAt,
      expires_at: record.expiresAt,
    },
    201,
  );
});

app.get("/api/auth/pats", async (c) => {
  if (!isM2mEnabled()) return c.json({ error: "not_found" }, 404);

  const user = await requireUserAuth(c.req.header("Authorization") || "");
  if (user.kind === "missing") {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }
  if (user.kind === "invalid") {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
  if (user.kind === "non-user") {
    return c.json(
      { error: "PATs may only be managed by an authenticated user" },
      403,
    );
  }

  const pats = listPatsForUser(user.identity.userId).map(patListItem);
  return c.json({ pats });
});

app.delete("/api/auth/pats/:id", async (c) => {
  if (!isM2mEnabled()) return c.json({ error: "not_found" }, 404);

  const user = await requireUserAuth(c.req.header("Authorization") || "");
  if (user.kind === "missing") {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }
  if (user.kind === "invalid") {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
  if (user.kind === "non-user") {
    return c.json(
      { error: "PATs may only be managed by an authenticated user" },
      403,
    );
  }

  const id = c.req.param("id");
  const ok = revokePat(id, user.identity.userId);
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
});

// UI-state tier — multi-upstream routing per ADR-030 §SD1.
// Routed BEFORE the catch-all backend proxy. In AUTH_MODE=dev the ui-state
// tier is accessed without a Bearer token (the dev user identity is implied);
// in production this branch verifies the token and forwards identity headers
// just like the backend branch. The `/ui-state` path prefix is stripped
// before forwarding so the upstream sees its own routes (`/health`,
// `/flow/:machine/begin`, etc.).
app.all("/ui-state/*", async (c) => {
  // SLOW_MODE_DELAY_MS — frontend-coexistence Slice-4 / MR-3 induction
  // mechanism (DD-18). When set AND AUTH_MODE !== "production", the
  // /ui-state/* handler sleeps the configured ms before proceeding.
  // Production-gated so this surface cannot leak into deployed environments.
  const slowModeDelayMs = parseInt(process.env.SLOW_MODE_DELAY_MS ?? "0", 10);
  if (slowModeDelayMs > 0 && (process.env.AUTH_MODE || "dev") !== "production") {
    await new Promise((r) => setTimeout(r, slowModeDelayMs));
  }

  const path = c.req.path;
  const strippedPath = path.replace(/^\/ui-state/, "") || "/";

  // Test-mirror capture (DD-10, Phase 02). In non-production modes, record
  // the inbound Authorization header so the `@bearer-forward` acceptance
  // scenario can read it back via `GET /test/last-seen-authorization`. The
  // capture is the raw header value (including the "Bearer " prefix) or
  // null when the header is absent.
  if ((process.env.AUTH_MODE || "dev") !== "production") {
    lastSeenAuthorization = c.req.header("Authorization") ?? null;
  }

  const incomingHeaders = new Headers();
  c.req.raw.headers.forEach((value, key) => {
    if (!IDENTITY_HEADERS.includes(key.toLowerCase())) {
      incomingHeaders.set(key, value);
    }
  });

  // In dev mode, inject hardcoded DEV_USER identity headers without
  // requiring a Bearer token. This mirrors how the agent uses headers
  // injected by auth-proxy upstream. The walking skeleton runs in dev mode.
  const authMode = process.env.AUTH_MODE || "dev";
  if (authMode === "dev") {
    incomingHeaders.set("X-User-Id", "dev-user-001");
    incomingHeaders.set("X-Org-Id", "dev-org-001");
    incomingHeaders.set("X-User-Email", "dev@localhost");
  } else {
    // Production: require a verified token, just like the catch-all branch.
    const authHeader = c.req.header("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return c.json(
        { error: "Missing or invalid Authorization header" },
        401,
      );
    }
    try {
      const identity = await verifyToken(authHeader.slice(7));
      incomingHeaders.set("X-User-Id", identity.userId);
      incomingHeaders.set("X-Org-Id", identity.orgId);
      incomingHeaders.set("X-User-Email", identity.email);
    } catch {
      return c.json({ error: "Invalid or expired token" }, 401);
    }
  }

  // Capture the inbound event type BEFORE we consume the body for proxying.
  // Per ADR-030 §SD4 the auth-proxy emits KPI K3 events on transitions:
  //   - auth_retry_clicked: identified from the inbound event payload
  //   - auth_recoverable_error_shown: identified from the upstream projection
  //   - ready_reached: identified from the upstream projection
  const inboundEventType = await peekInboundEventType(c.req.raw);

  const response = await proxyToUpstream(
    c,
    UI_STATE_URL,
    strippedPath,
    incomingHeaders,
  );

  // Inspect the upstream response body (clone so we don't consume the
  // stream the caller will receive). Best-effort: invalid JSON, opaque
  // responses, etc. are silently ignored — these events are observational.
  // Awaited so that the events land in stdout before we return to the
  // caller (matters for test spies and for tail-and-ship log pipelines
  // that batch on response close).
  try {
    await emitKpiEventsForResponse(response.clone(), inboundEventType);
  } catch {
    // Silent — KPI emission is best-effort and must not break the proxy.
  }

  return response;
});

/**
 * Read the inbound JSON body (if any) and return the event `type` for
 * `/ui-state/flow/*\/event` requests. Returns null for `begin` (which
 * has no type) or non-JSON bodies. Cloning is necessary because Hono's
 * downstream `proxyToUpstream` reads `c.req.raw.body` too — a stream can
 * only be consumed once. We tee via `Request.clone()`.
 */
async function peekInboundEventType(req: Request): Promise<string | null> {
  try {
    const cloned = req.clone();
    const contentType = (cloned.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("application/json")) return null;
    const json = (await cloned.json()) as { type?: unknown };
    return typeof json?.type === "string" ? json.type : null;
  } catch {
    return null;
  }
}

/**
 * Inspect the upstream response and emit any matching KPI K3 events to
 * stdout as JSON lines. The ui-state tier's projection envelope shape
 * is `{ state, request_id, context: { underlying_cause_tag? } }`.
 * Events:
 *   - state === "error_recoverable"  → auth_recoverable_error_shown
 *   - state === "ready"              → ready_reached
 *   - inbound type === "retry_clicked" → auth_retry_clicked
 */
async function emitKpiEventsForResponse(
  response: Response,
  inboundEventType: string | null,
): Promise<void> {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return;
  let body: {
    state?: unknown;
    request_id?: unknown;
    context?: { underlying_cause_tag?: unknown };
  };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return;
  }
  const requestId =
    typeof body?.request_id === "string" ? body.request_id : undefined;
  const state = typeof body?.state === "string" ? body.state : undefined;
  const tag =
    typeof body?.context?.underlying_cause_tag === "string"
      ? body.context.underlying_cause_tag
      : undefined;

  if (inboundEventType === "retry_clicked") {
    emitKpiEvent({
      event: "auth_retry_clicked",
      request_id: requestId,
      underlying_cause_tag: tag,
    });
  }
  if (state === "error_recoverable") {
    emitKpiEvent({
      event: "auth_recoverable_error_shown",
      request_id: requestId,
      underlying_cause_tag: tag,
    });
  }
  if (state === "ready") {
    emitKpiEvent({
      event: "ready_reached",
      request_id: requestId,
    });
  }
}

function emitKpiEvent(payload: {
  event: string;
  request_id?: string;
  underlying_cause_tag?: string;
}): void {
  // stdout-JSON observability per ADR-030 §SD4. One event per line so
  // downstream log shippers can tail-and-split without buffering.
  const line = JSON.stringify(payload);
  process.stdout.write(`${line}\n`);
}

// Test-mirror read endpoint (DD-10, Phase 02). Returns the most-recent
// `Authorization` header observed on `/ui-state/*` proxy calls as plain text.
// Returns the empty string when no /ui-state/* request has been seen yet.
// Dev-mode gated: in production this endpoint is 404 so the test surface
// never leaks into deployed environments.
app.get("/test/last-seen-authorization", (c) => {
  if ((process.env.AUTH_MODE || "dev") === "production") {
    return c.json({ error: "not_found" }, 404);
  }
  return c.text(lastSeenAuthorization ?? "");
});

// All other requests: authenticate then proxy
app.all("*", async (c) => {
  const path = c.req.path;

  // Build headers for the proxied request, stripping identity headers
  const incomingHeaders = new Headers();
  c.req.raw.headers.forEach((value, key) => {
    if (!IDENTITY_HEADERS.includes(key.toLowerCase())) {
      incomingHeaders.set(key, value);
    }
  });

  // Public paths: forward without auth
  if (isPublicPath(path)) {
    return proxyRequest(c, incomingHeaders);
  }

  // Extract Bearer token
  const authHeader = c.req.header("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return c.json(
      { error: "Missing or invalid Authorization header" },
      401
    );
  }

  const token = authHeader.slice(7);

  try {
    const identity = await verifyToken(token);

    // Set identity headers for the backend
    incomingHeaders.set("X-User-Id", identity.userId);
    incomingHeaders.set("X-Org-Id", identity.orgId);
    incomingHeaders.set("X-User-Email", identity.email);

    const upstream = await proxyRequest(c, incomingHeaders);
    return applyOrgCreateReissue(c, upstream, token);
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
});

/**
 * Stage 2 reissue (design.md §3.4): when the just-proxied request was a
 * successful `POST /api/orgs`, mint a fresh user token carrying the new
 * `org_id` and attach it as `X-New-Access-Token` (+ `X-New-Token-Expires-In`)
 * so the FE's stored token updates atomically with org-create — no separate
 * `/api/auth/reissue` round-trip. The mint preserves the caller's identity
 * (`sub`/`email`/`name`/`sid`) decoded from their verified user token; only
 * `org_id` changes. Non-user callers (PAT/M2M) have no preservable session, so
 * the hook does not fire. `proxyRequest` has already stripped any
 * upstream-supplied reissue headers (R7), so only this injection survives.
 */
async function applyOrgCreateReissue(
  c: { req: { raw: Request; url: string } },
  upstream: Response,
  token: string,
): Promise<Response> {
  // Cheap path/method/status guards before touching the body. The hook itself
  // re-checks, but this keeps every non-org-create request zero-overhead.
  if (c.req.raw.method.toUpperCase() !== "POST") return upstream;
  if (new URL(c.req.url).pathname !== "/api/orgs") return upstream;
  if (upstream.status !== 201) return upstream;

  let baseClaims: ReissueBaseClaims | null = null;
  if (isUserToken(token)) {
    try {
      const payload = await verifyUserToken(token);
      baseClaims = {
        sub: typeof payload.sub === "string" ? payload.sub : "",
        email: typeof payload.email === "string" ? payload.email : "",
        name: typeof payload.name === "string" ? payload.name : "",
        sid: typeof payload.sid === "string" ? payload.sid : "",
      };
    } catch {
      baseClaims = null;
    }
  }

  let body: unknown = null;
  try {
    body = await upstream.clone().json();
  } catch {
    body = null;
  }

  const reissue = await computeOrgCreateReissue({
    method: c.req.raw.method,
    path: new URL(c.req.url).pathname,
    status: upstream.status,
    body,
    baseClaims,
  });
  if (!reissue) return upstream;

  const headers = stripReissueHeaders(upstream.headers);
  headers.set("X-New-Access-Token", reissue.token);
  headers.set("X-New-Token-Expires-In", String(reissue.expiresIn));
  return new Response(upstream.body, { status: upstream.status, headers });
}

/**
 * Read an OAuth2 token-endpoint request body.
 * Accepts both application/x-www-form-urlencoded (RFC 6749 §4.4) and JSON
 * for ergonomics. Returns a Map-like getter; null on parse failure.
 */
async function readTokenRequest(
  req: Request,
): Promise<{ get: (key: string) => string | null } | null> {
  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  try {
    if (contentType.includes("application/json")) {
      const json = (await req.json()) as Record<string, unknown>;
      return {
        get: (key) => {
          const v = json?.[key];
          return typeof v === "string" ? v : null;
        },
      };
    }
    // Default: form-encoded (the OAuth2 spec's mandated shape).
    const form = await req.formData();
    return {
      get: (key) => {
        const v = form.get(key);
        return typeof v === "string" ? v : null;
      },
    };
  } catch {
    return null;
  }
}

async function proxyRequest(c: { req: { raw: Request; url: string } }, headers: Headers) {
  const url = new URL(c.req.url);
  const targetUrl = `${BACKEND_URL}${url.pathname}${url.search}`;

  // Remove host header so the backend sees its own host
  headers.delete("host");

  const response = await fetch(targetUrl, {
    method: c.req.raw.method,
    headers,
    body: c.req.raw.body,
    // @ts-expect-error Node.js fetch supports duplex for streaming bodies
    duplex: "half",
  });

  return new Response(response.body, {
    status: response.status,
    headers: stripReissueHeaders(response.headers),
  });
}

/**
 * Proxy to an arbitrary upstream with the given path. Used by the
 * multi-upstream routing rules added in ADR-030 §SD1 (ui-state tier).
 */
async function proxyToUpstream(
  c: { req: { raw: Request; url: string } },
  upstreamBaseUrl: string,
  upstreamPath: string,
  headers: Headers,
) {
  const url = new URL(c.req.url);
  const targetUrl = `${upstreamBaseUrl}${upstreamPath}${url.search}`;

  headers.delete("host");

  const response = await fetch(targetUrl, {
    method: c.req.raw.method,
    headers,
    body: c.req.raw.body,
    // @ts-expect-error Node.js fetch supports duplex for streaming bodies
    duplex: "half",
  });

  return new Response(response.body, {
    status: response.status,
    headers: stripReissueHeaders(response.headers),
  });
}

/**
 * Authenticate a Bearer header as a real end-user JWT — explicitly
 * NOT a PAT and NOT an M2M client_credentials token. Used to gate the
 * PAT lifecycle endpoints, since allowing a PAT to mint another PAT
 * would let a leaked credential silently regenerate itself.
 */
type UserAuthOutcome =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "non-user" }
  | { kind: "ok"; identity: { userId: string; orgId: string; email: string } };

async function requireUserAuth(authHeader: string): Promise<UserAuthOutcome> {
  if (!authHeader.startsWith("Bearer ")) return { kind: "missing" };
  const token = authHeader.slice(7);
  if (isPatToken(token) || isM2mToken(token)) return { kind: "non-user" };
  try {
    const identity = await verifyToken(token);
    return { kind: "ok", identity };
  } catch {
    return { kind: "invalid" };
  }
}

export { app };
