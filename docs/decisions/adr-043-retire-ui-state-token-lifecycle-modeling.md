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
