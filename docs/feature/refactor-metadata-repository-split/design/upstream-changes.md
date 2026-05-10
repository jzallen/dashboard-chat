<!-- DES-ENFORCEMENT : exempt -->
# Upstream Changes — `refactor-metadata-repository-split` (DESIGN)

## Verdict

**No upstream-wave artifacts require modification.**

## Rationale

This refactor is sourced from `docs/research/tech-debt-hotspot-review.md` (a research artifact, not a wave artifact). It does not touch product behavior, jobs, stories, acceptance criteria, system topology, or domain model.

| Upstream wave | Artifact class | Touched? | Notes |
|---|---|---|---|
| DIVERGE | Recommendations / option scoring | No | No new product capability is being proposed; nothing for DIVERGE to evaluate. The hotspot review already chose the direction (per-aggregate split, effort M, confidence high). |
| DISCOVER | Jobs (`docs/product/jobs.yaml`) | No | No JOB is added, removed, or re-scoped. |
| DISCUSS | Stories / Given-When-Then ACs / UX journeys | No | No user-visible behavior change. No new story. The acceptance condition is "the existing test suite stays green and per-aggregate tests are routed through per-aggregate repos" — that is a delivery contract, not a story. |
| DESIGN (prior) — system architecture | `docs/product/architecture/brief.md` `## System Architecture` | No | Topology unchanged. No new container, no new deployment unit. |
| DESIGN (prior) — domain model | `docs/product/architecture/brief.md` `## Domain Model` | No | No domain concepts added; aggregate boundaries explicitly preserved. |
| DESIGN (prior) — application architecture | `docs/product/architecture/brief.md` `## Application Architecture` | **Append-only** | This feature appends a `### refactor-metadata-repository-split (DESIGN — 2026-05-10)` sub-heading on completion of peer review. Does not edit prior sub-headings. Standard DESIGN-wave append pattern. |
| ADR set | `docs/decisions/adr-NNN.md` | **Append** | New ADR-020 (Proposed). Does not supersede or amend any prior ADR. Cross-references ADR-007 (Ibis SQL generation — independent), ADR-019 (`pytest-archon` already operationalized for architectural enforcement) for context only. |

## Read-only fences honored

- `docs/feature/dbt-test-validation/` — Phase 2 owns this directory; not touched.
- `docs/feature/extract-dataset-query-port/` — parallel design dispatch owns this directory; not touched.
- `backend/app/use_cases/project/_dbt/`, `backend/tests/use_cases/project/_dbt/`, `backend/tests/integration/dataset_layer/eject/`, `backend/tests/integration/dataset_layer/harness.py`, `tests/acceptance/dbt-test-validation/` — Phase 2 in-flight surface; read-only.
- `backend/app/models/dataset.py` — owned by the parallel `extract-dataset-query-port` design; not touched. Cross-reference at handoff: the two refactors are orthogonal (this one splits *persistence*; the other extracts *query execution* from the model).

## Concurrency notes

- Phase A of this refactor is safe to land concurrently with Phase 2 dbt-test-validation. Any new `repositories.metadata` call sites that Phase 2 introduces continue to work via the facade. They become Phase B migration candidates without coordination cost.
- The `extract-dataset-query-port` design does not consume `MetadataRepository`; their merge order is independent.
