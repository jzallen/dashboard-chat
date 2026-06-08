# ui-cookie-session — Design Bridge (delta & decisions)

**Status:** DESIGN-skip bridge — written at DISTILL (2026-06-08). No formal DESIGN
wave ran for this feature; its inputs are (a) the scoping ground-truth read of the
current Bearer/localStorage auth path and (b) the resolved decisions D1–D9 below.
This document is the SSOT the acceptance suite and `distill/roadmap.json` design
against. It indexes — it does not supersede — ADR-016 (auth-proxy is the token
SSOT and sole backend ingress).

## 1. Problem & goal

`ui/` (React 18 + RRv7, **pure CSR SPA** via `HydratedRouter`) authenticates by
storing the WorkOS-issued JWT in `localStorage` and attaching it as
`Authorization: Bearer` on every request. This migration moves the **storage and
transport** of that credential to an **httpOnly cookie session**. The JWT *format*
is unchanged — same token, same claims, same `verifyToken()` path.

Why now (drivers):

1. **Close the XSS token-theft vector** — an httpOnly cookie is unreadable by JS,
   so a script injection can no longer exfiltrate the bearer token.
2. **Let SSE / `EventSource` carry the credential** — `EventSource` cannot set an
   `Authorization` header, but a same-origin cookie rides automatically.
3. **Prepare for WorkOS token reissue via `Set-Cookie`** — a server-set cookie is
   the natural channel for silent token rotation (parked here — see §6 / D8).

This lands **before** the org-onboarding DELIVER, which rides on it.

## 2. Ground truth (verified, not assumed)

There is **no existing cookie infrastructure to port from**. auth-proxy is
Bearer/header-only today:

| Site (auth-proxy/app.ts) | Today | Reads credential from |
|---|---|---|
| `POST /api/auth/callback` (~126–151) | returns `{ access_token, expires_in }` JSON **body only**; **no `Set-Cookie`** | n/a (mints) |
| catch-all `/api/*` proxy (692–732) | requires `Authorization: Bearer` → **401** if absent; **no dev bypass** | `Authorization` header only |
| `/ui-state/*` (480–534) | dev mode injects DEV_USER **without** a token; prod reads Bearer | `Authorization` header (prod) |
| `/worker/*` `buildAgentIdentityHeaders` (414–449) | dev injects DEV_USER without a token; prod reads Bearer | `Authorization` header (prod) |
| `POST /api/auth/refresh` (157–190) | reads Bearer, returns body token | `Authorization` header only |
| `POST /api/auth/logout` (196–209) | reads Bearer, deletes server session by `sid`, 204; **no cookie clear** | `Authorization` header only |
| `GET /api/auth/me` | **does not exist** | — |
| CORS | **no `cors()` middleware, no `Access-Control-Allow-Credentials`** anywhere | — |

`ui/` mirrors this: `tokenStorage.ts` is pure `localStorage`; `backendClient.ts`'s
four fetch helpers inject `Authorization: Bearer` and set **no** `credentials`;
the auth gate is `getToken()`-truthiness at `login.tsx:16`, `app-shell.tsx:31`,
`app-shell.tsx:95`. `frontend/` is **also** localStorage-Bearer (its state-proxy
`credentials:"include"` targets the ui-state tier, not an auth cookie).

Consequence for a **pure CSR SPA**: with an httpOnly cookie, **JS cannot read the
token**, so the `getToken()`-truthiness gate must be replaced by a non-secret,
JS-readable signal, and identity claims must come from the server (the SPA can no
longer decode the JWT itself).

## 3. Resolved decisions (fixed inputs)

**D1 — Two cookies on a successful `POST /api/auth/callback`:**
- `auth_token=<jwt>` — `HttpOnly`; `SameSite=Lax`; `Path=/`; `Max-Age=<expires_in>`;
  `Secure` **only when `AUTH_MODE!=dev`** (omit `Secure` on dev HTTP). Host-only
  (no `Domain`). This is the credential.
- `session=1` — readable-by-JS companion **flag** (**not** `HttpOnly`);
  `SameSite=Lax`; `Path=/`. The CSR "am I logged in?" signal that replaces
  `getToken()` truthiness. **Not a secret; carries no credential.**

**D2 — KEEP `access_token` in the callback JSON body.** Do **not** remove it.
`frontend/` still reads it into `localStorage` and must not break (`frontend/`
stays on localStorage this sprint). `ui/` simply **stops reading** the body token
and relies on the cookies.

**D3 — Per-request credential read priority HEADER > COOKIE.** If
`Authorization: Bearer` is present, use it (M2M/PAT/`frontend/` keep working);
else fall back to the `auth_token` cookie (ui/ browser requests). Apply at **all
four** sites: catch-all `/api/*`, `/ui-state/*`, `/worker/*`
(`buildAgentIdentityHeaders`), and `/api/auth/refresh`. The dev-mode
unconditional identity injection on `/ui-state/*` and `/worker/*` is **unchanged**
(dev still needs no credential there); the catch-all `/api/*` has no dev bypass
and is where cookie-read is observably tested.

**D4 — NEW `GET /api/auth/me`.** Reads cookie-or-header (same D3 priority),
verifies, returns `{ userId, orgId, email }`; **401** when neither is present.
Gives the SPA the identity claims it can no longer decode itself.

**D5 — Logout (`POST /api/auth/logout`).** Read the session from the cookie **or**
the Bearer header (keep the header path for PAT/headless), delete the server
session, and clear **both** cookies:
`Set-Cookie: auth_token=; Max-Age=0; Path=/` and
`Set-Cookie: session=; Max-Age=0; Path=/`.

**D6 — CSRF.** `SameSite=Lax` is sufficient: no cross-origin form POSTs; all `ui/`
AJAX is same-origin explicit `fetch`. No CSRF token needed. (Optional
defense-in-depth: an origin/referer check on state-changing routes — noted, not
required.)

**D7 — `ui/` wiring delta:**
- `ui/app/catalog/dataSources/backendClient.ts` — add `credentials:"include"` to
  all four fetch calls (`apiGet`/`apiPatch`/`apiPost`/`apiUpload`); drop the
  `Authorization: Bearer` injection (the `token` param becomes a no-op for browser
  requests; may be kept as an optional test seam).
- `ui/app/components/useCatalog.ts` — the injected `getToken` becomes `() => null`
  (catalog stays auth-decoupled; `metadataApiSource` keeps the `getToken` dep
  interface but it yields `null` → no Bearer header built).
- `ui/app/auth/tokenStorage.ts` — retire `setToken`/`clearAll` (no-ops or removed);
  replace the `getToken`-based gate with `hasSession()` reading the `session=1`
  flag cookie (`document.cookie`). Logout calls `POST /api/auth/logout` (server
  clears cookies).
- `ui/app/auth/bootstrap.ts` (`handleCallback`) — stop reading `access_token` from
  the body; after the callback POST succeeds the cookies are set; just navigate.
- `ui/app/routes/{login.tsx:16, app-shell.tsx:31, app-shell.tsx:95}` — replace
  `getToken()` truthiness with `hasSession()` (the flag-cookie check).
- If a component needs identity (userId/orgId/email), add a small hook backed by
  `GET /api/auth/me` (defer the actual consumer to org-onboarding unless trivially
  needed).

**D8 — PARK the WorkOS `X-New-Access-Token` reissue → `Set-Cookie` conversion**
(`auth-proxy/app.ts:744–791` `applyOrgCreateReissue` + `post-response-reissue.ts`).
Non-trivial and **moot for the dev target** (org-onboarding's org-create runs
server-side via ui-state with dev DB-resolution, no reissue). Explicit follow-up;
**not** done here. The header-based reissue stays as-is and untouched.

**D9 — `frontend/` is UNTOUCHED this sprint.** M2M/PAT paths stay header-based and
unaffected (guaranteed by D3's header-first priority).

## 4. Target shapes (the contracts the tests assert)

```
POST /api/auth/callback        { code }
  200
  Set-Cookie: auth_token=<jwt>; HttpOnly; SameSite=Lax; Path=/; Max-Age=<expires_in>   (+ Secure if !dev)
  Set-Cookie: session=1; SameSite=Lax; Path=/                                          (NOT HttpOnly)
  body: { access_token: <jwt>, expires_in: <n> }   ← D2: kept for frontend/

GET  /api/<anything authenticated>     Cookie: auth_token=<jwt>            → 200  (D3 cookie fallback)
GET  /api/<anything authenticated>     Authorization: Bearer <jwt>          → 200  (D3 header, unchanged)
GET  /api/<anything authenticated>     Authorization: Bearer <jwt> + Cookie: auth_token=<other>  → 200, header wins (D3)

GET  /api/auth/me                       Cookie: auth_token=<jwt>            → 200 { userId, orgId, email }   (D4)
GET  /api/auth/me                       (neither cookie nor header)         → 401                            (D4)

POST /api/auth/logout                   Cookie: auth_token=<jwt>            → 2xx
  Set-Cookie: auth_token=; Max-Age=0; Path=/
  Set-Cookie: session=; Max-Age=0; Path=/                                                                    (D5)
```

## 5. Carpaccio (slice order — auth-proxy FIRST)

The roadmap (`distill/roadmap.json`) slices thinnest-first; auth-proxy is the
prerequisite, so it lands before any `ui/` change:

- **C1 — auth-proxy transport:** `Set-Cookie` both cookies on callback (keep body
  token) + cookie-read fallback across the four per-request paths (header>cookie) +
  cookie attributes (`SameSite=Lax`, dev-gated `Secure`). (D1, D2, D3, D6)
- **C2 — auth-proxy identity & teardown:** `GET /api/auth/me` + logout cookie-clear.
  (D4, D5)
- **C3 — ui/ transport:** `backendClient` `credentials:"include"` + drop Bearer;
  `useCatalog` `getToken → null`; retire `tokenStorage` writes. (D7 transport)
- **C4 — ui/ gate:** `hasSession()` flag-cookie auth gate (`login` + `app-shell`×2) +
  `auth-callback` stops reading the body token. (D7 gate)

**Walking skeleton (strategy C, real compose stack):** dev login → cookies set →
an authenticated API call rides the cookie → `/api/auth/me` returns identity →
logout clears cookies → a credential-less request is refused. The **API-level**
walking skeleton (the acceptance suite's driver) exercises C1+C2 and goes GREEN
when those land. The **end-to-end browser** path (the journey a human/Playwright
sees, where `ui/` itself sends the cookie and flips the gate) goes GREEN when
C3+C4 also land — verified by `ui/` vitest + a manual/Playwright pass, since the
Python suite drives its own HTTP client, not the React code. This split is stated
plainly so neither side is overclaimed.

## 6. Parked / out of scope

- **D8 reissue → Set-Cookie** — parked; header-based `X-New-Access-Token` stays.
- **CORS / `Access-Control-Allow-Credentials`** — **not needed** for the dev/prod
  target because `ui/` and the auth-proxy are **same-origin** behind the
  reverse-proxy (all `ui/` AJAX is same-origin `fetch`). A cross-origin SPA
  deployment would need `Access-Control-Allow-Credentials: true` + an explicit
  allow-origin; flagged in `distill/upstream-issues.md`, not implemented here.
- **Session revocation on the verify path** — logout deletes the server session by
  `sid`, but `verifyToken()` is stateless, so a still-valid JWT presented after
  logout would verify until expiry. Out of scope (D5 only mandates clearing the
  cookies + deleting the server session). The "signed-out" state is the browser
  dropping the cleared cookies. Noted so the logout test asserts the **Set-Cookie
  teardown**, not a post-logout 401 from a replayed cookie.
