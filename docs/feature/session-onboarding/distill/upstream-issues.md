# DISTILL Upstream Issues — session-onboarding `/event` parity slice

**Wave:** DISTILL · **Date:** 2026-05-24 · **Author:** Quinn (nw-acceptance-designer)
**Against:** `docs/feature/session-onboarding/design/event-slice-scope.md` (RATIFIED 2026-05-24)

Issues found while turning the ratified seeds into executable tests. None blocks DISTILL.
The ratified decisions (OQ-E1/E2/E3, D-E1/E2/E3) are all internally consistent — no
contradiction was found. The items below are observability gaps and clarifications.

---

## U-E1 (observability gap, non-blocking) — Slice 2's `error_terminal` / `retry_budget_used_count` are not observable at the projection boundary

**Severity:** low (documentation / seed-expectation correction). **Does not block the slice.**

**Seed text (event-slice-scope.md §4 Slice 2):**

```
THEN  HTTP 200 each AND projection.state transitions error_recoverable → … → error_terminal
  AND projection.context.retry_budget_used_count == 3
```

**Empirical finding (verified through the in-process HTTP transport):** neither assertion
holds at the projection boundary.

1. **`error_terminal` is never projected.** `projection.ts` has reducers for
   `reissue_failed_partial` (→ `error_recoverable`) but **no `error_terminal` reducer**, and
   the session-onboarding strategy's `settle` (`strategy.ts:94-171`) has arms for `ready`,
   `error_recoverable`, and `needs_org` but **no `error_terminal` arm** — so when the actor
   escalates to `error_terminal`, no terminal event is appended to the log. The orchestrator
   returns `projectionFor(...)`, which is a pure fold of the event log
   (`orchestrator.ts:1356-1366`), so the projection's `state` cannot reach `error_terminal`.
   Observed: after the `__force_failure__` / budget-exhaustion path, three `retry_clicked`
   posts each return 200 and the projection STAYS `error_recoverable`.

2. **`retry_budget_used_count` is actor-internal, not projected.** It lives in the machine
   context (`setup/types.ts:76`) but is absent from the projected context shape the
   orchestrator destructures (`orchestrator.ts:782-799`), so it is not in the
   `GET /projection` payload.

**Why this is a gap, not a bug, and not in scope:** the `error_terminal` state has no settle
emission *today* (pre-existing), and adding one would be a behavior change to the projection
contract — outside this transport-parity slice (which is scoped to `router.ts` only, plus the
D-E2 domain export). The escalation IS correctly happening inside the actor; it just is not
surfaced.

**Resolution taken in DISTILL (Iron Rule):** the Slice 2 characterization pins the ACTUAL
observable truth — `retry_clicked` is accepted (200) over `/event` and the flow REMAINS on the
recoverable-error screen. We do NOT assert `error_terminal` or `retry_budget_used_count`
(asserting an internal counter would also violate critique Dimension 7, observable-behavior
assertions).

**Recommendation for a future wave (NOT this slice):** if the FE/harness needs to distinguish
"retry budget exhausted" from "still retryable", add an `error_terminal` settle arm + projection
reducer (and optionally surface `retry_budget_used_count`). Track as a separate DESIGN/DISTILL
item for the session-onboarding error-surface, not folded into the `/event` parity slice.

---

## U-E2 (clarification, non-blocking) — current cross-principal `/event` returns 500, not a silent cross-tenant write

**Severity:** informational. **Confirms, does not contradict, D-E3 / OQ-E1.**

The scope (D-E3, `router.ts:215`) frames the latent hole as "any caller can post an event to
*any* `flow_id`". Verified current behavior: posting `flow_id: session-onboarding:u9` while
the verified principal is `u2` returns **HTTP 500** (`event_failed`) because u9's actor does
not exist (`orchestrator.ts:707` `unknown flow_id` throw) — NOT a silent cross-tenant write.
The hole is nonetheless real for an EXISTING sibling actor (u9 already begun): the event would
reach u9's flow. Slice 5's RED test asserts the TARGET — 403 rejected at the ACL **before**
reaching the orchestrator — which closes the hole for both the nonexistent and the existing
sibling cases. No change to the ratified decision; this just records the precise current
failure mode so the crafter expects a 500→403 delta, not a 200→403 delta.

---

## U-E3 (clarification, non-blocking) — malformed `org_form_submitted` payload currently reaches `creating_org`, not a clean no-op

**Severity:** informational. **Confirms the Slice 6 motivation.**

The scope (Slice 6) frames an absent `org_name` as reaching "the actor as a silent no-op".
Verified current behavior: `payload: {}` (no `org_name`) actually advances the flow to
**`creating_org`** (200) — `org_name` arrives `undefined`, the guard does not reject it, and
org-create proceeds. So it is worse than a no-op: a malformed command drives a real state
transition. Slice 5/6's RED tests assert the TARGET — 400 at the boundary with the projection
UNCHANGED (`needs_org`). Confirms and slightly strengthens the Slice 6 rationale; no decision
change.
