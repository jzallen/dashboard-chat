# Design Intent (seed) — session-onboarding machine

**Wave:** pre-DESIGN seed · **Date:** 2026-05-22 · **Kind:** brownfield REFACTOR + domain-model correction
**Entry point:** `/nw-design` (architecture question + refactoring scope → C4 + ADRs + domain model)
**Subject:** `ui-state/lib/machines/login-and-org-setup/` → proposed rename `session-onboarding`
**Related ADRs:** ADR-030 (flow-state topology; projection-as-read-model + emission-completeness tripwire), ADR-016 (auth-proxy as token SSOT), ADR-039 (canonical machine names), ADR-040 (hexagonal transport / LEAF-4–6 in flight)

This document is a **seed brief**, not a DESIGN deliverable. It captures the problem, the
evidence, the decisions already locked with the user, and the open questions the DESIGN
wave must resolve. The wave owns the C4/ADR/domain-model outputs.

---

## 1. Problem

The login flow's XState machine (`createLoginAndOrgSetupMachine`) models an authentication
handshake that **does not happen in ui-state**. Its vocabulary (`anonymous`,
`sign_in_clicked`, `authenticating`, `auth_callback_resolved`, `auth_failed`) describes a
WorkOS sign-in that occurs upstream and out of band. By the time any request reaches
ui-state, auth-proxy has already authenticated the user and injected verified identity
headers. The machine re-enacts a completed handshake, and in doing so produces an
**observable defect**: the resolved user profile never reaches the projection.

## 2. Evidence

### 2.1 The user is already authenticated at the ui-state boundary
- `auth-proxy/app.ts:192` (`app.all("/ui-state/*")`): prod verifies the Bearer JWT and
  returns its own `401` on failure — the request is **never proxied** to ui-state; dev
  injects hardcoded `DEV_USER` headers.
- It injects trusted `X-User-Id`, `X-Org-Id`, `X-User-Email` (stripping any client-supplied
  copies, `auth-proxy/lib/auth.ts:67`).
- The inbound `Authorization` header **is forwarded** to ui-state (not in the stripped
  identity-header set; `proxyToUpstream` passes the header set to `fetch`,
  `auth-proxy/app.ts:469-481`). → ui-state can re-verify the token if it chooses to.

### 2.2 The resolved profile is stranded in the snapshot (placeholder bug)
A runtime probe of `LoginBeginStrategy.begin()` with a stubbed WorkOS profile produced:

```
settled state: authenticated_no_org
ACTOR snapshot context.user:  {"email":"maya.chen@acme-data.example","display_name":"Maya Chen","first_name":"Maya"}
event log types: [ 'sign_in_clicked', 'auth_callback_resolved' ]
auth_callback_resolved payload.user:  {"email":null,"display_name":null,"first_name":null}
PROJECTION context.user:           {"email":null,"display_name":null,"first_name":null}
```

Cause: at the emission read the log holds only `[sign_in_clicked]`; `begin()` reads
`user` back from that (empty) projection and emits `auth_callback_resolved` with
`user: null`. The real profile, assigned to the actor snapshot by the `workosUserInfo`
`onDone`, is never written to the log. This is ADR-030's own "emission-completeness"
tripwire firing (amendment 2026-05-16). The login projection exposes `user: null`
end-to-end.

### 2.3 The `sign_in_clicked` payload is inert in the projection
`sign_in_clicked` carries `persona_email`/`persona_display_name`
(`strategy.ts:363-366`), but the projection reducer ignores the payload
(`projection.ts:213-216`, `_event` unused) — it only flips state to `authenticating`.
(The machine *does* use `persona_email` as the fake-workos lookup key; the projection
does not.)

### 2.4 Dead machine events (already removed)
`auth_callback_resolved` / `auth_failed` were declared in the `LoginEvent` union but no
`on:` block consumed them and nothing `.send()`s them — the machine transitions via the
`workosUserInfo` invoke `onDone`/`onError`. Removed in `79a9c01` (behavior-neutral).
They remain live only as FlowEvent types + projection reducers.

### 2.5 Identity sourced from a client claim, not the verified header
The router seeds `principal_id` from `X-User-Id` but takes `persona_email` from the
**request body** (`router.ts:150`), and `X-User-Email` is dropped at the ui-state
middleware. `persona_email` (`.min(1)`, required in `loginRequestSchema`) is a fake-workos
fixture seam exposed as a production DTO field — a production-path gap for real WorkOS.

---

## 3. Current happy path (as-is)

```
auth-proxy verifies + injects X-User-Id/Org-Id/Email ──▶ ui-state /begin
  middleware: userId←X-User-Id, body←{persona_email,...}   (X-User-Email dropped)
  begin():
    [reset log]
    anonymous ─actor.start()
       ├ append sign_in_clicked{persona_*}   (projection reducer IGNORES payload)
       └ send sign_in_clicked                 (machine uses persona_email as lookup key)
    authenticating ─invoke workosUserInfo(persona_email)─ onDone→assign user to SNAPSHOT
    authenticated_no_org
       ├ read user from buildProjection([sign_in_clicked]) ⇒ NULL
       └ append auth_callback_resolved{user:NULL}        ← placeholder persisted
  (subsequent /event) org_form_submitted → creating_org → invoke createOrgAndReissue
       → ready: settle harvests org+user from SNAPSHOT, emits org_created_and_jwt_reissued{org,access_token}
                (user NOT in payload ⇒ projection.user stays NULL); broadcasts auth_ready→project-context
```

## 4. Proposed happy path (to-be) — for the wave to ratify

```
auth-proxy verifies + injects X-User-Id/Org-Id/Email + forwards Bearer ──▶ ui-state /begin
  middleware: identity from VERIFIED headers; NO persona_email body claim
  begin()  flow_id = "session-onboarding:<userId>"
    [reset log]
    verifying ─invoke workosUserInfo(BEARER TOKEN)─        ← re-verify (defense in depth)
       │   calls WorkOS /oauth/userinfo with the forwarded token
       ├ onDone → emit session_started{ user:<WorkOS profile>, org:{id,name}|null }
       │            projection FOLDS it ⇒ context.user populated at t=0   (bug fixed)
       │            then  always ─[hasOrg]→ ready  |  [else]→ needs_org
       └ onError → session_rejected (terminal)               ← token/user invalid
    needs_org ─org_form_submitted[orgNameValid]→ creating_org
       → ready (settle emits org_created{org,access_token}; user already in projection)
       → broadcast org_ready → project-context
    ready ─token_expired→ expired_token ─invoke silentReauth→ ready | error_recoverable
    error_recoverable ─retry_clicked[budget]→ creating_org | error_terminal
```

---

## 5. Locked decisions (user-ratified — DESIGN must honor)

| # | Decision |
|---|---|
| L1 | Machine renamed `session-onboarding`; entry assumes an already-authenticated user. |
| L2 | `session_started` is the opening FlowEvent and **carries the verified user**; the projection is seeded from it. `begin()` never reads identity back from a just-reset projection. |
| L3 | **Keep** the `workosUserInfo` invoke, repurposed as **token-based re-verification** (defense in depth: if a deployment misconfig exposes ui-state to the open web, the WorkOS call independently validates user + token). It is no longer the authenticator. |
| L4 | Re-verification uses the **forwarded Bearer token**, not the `persona_email` body claim. Identity comes from the verified token, never client body input. |
| L5 | `display_name` comes from the WorkOS profile returned by the re-verify call (so auth-proxy need NOT forward a name claim). |
| L6 | Retire `anonymous`, `sign_in_clicked`, `auth_callback_resolved`; rename `authenticated_no_org → needs_org`; keep `creating_org`/`ready`/`expired_token`/`error_recoverable`/`error_terminal`; add the `[hasOrg]` returning-user shortcut and a `session_rejected` terminal for re-verify failure. |

## 6. Open questions (DESIGN wave owns)

1. **Dev / fake-workos token path.** Dev injects `DEV_USER` with no real token. Define how
   token-based re-verify behaves in dev (skip in dev? fake-workos accepts `dev-token-static`
   at `/oauth/userinfo`?). The current `workosUserInfo` does a code→token *exchange* keyed by
   `persona_email`; the redesign switches to a **direct userinfo call with the Bearer** — spec
   that change and its dev variant.
2. **`session_rejected` shape** — HTTP status mapping, projection state, and how it surfaces
   distinctly from org-setup errors.
3. **`session_started` reducer + projection reducer set** — exact payload, the `[hasOrg]`
   branch replicated in the projection, and which current reducers retire.
4. **Event-sourced projection vs. server-authoritative store.** With auth re-enactment gone,
   J-001's projection becomes very thin (user from one event, org from one event, a few
   states). ADR-030's tripwire says evaluate the simpler per-flow store here.
5. **`access_token` mint** (`mintAccessTokenForReady`) — is the ui-state reissue real or
   vestigial given auth-proxy is the token SSOT (ADR-016)? Scrutinize the `org_created`
   reissue framing.
6. **Acceptance-test impact** — J-001/J-002 suites under
   `tests/acceptance/...`; FlowEvent renames and the new `session_started` event will ripple.

## 7. Constraints & sequencing

- **Land after ADR-040 LEAF-4/5/6.** The hexagonal-transport LEAF series is in flight on the
  same machine package; touching `session-onboarding` mid-series increases merge churn.
- **Behavior-neutral where possible; new contract where not.** The state-set change is a
  genuine behavior change (placeholder→real user, new rejection path) — it needs RED
  acceptance coverage, not just characterization.
- **Rename touches ADR-039 canonical registry key** — sequence deliberately.

## 8. Status of related cleanups (already landed on main)

- `79a9c01` — removed dead `auth_callback_resolved`/`auth_failed` machine-event union entries.
- `b704953` — corrected `begin()` docstring to the data-scoped ADR-030 read rule.
- The `TODO(ADR-030)` in `strategy.ts` documents the emission-completeness defect this design closes.
