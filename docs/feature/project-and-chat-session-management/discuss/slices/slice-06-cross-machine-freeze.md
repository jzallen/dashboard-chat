# Slice 6 — Cross-machine FREEZE/THAW

> **Wave**: DISCUSS — `project-and-chat-session-management` (J-002)

## Goal

When J-001 transitions to `expired_token`, the orchestrator
broadcasts FREEZE. J-002 pauses its outgoing mutations; intent
events queue in the orchestrator's replay buffer with their
original `correlation_id`. On THAW (silent re-auth success),
queued intents replay against the live machine. The user never
re-clicks or re-types.

This is **the riskiest carpaccio** — the architectural payoff
from ADR-028 §94 ("cross-machine freeze is a 5-line
`system.get(...).send(...)` loop, not a hand-rolled pub/sub").
With one machine in the substrate, the payoff is zero; with two
machines (J-001 + J-002), the payoff is observable for the first
time.

## IN scope

* J-002 state: `freeze` side-state (reachable from every
  non-terminal state).
* Top-level FREEZE handler in the J-002 machine (one transition
  declaration; XState v5 actor-model pattern).
* THAW transition with history target (returns to
  `last_live_state`).
* Stale-intent filter on replay: drop intents whose target no
  longer exists in the post-freeze state (e.g., a
  `session_clicked` for a session in a project that the user
  switched away from during the freeze window).
* Replay buffer integration with the orchestrator (already in
  place from J-001; J-002 just declares its FREEZE handler and
  participates).
* TS harness `harness.j002.freeze()` and
  `harness.j002.thaw()` simulating orchestrator broadcasts.

## OUT scope

* New cross-machine signals beyond FREEZE/THAW.
* Direct J-002 → J-001 communication (forbidden per ADR-028:46-48
  "no machine imports another machine").

## Stories

* **US-210**: J-002 honors FREEZE/THAW from J-001's `expired_token`.

## Learning hypothesis

* **Disproves if it fails**: the substrate amortization promise.
  If the FREEZE/THAW contract doesn't compose with J-002 cleanly
  (e.g., stale intents observable to the user; replay produces
  duplicate writes; the substrate needs J-002-specific changes),
  ADR-028's payoff is overstated and we need a separate cross-machine
  coordination primitive.
* **Confirms if it succeeds**: the substrate is correctly
  amortizable. Adding J-003+ FREEZE participation is a 5-line
  change per machine, not an architectural change.

## Acceptance criteria (slice-level)

* [ ] J-002 declares a top-level FREEZE handler reachable from
  EVERY non-terminal state (validated by an automated check that
  every state in the machine config has the FREEZE event in its
  `on` block OR inherits one via top-level config).
* [ ] On FREEZE, J-002 transitions to `freeze` and records
  `last_live_state` in machine context; no outgoing mutations
  fire while in `freeze`.
* [ ] On THAW, J-002 transitions back to `last_live_state` with
  the original `correlation_id`.
* [ ] Mid-flight backend responses arriving during `freeze` are
  discarded by J-002 (no transition).
* [ ] Replay buffer captures J-002 intents with their original
  correlation_ids; replays them on THAW per ADR-027 §5 (5s
  timeout, 16 max per flow).
* [ ] Stale intents are dropped with a
  `stale_intent_dropped_after_thaw` observability event; J-002
  does NOT raise an error to the user.
* [ ] On 5s timeout without THAW, J-002 transitions
  `freeze → error_recoverable` with the original correlation_id.
* [ ] TS harness exposes `harness.j002.freeze()` and
  `harness.j002.thaw()`.

## Dependencies

* **Upstream**: Slices 1-5 (J-002 has live mutations to freeze).
* **Substrate**: J-001's FREEZE broadcast wire is in
  `ui-state/index.ts` from J-001 DELIVER (already in place per
  ADR-028 §"Decision outcome").
* **DESIGN-deferred**: OQ-J002-6 (stale-intent filter rule). The
  filter is "drop intents whose target no longer applies after
  THAW" — but the precise rule (e.g., does a `dataset_picked_directly`
  intent for dataset D drop if the user switched projects and D
  belongs to the old project?) needs DESIGN clarification before
  DELIVER.

## Effort estimate

* ~1.5 days (1 story; the FREEZE handler is ~3 hours, the
  stale-intent filter is ~3 hours, the TS harness assertions are
  ~3 hours, and a full acceptance test wiring against J-001's
  expired_token fixture is the remaining time).

## Pre-slice SPIKE

**OQ-J002-6 resolution by DESIGN**. The stale-intent filter rule
is the load-bearing question. DESIGN clarifies:

* Which J-002 intents are "stale" after a THAW that happened
  during a project switch?
* Should the orchestrator's replay buffer be ordered (FIFO),
  unordered, or "last-write-wins per intent type"?
* What does the user see when an intent is dropped — a toast,
  silent observability, or a transition to `error_recoverable`?

SPIKE estimate: half a day of DESIGN discussion to land OQ-J002-6.

## Dogfood moment

A developer triggers J-001 token expiry mid J-002 mutation via
J-001's `__harness_expire_token__` knob (see
`ui-state/lib/machines/login-and-org-setup.ts:67-69`). J-002
freezes; silent re-auth completes; J-002 thaws; the mutation
completes without re-click.

## Production-data check

Real J-001 `expired_token` transition (not synthetic); real
orchestrator broadcast.

## Carpaccio taste tests

* "Ship 4+ new components"? No — 1 FREEZE handler + 1 THAW
  history target + 1 stale-intent filter + 1 banner UI.
* "Depends on a new abstraction"? No (substrate is in place).
* "Disproves a pre-commitment"? Yes — substrate amortization.
* "Synthetic data only"? No — real J-001 expired_token.
* "Identical to another slice at scale"? No (this is the only
  cross-machine slice).
