# Slice 02 — Kernel visitor + report extension renderer

**Goal:** Collapse the View/Report compilers' shared steps into one kernel visitor the report extension composes, with a build-time completeness check.

**IN scope**
- Kernel visitor: sources → join(by sequence) → filter → project → `ibis.Table`.
- Report extension composes the visitor, then `group_by(grain).aggregate(measures)`.
- Render dispatch catalog: one entry per component discriminator; build-time completeness check per active visitor.
- Entity-only report = kernel output with no aggregation step (not a special branch).
- Operates on in-memory typed kernel VOs (persistence unchanged this slice).

**OUT of scope**
- Persistence/table changes (slices 03–07).
- New render targets (M-outbound) — catalog admits, deferred.

**Learning hypothesis**
- Disproves "the two compilers' shared steps are truly identical" if the char snapshot drifts on merge.

**Acceptance criteria**
- Consolidated renderer produces the same SQL as the separate compilers for an in-test relation. *(AC2, P2)*
- Unhandled discriminator fails build/test, not silent skip. *(AC5, P1)*
- Entity-only report renders via the shared path. *(decision 4)*
- No path reads compiled SQL/ibis back as authority. *(AC1)*

**Dependencies:** blocked by 00 (gate), 01 (typed report columns). **Blocks:** 03–07.
**Effort:** ~1 day. **Reference class:** ADR-051 decision-4 visitor/catalog (same pattern, staging tier).
**SPIKE:** none.

Traces: AC1, AC2, AC5, P1, P2 · ADR-052 decision 4.
