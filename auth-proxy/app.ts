import { randomBytes, randomUUID } from "node:crypto";

import { Hono } from "hono";

import { IDENTITY_HEADERS, isPublicPath, verifyToken } from "./lib/auth.ts";
import {
  buildSetCookie,
  COOKIE_AUTH_TOKEN,
  COOKIE_SESSION_FLAG,
  parseCookieHeader,
} from "./lib/cookies.ts";
import {
  authenticateClient,
  isM2mEnabled,
  isM2mToken,
  issueM2mToken,
} from "./lib/m2m.ts";
import { openApiDocument } from "./lib/openapi.ts";
import { runOrgCreateInterception } from "./lib/org-create-workflow.ts";
import {
  isPatToken,
  issuePat,
  listPatsForUser,
  patListItem,
  revokePat,
} from "./lib/pat.ts";
import {
  computeOrgCreateReissue,
  type ReissueBaseClaims,
} from "./lib/post-response-reissue.ts";
import {
  deleteSession,
  getSession,
  getSessionStatus,
  setSession,
} from "./lib/session-store.ts";
import { createDevProvider } from "./lib/user-auth/dev.ts";
import {
  type SessionStorePort,
  type UserAuthProvider,
  type WorkOsConfig,
  WorkOsUserAuthProvider,
} from "./lib/user-auth/workos.ts";
import { isUserToken, verifyUserToken } from "./lib/user-token.ts";

const BACKEND_URL = process.env.BACKEND_URL || "http://api:8000";
const UI_STATE_URL = process.env.UI_STATE_URL || "http://ui-state:8788";
// Chat worker (agent) upstream for the `/worker/*` + presentation-state proxy
// rules. The agent trusts the X-User-Id/X-Org-Id/X-User-Email this proxy
// injects (TRUST_PROXY_HEADERS) instead of verifying the bearer itself.
const WORKER_URL = process.env.WORKER_URL || "http://agent:8787";

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

/**
 * Per-request credential read for the ui-cookie-session migration (D3): priority
 * is HEADER > COOKIE. A present `Authorization: Bearer` is the credential —
 * valid OR not — so its later verification failure is terminal and is NEVER
 * rescued by the cookie. The `auth_token` cookie is consulted ONLY when no
 * Bearer header is present (the header-less browser / EventSource case). Returns
 * the raw token to verify, or null when neither is present. Callers still verify
 * the token: cookie presence is not trust.
 */
function readCredential(c: {
  req: { header: (name: string) => string | undefined };
}): string | null {
  const authHeader = c.req.header("Authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  const cookies = parseCookieHeader(c.req.header("Cookie"));
  return cookies[COOKIE_AUTH_TOKEN] || null;
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
  // `state` is returned alongside `url` so the SPA can stash it in
  // sessionStorage and compare it against the value WorkOS echoes to
  // /auth/callback (client-side CSRF check). Without it the SPA stores no
  // oauth_state, the callback's state check fails, and login loops.
  return c.json({
    url: `https://api.workos.com/user_management/authorize?${params.toString()}`,
    state,
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
    // ui-cookie-session (C1/D1): set the credential as an HttpOnly cookie and a
    // separate JS-readable sign-in flag, as two distinct Set-Cookie headers
    // (never collapsed — UC-6). Secure is omitted in dev (HTTP) so the cookie
    // round-trips; host-only (no Domain). D2: keep access_token in the body so
    // frontend/ (still localStorage-Bearer) does not break.
    const secure = (process.env.AUTH_MODE || "dev") !== "dev";
    c.header(
      "Set-Cookie",
      buildSetCookie(COOKIE_AUTH_TOKEN, accessToken, {
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
        maxAge: expiresIn,
        secure,
      }),
      { append: true },
    );
    c.header(
      "Set-Cookie",
      buildSetCookie(COOKIE_SESSION_FLAG, "1", {
        sameSite: "Lax",
        path: "/",
        secure,
      }),
      { append: true },
    );
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
  // ui-cookie-session (C1/D3, UC-5): a cookie-only browser holds no readable
  // token, so read the credential header-first, then fall back to the cookie.
  const inbound = readCredential(c);
  if (!inbound) {
    return c.json({ error: "invalid_session" }, 401);
  }

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
    // Re-set the credential cookies so a cookie-only browser's session slides
    // forward on the keep-alive beat (the body token serves header/PAT clients).
    // Mirrors the callback's dual Set-Cookie (ui-cookie-session C1/D1).
    const secure = (process.env.AUTH_MODE || "dev") !== "dev";
    c.header(
      "Set-Cookie",
      buildSetCookie(COOKIE_AUTH_TOKEN, accessToken, {
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
        maxAge: expiresIn,
        secure,
      }),
      { append: true },
    );
    c.header(
      "Set-Cookie",
      buildSetCookie(COOKIE_SESSION_FLAG, "1", {
        sameSite: "Lax",
        path: "/",
        secure,
      }),
      { append: true },
    );
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
  // ui-cookie-session (C2/D5): read the session header-first, then the cookie —
  // the Bearer path stays intact for PAT/headless clients. Delete the server
  // session, then clear BOTH cookies on the way out so the browser drops them.
  // workos mode: the WorkOS SSO session outlives the local one, so clearing the
  // cookie alone lets the next /api/auth/login silently re-authenticate. Capture
  // the WorkOS session id (stored at callback) BEFORE dropping the local session
  // and hand the SPA a WorkOS end-session url to navigate to — that actually
  // terminates the SSO session. dev mode has no SSO session → no url (204).
  let logoutUrl: string | null = null;
  const token = readCredential(c);
  if (token) {
    try {
      const payload = await verifyUserToken(token);
      const sid = typeof payload.sid === "string" ? payload.sid : "";
      if (sid) {
        if ((process.env.AUTH_MODE || "dev") !== "dev") {
          const wsid = getSession(sid)?.workos_session_id;
          if (wsid) logoutUrl = buildWorkosLogoutUrl(wsid);
        }
        await createProviderForRequest().logout(sid);
      }
    } catch {
      // Verification failure: treat as already-logged-out, no-op delete.
    }
  }
  c.header(
    "Set-Cookie",
    buildSetCookie(COOKIE_AUTH_TOKEN, "", { maxAge: 0, path: "/" }),
    { append: true },
  );
  c.header(
    "Set-Cookie",
    buildSetCookie(COOKIE_SESSION_FLAG, "", { maxAge: 0, path: "/" }),
    { append: true },
  );
  return logoutUrl ? c.json({ logout_url: logoutUrl }) : c.body(null, 204);
});

/**
 * Build the WorkOS end-session URL for a WorkOS session id (the `sid` captured at
 * callback). Navigating the browser here terminates the SSO session. `return_to`
 * is included only when `WORKOS_LOGOUT_REDIRECT` is set (it must be whitelisted in
 * the WorkOS dashboard); otherwise WorkOS uses its configured default.
 */
function buildWorkosLogoutUrl(workosSessionId: string): string {
  const base = process.env.WORKOS_BASE || "https://api.workos.com";
  const url = new URL(`${base}/user_management/sessions/logout`);
  url.searchParams.set("session_id", workosSessionId);
  const returnTo = process.env.WORKOS_LOGOUT_REDIRECT;
  if (returnTo) url.searchParams.set("return_to", returnTo);
  return url.toString();
}

// Identity read-back (ui-cookie-session C2/D4). A pure CSR SPA holding an
// HttpOnly cookie can no longer decode the JWT itself, so it asks the server who
// it is. Reads the credential cookie-or-header (D3 priority), verifies it, and
// returns the claim identity; 401 when neither is present or the token is
// invalid. Registered BEFORE the catch-all app.all('*') so it is served here and
// not proxied to the backend (which has no such route), and it is NOT a public
// path — it must 401 without a credential.
app.get("/api/auth/me", async (c) => {
  const token = readCredential(c);
  if (!token) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }
  try {
    const identity = await verifyToken(token);
    return c.json({
      userId: identity.userId,
      orgId: identity.orgId,
      email: identity.email,
    });
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
});

// Mode discovery (ADR-050 §d). auth-proxy is the SOLE AUTH_MODE reader; the
// login surface calls this before any sign-in affordance, so it is pre-auth
// (no credential, never 401). Side-effect-free — unlike GET /api/auth/login it
// mints NO CSRF login state, which is exactly why §d keeps the two separate.
// Cacheable for 5 min. Registered BEFORE the catch-all app.all('*') (same
// mechanism as GET /api/auth/me) so it is served locally and never proxied.
app.get("/api/auth/config", (c) => {
  const mode = (process.env.AUTH_MODE || "dev") === "dev" ? "dev" : "workos";
  c.header("Cache-Control", "public, max-age=300");
  return c.json({ mode });
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
 * Concrete WorkOS provisioner for the org-create interception (CDO-S5). Reuses
 * the same injected-fetch boundary as `createProviderForRequest` (no second
 * WorkOS client) but returns the concrete type so the org-provisioning ops
 * (createOrganization / createOrganizationMembership / deleteOrganization) are
 * reachable. Built per-request so it observes the live WORKOS_BASE / API key.
 */
function createWorkosProvisioner(): WorkOsUserAuthProvider {
  const sessionStore: SessionStorePort = {
    set: setSession,
    get: getSession,
    getStatus: getSessionStatus,
    delete: deleteSession,
  };
  const config: WorkOsConfig = {
    baseUrl: process.env.WORKOS_BASE || "https://api.workos.com",
    clientId: process.env.WORKOS_CLIENT_ID || "",
    clientSecret: process.env.WORKOS_API_KEY || "",
    redirectUri: process.env.WORKOS_REDIRECT_URI || "",
    sessionTtlSeconds: 3600,
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

/**
 * Build the upstream header set for a worker/agent proxy hop: copy inbound
 * headers minus any client-supplied identity headers, then inject the verified
 * tenant identity (DEV_USER in dev mode; the verified token's claims in
 * production). Returns the headers, or a 401 Response when the bearer is
 * missing/invalid. Mirrors the `/ui-state/*` and catch-all backend branches so
 * the agent can trust X-User-Id/X-Org-Id/X-User-Email exactly like the backend.
 */
async function buildAgentIdentityHeaders(
  c: { req: { raw: Request; header: (name: string) => string | undefined } },
): Promise<{ headers: Headers } | { error: Response }> {
  const headers = new Headers();
  c.req.raw.headers.forEach((value, key) => {
    if (!IDENTITY_HEADERS.includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  // ui-cookie-session (C1/D3): read the credential header-first, cookie
  // fallback. The agent hop (ssr-ui-server-gateway slice-2) REHYDRATES this validated
  // token as `Authorization: Bearer <token>` on the upstream request so the
  // agent's extractJwt sees a real bearer and its downstream backend-client can
  // re-enter auth-proxy's `/api/*` catch-all. Set explicitly (not relied upon
  // from the copied inbound headers) so the cookie-only browser path — which
  // carries NO Authorization header — still authenticates the agent→backend
  // sub-call. The Bearer is the canonical credential for the hop; setting it
  // here is idempotent when the client already sent the same token as a header.
  const token = readCredential(c);

  if ((process.env.AUTH_MODE || "dev") === "dev") {
    headers.set("X-User-Id", "dev-user-001");
    headers.set("X-Org-Id", "dev-org-001");
    headers.set("X-User-Email", "dev@localhost");
    // Dev is also broken without rehydration: chat itself works on the injected
    // identity, but the transform sub-call needs a token the catch-all's
    // verifyToken accepts (the auth_token cookie value is exactly such a token).
    // No credential → inject identity only; chat still works.
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return { headers };
  }

  if (!token) {
    return {
      error: Response.json(
        { error: "Missing or invalid Authorization header" },
        { status: 401 },
      ),
    };
  }
  try {
    const identity = await verifyToken(token);
    headers.set("X-User-Id", identity.userId);
    // An empty org_id is the org-less signal; never inject an empty X-Org-Id
    // (omitting it reads as "no tenant" upstream, same as an empty value would
    // be normalised to, without putting a blank tenant on the wire).
    if (identity.orgId) headers.set("X-Org-Id", identity.orgId);
    headers.set("X-User-Email", identity.email);
    headers.set("Authorization", `Bearer ${token}`);
    return { headers };
  } catch {
    return { error: Response.json({ error: "Invalid or expired token" }, { status: 401 }) };
  }
}

// Chat worker (agent) tier. Routed BEFORE the catch-all backend proxy. nginx
// sends `/worker/*` here so the agent sits behind auth-proxy: this branch
// verifies the bearer and injects identity headers, then strips the `/worker`
// prefix so the agent sees its own routes (`/chat`, …). SSE bodies stream
// through unbuffered (same as `/ui-state/state/stream`).
app.all("/worker/*", async (c) => {
  const result = await buildAgentIdentityHeaders(c);
  if ("error" in result) return result.error;
  const strippedPath = c.req.path.replace(/^\/worker/, "") || "/";
  return proxyToUpstream(c, WORKER_URL, strippedPath, result.headers);
});

// Presentation-state reads are served from the agent's in-process/Redis store
// (ADR-015), not the backend. Routed through auth-proxy (BEFORE the catch-all
// `/api/*` → backend rule) so the agent receives injected identity. Path is
// preserved verbatim — the agent serves `/api/channels/:id/presentation-state`.
app.all("/api/channels/:id/presentation-state", async (c) => {
  const result = await buildAgentIdentityHeaders(c);
  if ("error" in result) return result.error;
  return proxyToUpstream(c, WORKER_URL, c.req.path, result.headers);
});

// UI-state tier — multi-upstream routing per ADR-030 §SD1.
// Routed BEFORE the catch-all backend proxy. In AUTH_MODE=dev the ui-state
// tier is accessed without a Bearer token (the dev user identity is implied);
// in production this branch verifies the token and forwards identity headers
// just like the backend branch. The `/ui-state` path prefix is stripped
// before forwarding so the upstream sees its own routes (`/health`,
// `/state`, `/state/events`, `/state/stream`).
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
    // ui-cookie-session (C1/D3): header-first, then the auth_token cookie (so a
    // same-origin EventSource, which cannot set Authorization, authenticates).
    const token = readCredential(c);
    if (!token) {
      return c.json(
        { error: "Missing or invalid Authorization header" },
        401,
      );
    }
    try {
      const identity = await verifyToken(token);
      incomingHeaders.set("X-User-Id", identity.userId);
      // Org-less identities carry org_id ""; never inject an empty X-Org-Id.
      if (identity.orgId) incomingHeaders.set("X-Org-Id", identity.orgId);
      incomingHeaders.set("X-User-Email", identity.email);
    } catch {
      return c.json({ error: "Invalid or expired token" }, 401);
    }
  }

  // Per ADR-030 §SD4 the auth-proxy emits KPI K3 events on transitions, both
  // read from the upstream /state projection:
  //   - auth_recoverable_error_shown: state === error_recoverable
  //   - ready_reached: state === ready
  // (The inbound-keyed auth_retry_clicked trigger was retired in CDO-S4 once
  // `retry_clicked` left the closed wire union in CDO-S3.)
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
    await emitKpiEventsForResponse(response.clone());
  } catch {
    // Silent — KPI emission is best-effort and must not break the proxy.
  }

  return response;
});

/**
 * Inspect the upstream response and emit any matching KPI K3 events to
 * stdout as JSON lines. Reads the onboarding lifecycle from the ADR-046
 * `/state` document, whose onboarding region lives at
 * `regions.onboarding.{state, context.underlying_cause_tag}` with `request_id`
 * hoisted to the document top level. (`/state` is the sole read surface since
 * ADR-046 MR-7 retired the per-machine projection envelope.)
 * Events:
 *   - onboarding state === "error_recoverable"  → auth_recoverable_error_shown
 *   - onboarding state === "ready"              → ready_reached
 */
async function emitKpiEventsForResponse(
  response: Response,
): Promise<void> {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return;
  }
  const { requestId, state, tag } = readOnboardingSignal(body);

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

/**
 * Resolve the onboarding lifecycle signal the KPI sniffer keys off, from the
 * ADR-046 `/state` document. `request_id` is hoisted to the document top level;
 * the onboarding `state` + `underlying_cause_tag` live under
 * `regions.onboarding`. (The legacy flat per-machine envelope was retired at
 * ADR-046 MR-7 — `/state` is the sole read surface.)
 */
function readOnboardingSignal(body: unknown): {
  requestId?: string;
  state?: string;
  tag?: string;
} {
  const doc = (body ?? {}) as {
    request_id?: unknown;
    regions?: {
      onboarding?: { state?: unknown; context?: { underlying_cause_tag?: unknown } };
    };
  };

  const requestId =
    typeof doc.request_id === "string" ? doc.request_id : undefined;

  const onboarding = doc.regions?.onboarding;
  return {
    requestId,
    state:
      onboarding && typeof onboarding.state === "string"
        ? onboarding.state
        : undefined,
    tag:
      onboarding && typeof onboarding.context?.underlying_cause_tag === "string"
        ? onboarding.context.underlying_cause_tag
        : undefined,
  };
}

function emitKpiEvent(payload: {
  event: string;
  request_id?: string;
  underlying_cause_tag?: string;
  orphan_org_id?: string;
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

  // Extract the credential: header-first, then the auth_token cookie
  // (ui-cookie-session C1/D3). A present Bearer header is terminal — its
  // verification failure below is NOT rescued by the cookie. The cookie is the
  // header-less browser path; it is still verified, so presence is not trust.
  const token = readCredential(c);
  if (!token) {
    return c.json(
      { error: "Missing or invalid Authorization header" },
      401
    );
  }

  try {
    const identity = await verifyToken(token);

    // Set identity headers for the backend. An org-less identity (org_id "")
    // injects NO X-Org-Id — the org-create interception below sets the freshly-
    // provisioned org id on the forward, and other routes read an absent header
    // as "no tenant" rather than a blank tenant string.
    incomingHeaders.set("X-User-Id", identity.userId);
    if (identity.orgId) incomingHeaders.set("X-Org-Id", identity.orgId);
    incomingHeaders.set("X-User-Email", identity.email);

    // CDO-S5: WorkOS org-create interception. Cheap path+method+mode guard so
    // every other proxied request stays zero-overhead. In workos mode a
    // POST /api/orgs is pre-checked + provisioned + forwarded with X-Org-Id
    // overridden to the freshly-provisioned WorkOS org id (the backend persists
    // it as the new org's row id); the post-response reissue still fires on the
    // relayed 201. Dev mode (and every other route/method) falls through.
    if (
      c.req.method === "POST" &&
      new URL(c.req.url).pathname === "/api/orgs" &&
      (process.env.AUTH_MODE || "dev") === "workos"
    ) {
      const intercepted = await interceptWorkosOrgCreate(
        c,
        incomingHeaders,
        identity,
      );
      return applyOrgCreateReissue(c, intercepted, token);
    }

    const upstream = await proxyRequest(c, incomingHeaders);
    return applyOrgCreateReissue(c, upstream, token);
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
});

/**
 * Wire the CDO-S5 org-create interception collaborators from the live request
 * and hand off to the pure `runOrgCreateInterception` policy. The interception
 * is invoked only in workos mode for `POST /api/orgs` (guarded at the call
 * site). Reuses the same backend-fetch wiring (`proxyRequest`) for the forward
 * and the same injected-fetch WorkOS boundary as the auth provider.
 *
 * `incomingHeaders` arrives already stripped of IDENTITY_HEADERS and injected
 * with the verified identity — the forward closure then overrides `X-Org-Id`
 * with the freshly-provisioned WorkOS org id (strip-then-inject), which the
 * backend persists as the new org's row id.
 */
async function interceptWorkosOrgCreate(
  c: { req: { raw: Request; url: string; method: string } },
  incomingHeaders: Headers,
  identity: { userId: string; orgId: string; email: string },
): Promise<Response> {
  // Buffer the inbound body ONCE: we both parse `name` from it and re-send it
  // verbatim on the forward leg. (A clone-then-stream would lock the original
  // body the forward would otherwise pass to the backend; reading it once and
  // re-emitting the bytes sidesteps that in undici.)
  const rawBody = await c.req.raw.clone().text();
  let name = "";
  try {
    const parsed = JSON.parse(rawBody) as { name?: unknown };
    name = typeof parsed.name === "string" ? parsed.name : "";
  } catch {
    name = "";
  }

  const correlationId =
    c.req.raw.headers.get("x-request-id") || randomUUID();
  const provisioner = createWorkosProvisioner();
  const url = new URL(c.req.url);

  return runOrgCreateInterception({
    name,
    // The verified token's `sub` IS the WorkOS user id.
    userId: identity.userId,
    identityHeaders: incomingHeaders,
    correlationId,
    deps: {
      checkAvailability: async () => {
        const target = `${BACKEND_URL}/api/orgs/availability?name=${encodeURIComponent(name)}`;
        const headers = new Headers(incomingHeaders);
        headers.delete("host");
        headers.set("X-Request-Id", correlationId);
        return fetch(target, { method: "GET", headers });
      },
      provisionOrg: (orgName) => provisioner.createOrganization(orgName),
      provisionMembership: (userId, orgId) =>
        provisioner.createOrganizationMembership(userId, orgId),
      deprovisionOrg: (orgId) => provisioner.deleteOrganization(orgId),
      forwardToBackend: async (provisionedOrgId) => {
        // Override X-Org-Id (empty for a first-org creator) with the freshly-
        // provisioned WorkOS org id: the backend persists it as the new org's
        // row id (the WorkOS org id IS the local org id). X-Org-Id is an
        // IDENTITY_HEADER, so any client-supplied value was already stripped.
        const headers = new Headers(incomingHeaders);
        headers.set("X-Org-Id", provisionedOrgId);
        headers.delete("host");
        const target = `${BACKEND_URL}${url.pathname}${url.search}`;
        const response = await fetch(target, {
          method: c.req.method,
          headers,
          body: rawBody,
        });
        return new Response(response.body, {
          status: response.status,
          headers: stripReissueHeaders(response.headers),
        });
      },
      emit: (event) => emitKpiEvent(event),
    },
  });
}

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
  // ui-cookie-session D8 un-park (ADR-050 §a, UC-6): the reissue rides
  // Set-Cookie too — dual emission. Write the SAME fresh token as the HttpOnly
  // auth_token cookie plus a JS-readable session=1 flag, mirroring the callback
  // handler (app.ts:173-198). Two DISTINCT never-collapsed headers via
  // Headers.append (preserves duplicate set-cookie entries). MODE-AGNOSTIC:
  // emission is gated only by the path/method/status + isUserToken guards above;
  // ONLY the Secure attribute is dev-gated.
  const secure = (process.env.AUTH_MODE || "dev") !== "dev";
  headers.append(
    "Set-Cookie",
    buildSetCookie(COOKIE_AUTH_TOKEN, reissue.token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: reissue.expiresIn,
      secure,
    }),
  );
  headers.append(
    "Set-Cookie",
    buildSetCookie(COOKIE_SESSION_FLAG, "1", {
      sameSite: "Lax",
      path: "/",
      secure,
    }),
  );
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
