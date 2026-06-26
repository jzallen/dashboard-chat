# DISTILL/DELIVER Notes — ssr-ui-server-gateway (Slice 2: workos auth hop)

> Focused auth fix so assistant-initiated catalog transforms authenticate on the
> **agent → backend** hop, unblocking testing in `AUTH_MODE=workos` and fixing the
> same break in `dev`. Scope: **auth-proxy only** — no agent, no backend changes.

## Reconciliation (pre-scenario gate)

Read Slice-1 SSOT: `discuss/*`, `distill/wave-decisions.md`, `distill/roadmap.json`.

- `+ discuss/idea-capture.md` (Phase-0 NOTE: the assistant-transform path is the
  near-term priority that the live-transform skeleton must unblock)
- `+ distill/wave-decisions.md` (DWD-2: forward the inbound user credential)
- `- docs/product/*` (not found — brownfield; no SSOT product dir)

**Reconciliation result: 0 contradictions.** Slice-1 DWD-2 forwards the inbound
user credential from the resource route to auth-proxy. This slice does not violate
DWD-2 — it completes it: DWD-2 forwarded the credential to auth-proxy's `/worker`
hop, but the **cookie-only** browser path carries the credential as a cookie, not a
Bearer, and the agent (downstream of `/worker`) reads only the `Authorization`
header. Slice-2 rehydrates the validated credential as a Bearer on the `/worker`
upstream so the agent's existing `extractJwt → backendClient` path forwards a real
token. Still the user-credential-forward variant; M2M on-behalf-of stays deferred
(consistent with Slice-1 DWD-2 + the capture's Phase-4 staging).

## The break (verified by code trace, then reproduced as a RED unit test)

A live assistant chat turn travels:
`ui/` (cookie-only auth) → `/ui-server/chat` → `agent-client` (forwards cookie+authz) →
auth-proxy `/worker/chat` → agent → agent calls backend to PERSIST a transform.

The last hop fails in **both** dev and workos:

1. The agent authenticates to the backend with `Bearer ${jwt}`
   (`agent/lib/chat/backend-client.ts:25-26`), where `jwt = extractJwt`, which
   reads ONLY the `Authorization` header (`agent/lib/chat/handleChat.ts:78-84`). A
   cookie-only request has no Authorization header → `jwt = ""`. `backendClient`
   forwards no cookie.
2. The agent reaches the backend through auth-proxy's catch-all `app.all("*")`
   (`auth-proxy/app.ts:865`), which does `readCredential` → **401 if no token, in
   BOTH modes** (no dev bypass on the catch-all).
3. So the agent posts an empty Bearer + no cookie → 401. Assistant transforms are
   broken in dev too (the direct `ui/`→backend calls work via the cookie; the
   **agent** hop drops it).

NOT an M2M problem. The backend is a pure resource server keyed on
auth-proxy-injected `X-User-Id`/`X-Org-Id`/`X-User-Email`; it does NOT validate
tokens (`backend/app/auth/middleware.py:32-59`, ADR-043). No M2M minting / backend
token-acceptance was added — out of scope.

## The fix (auth-proxy only — `buildAgentIdentityHeaders`, app.ts:591)

The `/worker` handler already validates the inbound credential and HOLDS the raw
token. It now REHYDRATES that token as `Authorization: Bearer <token>` on the
upstream request to the agent, so the agent's existing `extractJwt → backendClient`
path forwards a real token, which re-enters auth-proxy's `/api/*` catch-all,
verifies, and yields backend identity headers.

Applied in **BOTH** branches (dev was also broken):

- **dev branch**: now reads the credential (header-first then cookie, via
  `readCredential`) and, if a token is present, sets `Authorization: Bearer <token>`
  WHILE still injecting the `dev-user-001` identity headers. The rehydrated dev
  token is the `auth_token` cookie value — an auth-proxy-minted user token that the
  catch-all's `verifyToken` accepts in dev. No credential → identity injected only
  (chat still works; only the transform sub-call needs the token).
- **workos branch**: after `verifyToken(token)` succeeds, sets
  `Authorization: Bearer <token>` alongside the verified identity headers.

Guardrails honoured:
- The rehydrated Bearer is the canonical credential for the hop; setting it is
  idempotent when the client already sent the same token as a header (no double).
- The token is never logged (no `console.*`/log line carries the Bearer; identity
  + scope only).
- The existing `/worker` SSE streaming + identity-header injection are intact.

## Driving-port (TBU-proof) acceptance test

Driving port = the real auth-proxy route `app.all("/worker/*")`, exercised via
`app.fetch(new Request("http://localhost/worker/chat", …))`. The sole mock is the
downstream agent port (`vi.stubGlobal("fetch")`), so the assertion reads the exact
headers auth-proxy forwards upstream. A correct-but-unwired implementation cannot
pass — the test enters through the production route, not a helper.

Scenarios (`auth-proxy/app.test.ts`, describe "ssr-ui-server-gateway slice-2…"):

| # | Mode | Credential | Asserts | Pre-fix |
|---|------|-----------|---------|---------|
| 1 | dev | cookie-only | `Authorization: Bearer <token>` + dev identity | **RED** |
| 2 | dev | header Bearer | same Bearer (no clobber) + dev identity | green (guard) |
| 3 | dev | none | dev identity injected, NO Authorization, still proxied | green (guard) |
| 4 | workos | cookie-only | `Authorization: Bearer <token>` + verified identity | **RED** |
| 5 | workos | header Bearer | same Bearer + verified identity | green (guard) |
| 6 | workos | none | 401 (unchanged) | green (guard) |

Confirmed RED→GREEN: cases 1 & 4 failed against the unfixed code (received `null`
Authorization), pass after the fix; full auth-proxy suite stays green (290 passed).

## Empirical verification (see submit summary for before/after evidence)

Unit tests alone are insufficient for this slice (an earlier dev-behavior claim was
made by reasoning and was WRONG). The dev empirical replay of the real
agent→backend transform path is REQUIRED. WorkOS browser-driven verification is
best-effort headless and flagged for human manual confirmation if a full WorkOS
login is not doable in a headless session.

## Gate caveat (carried from Slice-1)

`tools/test/test.sh --auto` maps `auth-proxy/` changes to the `--backend` gate, so
the refinery will **NOT** run auth-proxy vitest. Local `cd auth-proxy && npx vitest
run` green is MANDATORY before `gt mq submit`.
