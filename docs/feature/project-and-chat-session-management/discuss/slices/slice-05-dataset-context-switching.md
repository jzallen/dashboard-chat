# Slice 5 — Dataset context switching

> **Wave**: DISCUSS — `project-and-chat-session-management` (J-002)

## Goal

A user switches dataset context within a session — via the agent's
`resolve_dataset` tool-call return path OR via direct selection
from a dataset list. J-002 owns the multi-turn state of this
switch; the agent stays stateless. The picked dataset's id
flows into `active_scope.resource_*` AND persists into session
metadata so resume restoration (Slice 2) works.

## IN scope

* J-002 state: `switching_dataset_context`.
* Event handlers in `session_active`:
  `dataset_resolved_by_agent` (from FE intercepting
  `data-agent-request` typed parts) AND `dataset_picked_directly`
  (from FE UI selection lists).
* ScopeResolver invariant 4 enforcement (cross-tenant /
  cross-project dataset access denied).
* Session metadata `active_dataset_id` write path
  (storage shape per Slice 2's OQ-J002-1 resolution).
* Chat-turn re-submission after a successful resolution carries
  the new `X-Active-Scope` (composes with Slice 4's contract).
* Graceful failure: cross-tenant pick keeps prior
  `active_scope.resource_*` UNCHANGED; inline copy in the gutter.

## OUT scope

* FREEZE/THAW (Slice 6).

## Stories

* **US-209**: Dataset context switching via agent's
  `resolve_dataset` OR direct selection.

## Learning hypothesis

* **Disproves if it fails**: that J-002 can own the multi-turn
  shape of a tool-call-driven flow while the agent stays
  stateless. If the FE-emitted `dataset_resolved_by_agent`
  event ever drifts from the agent's `resolve_dataset`
  tool-call payload (e.g., the FE picks "A" but emits "B"),
  the contract is wrong.
* **Confirms if it succeeds**: J-002 owns chat-session multi-turn
  state cleanly (D9 from `wave-decisions.md`); the
  agent stays the chat brain (D8) without growing flow logic.

## Acceptance criteria (slice-level)

* [ ] `session_active` declares both `dataset_resolved_by_agent`
  and `dataset_picked_directly` as transitions to
  `switching_dataset_context` with the same payload shape.
* [ ] `switching_dataset_context` calls ScopeResolver invariant 4;
  on 403, transitions back to `session_active` with
  `active_scope.resource_*` UNCHANGED.
* [ ] On success: `active_scope.resource_type = "dataset"`,
  `active_scope.resource_id = <picked-id>`, AND
  `session.active_dataset_id = <picked-id>` persisted.
* [ ] Chat-turn re-submission carries new `X-Active-Scope` with
  `resource_*` populated.
* [ ] Concurrent `dataset_resolved_by_agent` events serialize
  via XState single-event-at-a-time semantics; the most-recent
  pick wins.
* [ ] TS harness exposes
  `harness.j002.attach_dataset_via_agent(name)` and
  `harness.j002.attach_dataset_directly(id)`.

## Dependencies

* **Upstream**: Slice 4 (agent X-Active-Scope contract; the
  re-submission test scenario depends on Slice 4's contract being
  live).
* **Upstream**: Slice 2 (session metadata `active_dataset_id`
  storage shape from OQ-J002-1).

## Effort estimate

* ~1.5 days (1 story; the machine state + both event-handlers
  + persistence side-effect + chat-view wire-up).

## Pre-slice SPIKE

**Verify the FE's `data-agent-request` typed-part interception
shape**. The FE today consumes the typed part to show an inline
dataset list (per `agent/lib/chat/handleChat.ts:99-104`). The new
behavior: emit `dataset_resolved_by_agent` to J-002 on user pick.
SPIKE estimate: 1 hour to confirm the FE's chat-view component
has a clean hook point for this emit.

## Dogfood moment

A developer in a chat session with no dataset attached types
"filter rows where age > 30" referencing a dataset by name. The
agent's `resolve_dataset` tool fires; the inline picker
appears; the developer picks; the filter applies. The developer
closes the tab, reopens it, picks the same session in the nav
rail; the dataset chip is restored.

## Production-data check

Real `resolve_dataset` tool-call from the agent's LLM; real
dataset rows in the dev backend; real session-metadata write.

## Carpaccio taste tests

* "Ship 4+ new components"? No — 1 machine state + 1 event
  handler bundle + 1 chat-view edit.
* "Depends on a new abstraction"? No.
* "Disproves a pre-commitment"? Yes — that J-002 can own the
  multi-turn state without the agent growing flow logic (D9).
* "Synthetic data only"? No.
* "Identical to another slice at scale"? No.
