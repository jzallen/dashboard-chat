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

const BACKEND_URL = process.env.BACKEND_URL || "http://api:8000";
const UI_STATE_URL = process.env.UI_STATE_URL || "http://ui-state:8788";

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
    context?: { underlying_cause_tag?: unknown; silent_reauth_ok?: unknown };
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
  const silentReauthOk = body?.context?.silent_reauth_ok === true;

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
    // Step 03-01: silent re-auth failure surfaces as error_recoverable with
    // tag "silent-reauth-failed". Emit the dedicated KPI so dashboards can
    // separate this from the org-create reissue failures.
    if (tag === "silent-reauth-failed") {
      emitKpiEvent({
        event: "silent_reauth_failed",
        request_id: requestId,
        underlying_cause_tag: tag,
      });
    }
  }
  if (state === "ready") {
    emitKpiEvent({
      event: "ready_reached",
      request_id: requestId,
    });
    // Step 03-01: when the projection signals silent_reauth_ok in context,
    // emit the KPI alongside ready_reached. The flag is set by the
    // orchestrator only on the specific ready transition that follows an
    // expired_token → silent reauth success path (not on initial ready).
    if (silentReauthOk) {
      emitKpiEvent({
        event: "silent_reauth_ok",
        request_id: requestId,
      });
    }
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

    return proxyRequest(c, incomingHeaders);
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
});

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
    headers: response.headers,
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
    headers: response.headers,
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
