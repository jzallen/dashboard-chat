# ui-cookie-session — walking skeleton notes

> The `.feature` file is the scenario SSOT. This is a notes-only companion.

**Scenario:** `test_walking_skeleton_cookie_session.py::test_sign_in_cookie_session_identity_and_sign_out`
**Tag:** `@walking_skeleton @real_io @happy_path @c1_authproxy_cookies @c2_authproxy_me_logout`
**Strategy:** C (real local) — real compose stack, driven through the user-facing
ingress (`reverse-proxy`).

## The e2e path it exercises

```
sign in (POST /api/auth/callback via ingress)
  → auth_token (HttpOnly) + session=1 (JS) Set-Cookie survive the nginx hop
  → authenticated GET carried ONLY by the auth_token cookie  → 200   (cookie-read, C1)
  → GET /api/auth/me carried by the cookie → {userId, orgId, email}  (identity, C2)
  → sign out (POST /api/auth/logout, cookie) → both cookies cleared (Max-Age=0)  (teardown, C2)
  → credential-less request → 401  (signed-out state)
```

## Two honest GREEN lines (do not conflate — see wave-decisions DWD-4)

- **API-level (this test):** GREEN when **C1 + C2** land. The auth-proxy cookie
  contract is complete; the Python driver proves it end to end through the ingress.
- **Browser-e2e (a human / Playwright):** GREEN when **C1 + C2 + C3 + C4** land —
  the `ui/` SPA itself sends the cookie (`credentials:'include'`, C3) and flips the
  gate on the `session=1` flag (C4). This Python suite is **not** the React app, so
  it cannot prove the `ui/` slices; those are covered by `ui/` vitest + a manual
  pass.

## Why it is genuinely RED today (not theatre)

Verified against `auth-proxy/app.ts`:
- callback sets **no `Set-Cookie`** (126-151) → fails at the first cookie assertion;
- the catch-all `/api/*` requires `Authorization: Bearer` **unconditionally**
  (692-732, no dev bypass) → a cookie-only request is 401 until C1;
- `/api/auth/me` **does not exist** → 401 until C2;
- logout sets **no `Set-Cookie`** (196-209) → no teardown until C2.

## What the InMemory/double would NOT model (N/A here)

Strategy C uses no doubles — the real auth-proxy, real nginx, real backend. The one
thing the **API-level** skeleton cannot model is the browser's own cookie handling
(automatic send of `credentials:'include'`, `document.cookie` read of the flag) —
that is exactly the C3/C4 ui/ surface, covered by vitest + manual, by design.
