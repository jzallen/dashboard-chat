# FINALIZE — J-002 `project-and-chat-session-management`

**Finalized:** 2026-05-16
**Status:** COMPLETE — all six MRs + the verify gate + three substrate fixes landed on `main`.
**Journey:** J-002 (project & chat-session management) — the second flow on the `ui-state` server-owned state-machine substrate (J-001 was the first; ADR-027/028/030).

## What shipped

Server-owned project/session/dataset context for the chat-driven workflow:
selection, last-used resume, lazy session creation, atomic project
switching, agent-driven & direct dataset attachment, and cross-machine
FREEZE/THAW survival of token expiry. The feature retires the
frontend's parallel state-drift surface (TanStack key + route param +
React context) in favour of two J-002 machines (`project-context`,
`session-chat`) the orchestrator coordinates.

## Merge-request arc (in landing order)

| MR | Scope | Landed |
|---|---|---|
| MR-1 | Walking skeleton + substrate + initial scope + deep links (US-201/202/204) | ✓ |
| MR-2 | Session list / resume (US-203/205) | ✓ |
| MR-3 | Lazy session creation (US-206) | ✓ |
| MR-4 | Atomic project switching + agent X-Active-Scope (US-207/208) | ✓ |
| **MR-4-verify** | Un-skipped the deferred MR-4 acceptance scenarios — the honest gate that exposed two real substrate bugs instead of papering over them | ✓ |
| **D-MR4-06** | `switching_project` never settled — orchestrator emission arm missing (LEAF-B regression). Fix `08258cd` | ✓ |
| **D-MR4-05** | agent `authMiddleware` verified the JWT but discarded claims → cross-tenant guard dead code. Fix `a63aa28` | ✓ |
| MR-5 | `switching_dataset_context` (US-209) — agent-resolve + direct pick; `c84db55`. Surfaced **D-MR5-01** (resume-path emission harvest, fixed in-pattern) and **D-MR5-02** (pre-existing full-suite shared-principal ordering fragility, documented, out of scope) | ✓ |
| MR-6 | FREEZE/THAW (US-210) — the cross-machine substrate payoff (ADR-028 §94 realized); merge `43c7c04` | ✓ |

Final verification at MR-6: **mr_6 8/0 · mr_5 7/0 · mr_4 14/0/0**;
ui-state vitest 149/0; eslint 0 errors. The MR-4-verify arc moved the
suite from 8 pass / 1 skip / 5 fail to 14 pass / 0 fail / 0 skip with
zero regression and the Iron Rule held throughout (deferred skips were
un-skipped as implemented, never weakened).

## Lasting decisions

- **ADR-030 amendment (2026-05-16) — Emission-completeness tripwire.**
  Recorded mid-delivery: the event-sourced projection manufactures an
  invariant (every machine settle MUST emit a FlowEvent or the read
  model goes stale). It recurred five times across this one feature
  (D-MR4-06; D-MR5-01 ×2; MR-6 `harvestSettledFreezeState`). The
  tripwire names the trigger to evaluate the simpler store model.
- **ADR-040 — ui-state hexagonal transport + emission-completeness
  resolution.** A post-delivery guide-mode DESIGN session converted the
  J-002 substrate experience into the decision to resolve the tripwire
  **by exit**: deep hexagonal re-core (FlowStrategy port owns
  per-machine orchestration; orchestrator → generic pump), driven
  read-port swapped from the event-sourced projection to a hybrid
  server-authoritative store model + bounded US-210 intent buffer.
  Deferred LEAF-1..6 journey, recorded not scheduled.

## Deferred / still-open

- **ADR-040 LEAF-1..6 migration** — recorded, not scheduled. Owner: a
  future DISTILL pass when delivery capacity is committed. Not
  feature-blocking; J-002 runs correctly on the current substrate.
- **D-MR5-02** — full-suite shared-`dev-user-001` ordering fragility
  (pre-existing). Recommendation: per-test principal or a
  session-chat-flow-reset conftest fixture so the suite is
  order-independent. Out of J-002 scope.
- The architecture-review C2 (agent `/worker/*` auth-proxy bypass) was
  resolved as D-MR4-05; C3 (Redis triple-log blast radius) remains a
  DEVOPS-owned item per ADR-030 §"Negative".

## Lessons

- **The verify gate earned its keep.** MR-4-verify's only job was to
  un-skip honestly; it found the headline feature broken. Un-skipping
  deferred scenarios as a distinct gated step — rather than trusting
  green-by-skip — is what surfaced D-MR4-05/06 before they compounded.
- **A manufactured invariant that recurs is an architecture signal, not
  a run of bad luck.** Five in-pattern emission-completeness fixes in
  one feature is what turned a vague "watch this" into the ADR-030
  tripwire and then ADR-040's decision to remove the invariant rather
  than keep policing it.
- **Worker hard-death is recoverable when commits are atomic.** The
  MR-6 worker was OOM-killed in the final verification lap; its six
  atomic commits were intact and the hand-off (gate re-confirm, docs
  record, push, submit) completed by hand with zero re-implementation.
  Atomic commits + an Iron-Rule-respecting worker make a crashed run a
  hand-off, not a redo.

## Artifact archive

This directory is a verbatim copy of the feature's wave subtree at
finalize time: `discuss/`, `design/`, `distill/`, `deliver/`. Binding
ADRs (ADR-014/015/016/018/027/028/029/030/039/040) live in
`docs/decisions/` and remain the SSOT; this archive is the
journey-scoped record, not the decision SSOT.
