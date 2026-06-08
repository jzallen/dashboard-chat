# ui-cookie-session — upstream issues (found while reading at DISTILL)

Blockers and consumers discovered while reading the auth path. None block DISTILL
(docs + a non-gated acceptance venv), but each is a DELIVER consideration.

## UC-1 — Cross-origin SPA would need `Access-Control-Allow-Credentials` (not needed for dev/prod target)

**Where:** auth-proxy/app.ts — there is **no** `cors()` middleware and **no**
`Access-Control-Allow-Credentials` header anywhere.

**Finding:** A cookie only rides cross-origin requests when the server sends
`Access-Control-Allow-Credentials: true` **and** an explicit (non-`*`) allow-origin,
and the client sets `credentials:'include'`. Our target is **same-origin** (`ui/`
and the auth-proxy both behind the reverse-proxy at `localhost:5173`), so no CORS
change is required and D6's `SameSite=Lax` is sufficient.

**Action:** None for this feature. **Flag for any future cross-origin SPA host**: it
would need an explicit allow-credentials + allow-origin allowlist on the auth-proxy.
Captured so a later origin split does not silently break the cookie.

## UC-2 — `frontend/` is the only consumer of the callback body `access_token` (D2 confirmed correct)

**Where:** `frontend/` (localStorage-Bearer, untouched this sprint) and
`ui/app/auth/bootstrap.ts` (today reads `access_token` from the callback body).

**Finding:** `ui/` stops reading the body token in C4; `frontend/` still reads it.
Keeping `access_token` in the callback body (**D2**) is therefore load-bearing — its
removal would break `frontend/`'s sign-in. No other consumer of the body token was
found.

**Action:** Honour D2 (the C1 acceptance test locks it). When `frontend/` is later
migrated (separate feature), the body token can be removed and this becomes moot.

## UC-3 — SSE / `EventSource` cookie auth on `/ui-state/*` and `/worker/*` (the latent driver, dev-bypassed today)

**Where:** auth-proxy/app.ts `/ui-state/*` (480-534) and `/worker/*`
`buildAgentIdentityHeaders` (414-449). Both **inject DEV_USER without a credential in
dev mode**, so in the dev target an `EventSource` works regardless of transport.

**Finding:** One real motivation for the cookie migration is that `EventSource`
cannot set an `Authorization` header — but in **prod** those two paths verify a
Bearer. After C1 they fall back to the `auth_token` cookie, which an `EventSource`
*does* send automatically (same-origin), closing the prod gap. In **dev** the
dev-bypass means this is not observable, so the acceptance suite does not assert an
SSE path.

**Action:** C1 must add the cookie fallback to **both** the `/ui-state/*` and
`/worker/*` prod branches (in the roadmap). No dev-observable test exists; note it as
a prod-only contract the cookie fallback satisfies. A future prod-mode acceptance run
(WorkOS) should add an SSE-over-cookie scenario.

## UC-4 — WorkOS reissue (`X-New-Access-Token`) stays header-only; `ui/` has no consumer of it post-migration

**Where:** auth-proxy/app.ts `applyOrgCreateReissue` (744-791) +
`auth-proxy/lib/post-response-reissue.ts`. Today the FE reads `X-New-Access-Token`
from the response headers and stores it to localStorage.

**Finding:** Once `ui/` no longer stores a token (C3/C4), it has **no place to put** a
reissued header token — the reissue would need to arrive as a `Set-Cookie`. That
conversion is **parked (D8)** because it is non-trivial and **moot for the dev
target** (org-onboarding's org-create runs server-side via ui-state with dev
DB-resolution; no reissue fires). `frontend/` still consumes the header (D9), so the
header path must stay.

**Action:** Keep `applyOrgCreateReissue` as-is (header path, for `frontend/`). PARK
the Set-Cookie conversion as an explicit follow-up for when WorkOS + org-create
reissue is exercised through `ui/`. Do **not** do it in this feature.

## UC-5 — `/api/auth/refresh` for a cookie-only client is currently unreachable

**Where:** auth-proxy/app.ts POST /api/auth/refresh (157-190) reads the Bearer header
only.

**Finding:** After the migration a `ui/` browser holds no readable token, so it
cannot populate an `Authorization` header to call refresh. C1 adds the cookie
fallback to refresh so a cookie-only client can refresh. There is no automatic silent
re-auth loop in `ui/` today, so no `ui/` consumer breaks immediately — but a
cookie-only refresh path is required for any future silent-refresh work.

**Action:** Include `/api/auth/refresh` in C1's `readCredential` fallback (already in
the roadmap). A reissued token from refresh should be returned as a fresh
`Set-Cookie auth_token` (same shape as callback) — fold into C1/C2 if a `ui/`
refresh consumer is added; otherwise it rides the parked-reissue follow-up (UC-4).

## UC-6 — Two distinct `Set-Cookie` headers must not be collapsed (test-infra note)

**Where:** Hono response construction in C1/C2.

**Finding:** The feature sets two cookies per response (auth_token + session, and two
clears on logout). They must be emitted as **two separate `Set-Cookie` headers**, not
one comma-joined header. The acceptance driver reads them via
`headers.get_list('set-cookie')`; a Hono helper that overwrites rather than appends
would drop one cookie.

**Action:** In C1/C2 use `setCookie` from `hono/cookie` (appends) or
`c.header('Set-Cookie', value, { append: true })` — never a single combined string.
Covered by the auth-proxy vitest in C1/C2.
