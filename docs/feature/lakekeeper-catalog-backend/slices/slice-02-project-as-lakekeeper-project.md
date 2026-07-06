# Slice 02 — dc project → LakeKeeper Project + Warehouse, behind the port

**Story:** US-2 · **Sub-job:** SJ-2 · **Plane:** Management + Catalog/storage · **Effort:** ~1 day

## Goal (one sentence)
Represent a dc project as a LakeKeeper Project with a default Warehouse at the project's S3 prefix, created through the **existing** project repository port (ADR-020) — so the application layer is untouched and the project's storage location becomes a first-class catalog object rather than a hand-rolled path.

## IN scope
- A `LakeKeeperProjectRepository` adapter implementing the same port the project use cases already depend on (`RepositoryContainer.projects`); `@with_repositories` injects it (the use case still calls `repositories.projects.create(...)`).
- Creating a dc project produces a LakeKeeper Project (via the Management API) with a **default Warehouse** at the project's S3 prefix (`config.py:27-33`).
- Confirm **zero change** to routing, controllers, and use-case logic (the adapter is the only new seam).

## OUT scope
- The **authority model** (dual-write mirror vs LakeKeeper-as-SoT) — **surfaced as a DESIGN open fork** (`../discover/buy-vs-build.md` Q2 #1/#2). This slice may use the low-risk shape (local row stays, also create a LakeKeeper Project) to get end-to-end, but does **not** ratify SoT.
- Referential-integrity rework of `datasets.project_id` / `views.project_id` FKs (DESIGN).
- Extra Warehouses / Namespaces (default only).

## Learning hypothesis
**Disproves** that a dc project can be represented as a LakeKeeper Project with a default Warehouse **behind the existing project repository port** with **zero** change to routing/controllers/use-cases. If the adapter forces a controller or use-case change, the "LakeKeeper as a repository" seam (`../discover/buy-vs-build.md` Q2 "Delegation shape") is wrong and the integration is more invasive than claimed.
**Confirms** (if it succeeds) that the hexagonal seam holds and the authority-model decision is genuinely localized to one adapter.

## Acceptance criteria
- AC1: Creating a dc project results in a LakeKeeper Project that maps 1:1 to the dc project, with a default Warehouse at the project's S3 prefix (production project shape, real S3 prefix).
- AC2: The project use case still calls `repositories.projects.create(...)`; the adapter behind the port is the only new code path — **routing, controllers, and use-case logic are unchanged** (assert by diff scope + the existing use-case tests still passing unmodified).
- AC3: A failed/timed-out LakeKeeper call surfaces a clear failure and leaves **no silent orphan** half-state; the exact compensation is deferred to the DESIGN authority-model decision.

## Dependencies
BlockedBy Slice 01 (needs an authenticated catalog). Produces `${lakekeeper_project_id}` + `${warehouse_prefix}` that Slice 03 writes into.

## Dogfood moment
Create a real dc project through the normal port and see a LakeKeeper Project + Warehouse appear at the project's actual S3 prefix, with no controller change in the diff.

## Reference class
Adding a repository adapter behind an existing ADR-020 port — the same pattern the codebase already uses to hide Parquet-on-S3 (`backend/app/repositories/lake/`). Idiomatic extension, not a new pattern.
