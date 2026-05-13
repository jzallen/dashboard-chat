# Prioritization — `project-and-chat-session-management` (J-002)

> **Wave**: DISCUSS
> **Date**: 2026-05-13

Per the `nw-discuss` Phase 2.5 step 7 discipline, prioritization is
documented **per slice**, not per release bucket. Rationale weights:

* **(L)** Learning leverage — slices that disprove the highest
  uncertainty first ship earlier so failures cost less.
* **(D)** Dependency chain — what a slice unblocks.
* **(F)** Dogfood cadence — when can a developer demo it
  end-to-end.

## Slice-level prioritization

| Order | Slice | L | D | F | Rationale |
|-------|-------|---|---|---|-----------|
| 1 | Slice 1 — Walking skeleton: Active scope resolves | M | High | Same day | Walking skeleton. Validates the substrate accepts a second machine. Disproves "the substrate amortizes" early if it fails. Every subsequent slice depends on `project_selected` being a live state. |
| 2 | Slice 2 — Session list + resume | High | Medium | Day 2 | Disproves D11 storage shape early (highest J-002-specific uncertainty). Slice 1 → 2 unblocks Slices 3, 5. |
| 3 | Slice 3 — New session lifecycle | M | Low | Day 3 | Lazy-create ergonomic is a one-machine-state change with a single learning question. Low-risk; can be done in parallel with Slice 4 in principle, but sequenced here for cadence clarity. |
| 4 | Slice 4 — Project switching + agent contract | High | High | Day 4-5 | This is the JOB-002 north-star (K-J002-4) AND closes the cross-tenant data-leak surface (K-J002-5). Sequenced after 1-3 because the SSE cancellation contract needs `session_active` to be a real state with real chat-turn dispatch. |
| 5 | Slice 5 — Dataset context switching | M | Medium | Day 6 | Validates D9 (J-002 owns multi-turn chat state; agent stays stateless). Layers on Slice 4's agent contract. |
| 6 | Slice 6 — Cross-machine FREEZE/THAW | High | Low | Day 7-8 | Riskiest carpaccio. Architectural payoff is multiplicative — needs J-002 to have live mutations to freeze, AND needs the substrate from J-001 to be exercised by a SECOND machine. Last because it presupposes Slices 1-5. |

### Riskiest-assumption-first vs sequenced ordering

A pure riskiest-first ordering would push Slice 6 (FREEZE/THAW) to
slice 1 and Slice 4 (agent contract) to slice 2. We did NOT do
that, mirroring J-001's slice-priority rationale at
`docs/evolution/2026-05-12-user-flow-state-machines/discuss/story-map.md:204-214`:

* **Slice 6 has structural prerequisites.** It needs live J-002
  mutations to freeze. Slices 1-5 must be in place.
* **Slice 4's risk is bounded by the substrate.** The cross-tenant
  surface closure is high-value, but the substrate (ADR-029 §4
  contract specification) is already in place. Slice 4 only
  validates the wiring.
* **The "highest uncertainty" in J-002 is D11 (storage shape) and
  the FREEZE participation pattern.** Slice 2 ships D11; Slice 6
  ships FREEZE. Both are sequenced as early as their dependencies
  allow.

### Per-job-story dependency

Each slice maps to one or two job stories from `jtbd-job-stories.md`:

| Slice | J002-Jobs covered | Disproves if it fails |
|-------|------------------|----------------------|
| 1 | J1 (Resume — degraded for no-project case), J3 (Deep link) | Last-used algorithm OR ScopeResolver invariant 4 wiring |
| 2 | J1 (Resume), J4 (Resume w/ dataset context) | D11 storage shape |
| 3 | J5 (Start fresh cleanly) | Lazy-create ergonomic |
| 4 | J2 (Switch w/o bleeding), J6 (Stay scoped during turn) | Atomic-switching + agent contract |
| 5 | J7 (Dataset switching) | D9 (J-002 owns multi-turn state; agent stays stateless) |
| 6 | J8 (Survive token expiry) | Substrate amortization claim from ADR-028 §94 |

### Parallel-execution considerations

* Slice 3 and Slice 4 are **technically parallelizable** — they
  touch different J-002 states (`session_active_no_messages` vs
  `switching_project`). If the team has two developers available
  after Slice 2 lands, they can split. We're documenting them as
  sequential for cadence clarity only.
* Slice 6 depends on Slices 1-5 collectively but has minimal
  overlap with their individual code paths — the FREEZE handler
  is a top-level declaration in the machine config.

### Dogfood demos

After each slice, a demo is feasible:

* **After Slice 1**: Cold open → project chip paints.
* **After Slice 2**: Session resume → transcript + dataset chip
  restored.
* **After Slice 3**: New Session → welcome state → first message
  → session created.
* **After Slice 4**: Project switch → atomic chip + list update;
  agent rejects malformed scope.
* **After Slice 5**: `resolve_dataset` flow → dataset context
  persists across session resume.
* **After Slice 6**: Mid-mutation token expiry → silent recovery.

The cumulative demo at the end of Slice 6 walks the full Maya
day: sign in → resume → switch project → switch dataset →
token-expires-mid-action → silent recovery → continue.
