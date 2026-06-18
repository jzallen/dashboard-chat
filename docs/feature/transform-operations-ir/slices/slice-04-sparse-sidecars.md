# Slice 04 — Sparse per-target adapter-args sidecars

**Story:** US-4 · **Sub-job:** SJ-4 · **ADR-051:** D2 / decision 3 · **Effort:** ~1 day

## Goal (one sentence)
Store per-instance, per-target render deltas (e.g. ibis `.strip()` ASCII vs M `Text.Trim`) in sparse internal-only sidecar tables, so the canonical operation stays free of any tool's dialect while each target can still render faithfully.

## IN scope
- `operation_ibis_args(operation_id FK, args JSON)` and `operation_m_args(operation_id FK, args JSON)`, each `ON DELETE CASCADE`, **one optional row per operation**.
- ibis renderer left-joins `operation_ibis_args` (nullable; absence ⇒ render the neutral op faithfully).
- **Substrate-divergence probe**: a test that exercises a *specific* divergence (e.g. `trim` ASCII semantics) so each sidecar's reason-to-exist is pinned.
- Keep sidecars out of `Transform.serialize()` (`transform.py:71-84`) — internal-only.

## OUT scope
- M outbound render (the `operation_m_args` table can exist but its *renderer* is deferred with the outbound M work).
- Pushing deltas into `expression_config` (rejected — would contaminate the IR).

## Learning hypothesis
**Disproves** that target divergences are **sparse**. If, populating real operations, most need a sidecar row, the "neutral" vocabulary is leaking target concerns and must be re-cut before sidecars are the right tool.
**Confirms** the decision rule: intent → operation; faithfulness delta → sidecar.

## Acceptance criteria
- AC1: An operation with no divergence has **zero** sidecar rows and renders identically to today.
- AC2: For a `trim` operation, an `operation_ibis_args` row pins the ASCII-vs-`Text.Trim` delta; **removing the row makes the render drift from neutral intent** in a way the divergence test detects.
- AC3: No sidecar field appears in the customer-facing `Transform.serialize()` output.
- AC4: Renderer-completeness probe (Slice 03) stays green with sidecars wired in.

## Dependencies
**blockedBy Slice 03** — sidecars left-join into a renderer that is already a visitor over the catalog.

## Reference class
Nullable FK sidecar tables + cascade delete (`alembic-migration` skill). Sparse-population pattern; left-join in the render path.
