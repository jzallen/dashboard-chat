/**
 * Cookie serialisation + parsing for the ui-cookie-session migration
 * (localStorage Bearer → httpOnly cookie session; slices C1/C2).
 *
 * `app.ts` emits two cookies on sign-in (`auth_token` — the HttpOnly credential
 * — and `session=1` — the JS-readable sign-in flag), clears both on logout, and
 * falls back to the `auth_token` cookie when no `Authorization` header is present
 * (D3). Hono's own cookie helpers URL-encode values and bundle attribute
 * defaults; a small explicit serialiser keeps full control over the exact
 * attribute set the acceptance suite asserts and keeps the JWT value verbatim.
 *
 * Two distinct `Set-Cookie` headers must never be collapsed into one comma-
 * joined header (UC-6) — `app.ts` appends each `buildSetCookie` result as its
 * own header.
 */

/** The HttpOnly credential cookie carrying the auth-proxy-minted user JWT. */
export const COOKIE_AUTH_TOKEN = "auth_token";

/** The JS-readable, non-secret "am I signed in?" flag cookie. */
export const COOKIE_SESSION_FLAG = "session";

export interface SetCookieAttributes {
  httpOnly?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  path?: string;
  /** Seconds until expiry; `0` clears the cookie. */
  maxAge?: number;
  secure?: boolean;
}

/**
 * Serialise a single `Set-Cookie` header value. Host-only by design — a
 * `Domain` attribute is never emitted, so the cookie binds to the exact origin
 * that set it. Attribute order mirrors common server output (Max-Age, Path,
 * SameSite, then the boolean flags).
 */
export function buildSetCookie(
  name: string,
  value: string,
  attrs: SetCookieAttributes = {},
): string {
  const segments = [`${name}=${value}`];
  if (attrs.maxAge !== undefined) segments.push(`Max-Age=${attrs.maxAge}`);
  if (attrs.path) segments.push(`Path=${attrs.path}`);
  if (attrs.sameSite) segments.push(`SameSite=${attrs.sameSite}`);
  if (attrs.httpOnly) segments.push("HttpOnly");
  if (attrs.secure) segments.push("Secure");
  return segments.join("; ");
}

/**
 * Decode an inbound `Cookie:` header into a name→value map. Returns an empty
 * map for an absent/empty header. Malformed segments (no `=`, or an empty name)
 * are skipped rather than throwing.
 */
export function parseCookieHeader(
  header: string | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    out[key] = part.slice(idx + 1).trim();
  }
  return out;
}
