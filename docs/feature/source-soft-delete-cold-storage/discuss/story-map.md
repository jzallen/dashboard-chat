# Story Map — source-soft-delete-cold-storage

## Backbone (curator manages source lifecycle)

```
Ingest a source ──▶ Use it in the graph ──▶ Move it to Cold Storage ──▶ Browse Cold Storage ──▶ Restore it
   (exists today)      (exists today)          [Slice 1]                  [Slice 2]              [Slice 3]
```

Only the last three steps are new. Ingest/use already ship.

## Walking skeleton

Skipped — brownfield backend. The `sources` router, use-case decorator stack, and
metadata repository already exist; this feature adds one lifecycle field + one PATCH
verb to established machinery. The dataset cold-storage feature is the working
reference implementation (`archived_at`/`retention_until`, list default-exclude).

## Elephant-carpaccio slices

### Slice 1 — Archive a source (PATCH → Cold Storage)
- **Goal**: `PATCH /api/sources/{id}` `{"archived": true}` sets `archived_at` + `retention_until` and returns them.
- **IN**: migration adding `archived_at` + `retention_until` to `sources`; `archive_source` use case (`org_id`-scoped, decorator stack); PATCH route; read-contract exposure of the two fields; regression test.
- **OUT**: list filtering, restore, UI wiring.
- **Learning hypothesis**: disproves "sources can reuse the dataset cold-storage convention 1:1" if the source read/serialize path can't carry the fields cleanly.
- **Ship estimate**: ≤1 day. **Data**: a real ingested source (production-shaped, not synthetic row).
- **Dogfood**: curl the endpoint against a locally-ingested source, observe `archived_at` in the response same day.

### Slice 2 — Cold-Storage listing (default-exclude + `?archived=true`)
- **Goal**: `GET /api/sources` hides archived; `?archived=true` shows only archived.
- **IN**: repository filter mirroring `repository.py:350-368`; `archived` query param on the list route; tests for both branches.
- **OUT**: restore, UI.
- **Learning hypothesis**: disproves "the active catalog stays clean automatically" if any caller depends on archived sources appearing in the default list.
- **Ship estimate**: ≤0.5 day. **Depends on**: Slice 1.

### Slice 3 — Restore (symmetric PATCH `{"archived": false}`)
- **Goal**: clear `archived_at` + `retention_until`, source returns to active listings.
- **IN**: restore branch in the use case; idempotency tests; round-trip test (archive → list-excluded → restore → list-included).
- **OUT**: UI.
- **Learning hypothesis**: disproves "PATCH gives clean symmetry" if restore needs different auth/validation than archive.
- **Ship estimate**: ≤0.5 day. **Depends on**: Slice 1 (+ Slice 2 for the round-trip assertion).

## Slice taste tests
- No slice ships 4+ new components ✓ (each is field/route/filter on existing machinery).
- No new abstraction gates the slices ✓ (reuses the dataset cold-storage pattern; if anything, this is the second instance that would *justify* extracting a shared soft-delete mixin later — noted for DESIGN, not required now).
- Slice 1 disproves the core pre-commitment (reuse-dataset-convention) ✓.
- Production-shaped data required in Slice 1 AC ✓.
- Slices 1/2/3 are distinct operations, not scale duplicates ✓.

## Prioritization
Order = dependency + learning leverage: **Slice 1 → 2 → 3**. Slice 1 carries the
highest uncertainty (does the source read path carry the fields cleanly + does the
PATCH-vs-dataset-/archive divergence hold up), so it runs first where failure is cheapest.
