# Acceptance suite — ui-cookie-session

Drives the credential **transport** migration (localStorage Bearer → httpOnly
cookie session) at the **most honest seam**: real HTTP against the local compose
stack (reverse-proxy → auth-proxy → backend), asserting the cookie contract on the
auth-proxy — `Set-Cookie` attributes on sign-in, cookie-read fallback on
authenticated requests, the `/api/auth/me` identity read-back, and the logout
cookie teardown.

Scope: a **storage + transport** change only. The JWT format is unchanged; who can
sign in and what claims a token carries do not change. `frontend/` stays on its
existing localStorage path (untouched — D9).

## How it runs

```bash
cd tests/acceptance/ui-cookie-session
uv run --no-project pytest            # the suite (RED until DELIVER builds C1–C2)
```

This suite is **NOT** run by the refinery `--auto` gate (per CLAUDE.md, acceptance
suites run separately, locally, before submission). DISTILL ships it **RED-by-
design**: it fails when the stack is up and the feature is unbuilt, and **skips**
cleanly when the stack is down (so it never blocks a no-stack run).

## What is RED-by-design vs a guard

Verified against `auth-proxy/app.ts` (see `distill/wave-decisions.md` DWD-5):

| Test | Posture today | Goes green at |
|---|---|---|
| `test_walking_skeleton_cookie_session` | RED (no Set-Cookie; cookie-only 401; no `/api/auth/me`) | C1 + C2 |
| `test_callback_sets_cookies_keeps_body_token` | RED (callback sets no cookie) | C1 |
| `test_authenticated_request_via_cookie` | RED (cookie-only `/api/*` → 401, no dev bypass) | C1 |
| `test_invalid_cookie_refused` | guard (401 now and after) | — |
| `test_header_wins_over_cookie` | guard (valid header → 200 now and after) | — |
| `test_invalid_header_not_rescued_by_cookie` | guard (invalid header + valid cookie → 401; catches a fallback-chain mis-impl of C1) | — |
| `test_auth_me_identity` (cookie read-back) | RED (`/api/auth/me` absent → 401) | C2 |
| `test_auth_me_identity` (no credential → 401) | guard | — |
| `test_logout_clears_cookies` | RED (logout sets no Set-Cookie) | C2 |
| `test_bearer_header_regression` | guard (header path → 200 now and after) | — |

The `ui/` slices (C3 transport, C4 gate) are **not** exercised by this Python
suite — it drives its own HTTP client, not the React app. They are validated by
`ui/` vitest specs authored in DELIVER (paths in `distill/roadmap.json`) plus a
manual/Playwright pass. See `distill/wave-decisions.md` DWD-4.

## Preconditions for a meaningful (non-skipped) run

1. **Compose stack up** — `docker compose up -d` from the repo root. Scenarios
   marked `needs_compose_stack` skip when the reverse-proxy / auth-proxy are
   unreachable.
2. **`AUTH_MODE=dev`** — the dev sign-in path mints `DEV_USER`'s JWT via the public
   `POST /api/auth/callback`, and the catch-all `/api/*` proxy requires a verified
   credential (the property the cookie-read tests rely on).

## Environment overrides

| Var                | Default                  | Meaning                                   |
|--------------------|--------------------------|-------------------------------------------|
| `REVERSE_PROXY_URL`| `http://localhost:5173`  | user-facing ingress (walking skeleton)    |
| `AUTH_PROXY_URL`   | `http://localhost:1042`  | auth-proxy (discrete scenarios + mint)    |

## Layout

```
ui-cookie-session/
├── pyproject.toml
├── README.md
├── conftest.py                                  # base urls, driver, stack-skip, signed_in
├── driver.py                                    # CookieSessionDriver: sign in, send by header/cookie/both/neither, parse Set-Cookie
├── features/
│   └── ui-cookie-session.feature                # Gherkin scenario SSOT (business language)
├── test_walking_skeleton_cookie_session.py      # @walking_skeleton — full ingress journey (C1+C2)
├── test_callback_sets_cookies_keeps_body_token.py  # C1 — Set-Cookie attrs + keep body token (D1,D2,D6)
├── test_authenticated_request_via_cookie.py     # C1 — cookie-only request allowed (D3 fallback)
├── test_header_wins_over_cookie.py              # C1 — header>cookie priority (D3, regression guard)
├── test_invalid_header_not_rescued_by_cookie.py # C1 — present header is terminal, no fallback chain (D3, error guard)
├── test_invalid_cookie_refused.py               # C1 — cookie-read verifies, no bypass (D3, error)
├── test_auth_me_identity.py                     # C2 — /api/auth/me read-back + no-cred 401 (D4)
├── test_logout_clears_cookies.py                # C2 — logout clears both cookies (D5)
└── test_bearer_header_regression.py             # D9 — header-based client unchanged (regression guard)
```
