# Slice 05 — Bounded inbound M (Power Query) import

**Story:** US-5 · **Sub-job:** SJ-5 · **ADR-051:** D6 / decision 2 · **Effort:** ~1 day (+ pre-slice SPIKE)

## Goal (one sentence)
Import the supported subset of an Excel / Power Query (M) script as neutral operations, and reject any out-of-vocabulary construct by name at parse time — so nothing is silently dropped or half-imported.

## IN scope
- A **bounded M parser** that recognizes the M subset mapping to the operation vocabulary and emits neutral operations through the Slice-02 boundary validator.
- A new inbound endpoint, e.g. `POST /api/datasets/{id}/transforms/import-m`.
- Reject-by-name contract: out-of-vocabulary M (`Table.Join`, pivots, type engines) → structured `422` naming the unsupported construct; **no partial import**, no placeholder operation.
- Minimal starting vocabulary: `Text.Trim` → trim, `Text.Lower` → lowercase (extend deliberately).

## OUT scope
- Outbound operations→M renderer (deferred — admitted by catalog only).
- General M bridge (joins, pivots, type engines) until vocabulary is explicitly extended.

## Learning hypothesis
**Disproves** that the bounded M subset maps **cleanly** to the operation vocabulary. If a common M step (within the intended subset) has no neutral equivalent, the vocabulary must be extended *before* import is viable — that finding redirects the work.
**Confirms** that M and ibis genuinely meet only at the persisted operations list (tool-agnosticism end-to-end).

## Acceptance criteria
- AC1: Importing an M script of only `Text.Trim` + `Text.Lower` → `200`; the operations list contains the equivalent neutral operations **in script order** (with `sequence` assigned per Slice 01).
- AC2: Importing an M script containing `Table.Join` → `422` naming `"Table.Join"`; the operations list is **unchanged** (no partial import).
- AC3: Imported operations pass the Slice-02 boundary validator (same path as direct authoring).
- AC4: Round-trip stability on the supported subset (parse → operations is stable; re-import of the same script is idempotent in intent).

## Dependencies
**blockedBy Slice 02** (emits through the boundary validator). **benefits-from Slice 03** (the inbound M visitor is "one new visitor" once the catalog exists). Uses Slice 01 `sequence` for script order.

## Pre-slice SPIKE (recommended)
Pin the exact M-construct → operation mapping table for the starting subset and the parser strategy (hand-rolled recursive-descent over the bounded grammar vs a library). ADR-051 fixes the *behavior* (reject, name, no silent drop); the mapping table is DELIVER scope.

## Reference class
Bounded recursive-descent parser over a closed grammar subset; structured rejection. No precedent in-repo — highest-variance slice, hence the SPIKE and minimal first vocabulary.
