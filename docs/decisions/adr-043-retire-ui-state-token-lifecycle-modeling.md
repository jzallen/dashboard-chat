# ADR-043: Retire ui-state Token-Lifecycle Modeling (freeze/thaw + silent-reauth)

**Status:** Accepted (ratified by user 2026-05-22)
**Date:** 2026-05-22
**Originating wave:** DESIGN — interactive architecture review of `session-onboarding`
**Author:** Zach Allen (interactive design review)
**Relationship to prior ADRs:**
- **Completes ADR-041** (session-onboarding domain realignment). ADR-041 fixed the *entry*
  auth-handshake leak but carried the `expired_token` / silent-reauth subgraph over
  "verbatim (Reuse Analysis R1)" without re-examining its premise. This ADR examines and
  retires it.
- **Supersedes the US-005 decision driver of ADR-028** (XState v5 actor model). Cross-machine
  freeze was ADR-028's #1 driver; it is retired here. The XState v5 choice itself **stands** on
  ADR-028's other drivers (TypeScript inference, observability/`inspect()`, replay-free actor
  spawning, maturity).
- **Honors ADR-016** (auth-proxy = token SSOT).
- **Does not affect ADR-029** (org-bind JWT reissue). That reissue is a one-time re-mint during
  onboarding, not token-lifecycle coordination, and is retained.

## Context

`ui-state` models a cross-flow **freeze/thaw + silent-reauth** subsystem. Its premise (ADR-028,
US-005): when an access token expires mid-session, ui-state must freeze every active flow
machine's mutations, perform a single silent re-auth, then thaw and replay buffered intents —
so concurrent flows don't each fire a doomed request, race N renewals, or double-apply
mutations.

**The premise is false.** Auth-proxy centrally owns authentication and the token lifecycle
(ADR-016). Two facts follow:

1. **Inbound:** every request auth-proxy forwards to ui-state already carries a verified
   identity. For the life of a request ui-state handles, no re-auth is possible or needed.
2. **Outbound:** when ui-state calls the backend API, it goes *through* auth-proxy. If the token
   is invalid at that moment, auth-proxy performs the silent refresh transparently and forwards
   the request — ui-state never observes a mid-flight expiry. The only thing ui-state can see is
   a genuine backend/auth *failure* (refresh truly failed), which is an ordinary upstream error.

So ui-state is never a participant in token management. There is no point at which it must
freeze its flow machines to coordinate a refresh. The correct behavior for a real auth failure
on an outbound call is the same as for any other backend failure: **re-raise it as a ui-state
API error to the UI.**

This is the **same bounded-context leak** ADR-041 named — ui-state pretending to participate in
authentication — in the token-lifecycle dimension rather than the entry-handshake dimension.

The subsystem is also already inert in production: `silent_reauth_outcome` defaults to
`"pending"` (never set by any production path; `router.ts /begin` does not read it), the only
entry to `expired_token` (`__expire_token__`) is closed by the failure-simulation gate, and the
US-005 / US-210 acceptance scenarios are all `@skip`. It runs only when a test/harness drives it.

## Decision

**Retire ui-state's token-lifecycle modeling.** ui-state assumes inbound requests are
authenticated and treats backend auth failures on outbound calls as ordinary API errors
surfaced to the UI. The freeze/thaw + silent-reauth subsystem is removed across all layers:

- **session-onboarding machine**: `expired_token` state, `silentReauth` actor + `getSilentReauth`
  resolver, `silent_reauth_outcome` param, `__expire_token__` event, `SilentReauth*` types.
- **orchestrator**: `broadcastFreeze`/`broadcastThaw` (+ `*Core`), the bounded replay buffer
  (`FREEZE_WINDOW_MS`, `REPLAY_BUFFER_CAP`), frozen-flow tracking, the `expired_token`
  transition detection and silent-reauth in-flight wait, and `BeginFlowInput.silent_reauth_outcome`.
- **transport** (`flow-router.ts`): the `/freeze` + `/thaw` driving endpoints (`freezeThawHandler`).
- **harvester** (`orchestrator-harvester.ts`): the FREEZE/THAW settled-state harvest + `last_live_state`.
- **sibling machines** (`session-chat`, `project-context`): their frozen-participant `FREEZE`/`THAW`
  handlers and `settleThaw` paths.
- **tests**: `orchestrator.test.ts` freeze/thaw suites, `machine.test.ts` B4–B6, and the US-005 +
  US-210 acceptance assets (`chat-survives-mid-question-token-expiry.feature`,
  `test_us210_freeze_thaw_replay.py`, `expired-token.steps.ts`, related journey invariants and
  harness freeze/thaw plumbing).

## Considered options

1. **Keep the subsystem (status quo).** Rejected — built on a false premise, inert in
   production, and a standing cross-cutting maintenance + comprehension cost across four
   machines, the orchestrator, transport, and two acceptance suites.
2. **Wire a real auth-proxy → ui-state token-expiry signal so freeze/thaw goes live.** Rejected —
   no such signal exists or should: auth-proxy refreshes transparently per request. Building one
   would re-introduce the very bounded-context leak ADR-041 set out to remove.
3. **Retire the subsystem (chosen).** Aligns ui-state with auth-proxy's token ownership and
   completes ADR-041.

## Consequences

- **Simpler ui-state.** One fewer cross-cutting subsystem; the orchestrator loses its most
  complex (replay-buffer) machinery; `ready` becomes a plain terminal-ish state with no
  expiry side-channel.
- **Real auth failures** on outbound backend calls surface as ordinary ui-state API errors to
  the UI — the existing upstream-failure path. No behavior is lost for the user; the "silent
  refresh" they experience is auth-proxy's, transparently, as before.
- **US-005 and US-210 freeze/thaw acceptance are retired.** Their `@skip` scenarios encoded the
  false premise; they are removed rather than carried as permanently-skipped debt.
- **ADR-028's US-005 driver is superseded**; the XState v5 actor-model choice is unaffected.
- **Reversibility:** if a future requirement genuinely needs cross-flow coordination (not
  anticipated under auth-proxy token ownership), it would be re-introduced deliberately with its
  own ADR rather than inherited unexamined.

## References

- ADR-041 (session-onboarding domain realignment — the entry-handshake half of this leak)
- ADR-028 (XState v5 actor model — US-005 freeze driver superseded here)
- ADR-016 (auth-proxy = token SSOT)
- ADR-029 (org-bind JWT reissue — distinct, retained)
- `docs/feature/session-onboarding/design/event-model.md` (token_expired → silent_reauth subgraph being retired)

---

## Amendment 2026-05-27 — auth-proxy as issuer

**Status:** Accepted (2026-05-27)

**Decision:** auth-proxy becomes the single home for user-token issuance. Backend ceases to mint tokens and becomes a pure resource server. The org-create response carries a freshly-minted user token in an `X-New-Access-Token` response header, dissolving the FE's separate `/api/auth/reissue` round-trip.

This amendment extends — does not supersede — the original ADR. The original ADR aligned ui-state with auth-proxy's token *lifecycle* ownership. This amendment aligns the *backend* the same way: where ADR-043 said "ui-state stops pretending to participate in token management," this says "backend stops pretending to participate in token issuance." Same architectural arrow (ADR-016's "auth-proxy is the single home for auth, by design"), broader scope.

### Findings (one sentence each)

1. **auth-proxy already mints JWTs.** `lib/m2m.ts` (M2M tokens) and `lib/pat.ts` (PATs) sign through the shared `getKeypair()` (`lib/keypair.ts`) using `jose`; user-token minting joins an existing capability, not a new one.
2. **Backend has dual auth roles today.** `backend/app/routers/auth.py` mints user tokens (`callback`, `refresh`, `reissue`) while `backend/app/auth/middleware.py` runs as a resource server — a split ADR-016 already says belongs in auth-proxy.
3. **The reissue flow is non-functional, top to bottom.** `backend/app/routers/auth.py:131-138` returns 501 when `provider != DevAuthProvider` (despite `WorkOSAuthProvider.reissue_with_org` existing as a `NotImplementedError` stub), AND the FE's `ui-state/lib/machines/session-onboarding/setup/actors.ts:374-393` (`reissueOrgJwtFn`) discards the response body even when the call succeeds in dev — so the FE's stored JWT is never updated by the existing flow.

### Staging, risk register, sequence diagrams

See the feature design document: `docs/feature/auth-proxy-mints-user-tokens/design/design.md`. Three stages (issuance moves; response-header reissue lands; onboarding retry loop and backend `/api/auth/*` are deleted). Risk register and per-stage blast radius live there; this ADR records the architectural decision, not the implementation plan.

### Cross-ADR composition

- **ADR-016** (auth-proxy = single ingress, single home for auth). This amendment is the natural extension: auth-proxy gains *issuance*, not just verification. ADR-016 §"Why not Option 3" left open the long-term question; this amendment answers in the direction of *more* auth-proxy scope, not less.
- **ADR-029** (`active_scope` propagation). Invariant 1 — `active_scope.org_id` MUST equal the JWT's `org_id` claim — is unchanged. This amendment changes *who* mints the JWT carrying that claim, not whether the claim is carried.
- **ADR-041** (session-onboarding domain realignment). Entry-handshake leak named there is the entry side of the same bounded-context confusion this amendment closes on the issuance side.
- **ADR-043 (original).** Token-lifecycle leak retired in ui-state; this amendment retires the symmetric issuance leak in backend.

### Reversibility

Stage 3 deletes ~600 lines. Reversibility: re-add `backend/app/routers/auth.py`, restore the FE's `/api/auth/reissue` call site, and the system returns to stage-2 (auth-proxy issuance + backend dead-code-but-present) behaviour. The pre-stage-1 state (backend as issuer) is reversible up through stage 2 because backend's minting code is untouched until stage 3b's deletion commit.
