# Prioritization — transform-operations-ir

**Ordering principle:** highest-uncertainty / highest-anxiety slice first (so a
failure costs the least and de-risks everything downstream), then dependency
chain, then dogfood cadence.

## Recommended execution order

| Order | Slice | Why this position | Reference class / risk |
|---|---|---|---|
| 1 | **01 — `sequence` ordering** | The dominant *restraining force* is anxiety about the migration (`jtbd-four-forces.md`). It is also the foundation every other slice assumes (`order_by(sequence)`). Ship it first and in isolation so the riskiest change is proven against production data before anything builds on it. | ADR-051 §Consequences/Operational lists 4 migration concerns (backfill formula, concurrent-insert safety, deploy ordering, rollback). **Pre-slice SPIKE recommended** on the `sequence` assignment formula. |
| 2 | **02 — boundary validation** | Independent of the renderer; immediately removes the silent-degrade failure mode (JOB-003 O2, under-served, score 14). High value, low risk, no dependency. Mirrors the already-proven `ViewFilterVariant` pattern. | Low — copying an established in-repo pattern (`view.py:154-214`). |
| 3 | **03 — dispatch catalog + completeness probe** | The shared abstraction Slices 04 and 05 both need. Carpaccio rule: *ship the abstraction first as its own slice.* Its observable value is the completeness probe. | Medium — refactor of `types.py:120-267`. If the collapse exceeds 1 day, split: 3a = `CleaningExpression` arm, 3b = `QueryBuilderJSON.as_ibis_filter` arm. |
| 4 | **04 — sparse sidecars** | Builds on the visitor shape from 03. Validates the sparseness assumption with a substrate-divergence test. | Low/medium — two tables + nullable left-join. |
| 5 | **05 — bounded inbound M import** | The payoff slice (Excel→operations). Depends on validation (02) and reuses the catalog (03). Highest *capability* value but lowest urgency for correctness; placing it last lets it stand on hardened foundations. | **High — pre-slice SPIKE recommended** on the M grammar subset. Ship a minimal 2-operation vocabulary (`Text.Trim`, `Text.Lower`) first; reject-by-name everything else. |

## Dogfood cadence

- After **01**: reorder operations in the app and watch the preview SQL change to match (same day).
- After **02**: submit a deliberately broken operation and get a 422 instead of a broken preview.
- After **03**: run the completeness probe; delete a catalog entry locally and watch the build name the gap.
- After **04**: render a `trim` and confirm ASCII-vs-`Text.Trim` fidelity is pinned.
- After **05**: import a real Power Query script exported from Excel.

## Learning-leverage note

Slices 01 and 05 carry the most uncertainty (migration safety; M↔vocabulary fit)
and are deliberately bookended by a recommended SPIKE. Slices 02–04 are
lower-variance EXTENDs of proven in-repo patterns and can proceed without a
SPIKE.
