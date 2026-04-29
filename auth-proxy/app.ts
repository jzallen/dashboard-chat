import { Hono } from "hono";

import { IDENTITY_HEADERS, isPublicPath, verifyToken } from "./lib/auth.ts";
import {
  authenticateClient,
  isM2mEnabled,
  issueM2mToken,
} from "./lib/m2m.ts";

const BACKEND_URL = process.env.BACKEND_URL || "http://api:8000";

const app = new Hono();

// Health endpoint — handled locally, not proxied
app.get("/health", (c) => c.json({ status: "ok" }));

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

export { app };
