import { Hono } from "hono";

import { IDENTITY_HEADERS, isPublicPath, verifyToken } from "./lib/auth.ts";

const BACKEND_URL = process.env.BACKEND_URL || "http://api:8000";

const app = new Hono();

// Health endpoint — handled locally, not proxied
app.get("/health", (c) => c.json({ status: "ok" }));

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
