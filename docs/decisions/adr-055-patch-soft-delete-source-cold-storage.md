# ADR-055: PATCH is Soft-Delete (Cold Storage), DELETE is Hard-Delete — Source Cold-Storage Contract

**Status:** Accepted (user-ratified 2026-07-21)
**Date:** 2026-07-21
**Originating wave:** DESIGN — `source-soft-delete-cold-storage` (application scope, propose mode)
**Author:** Morgan (nw-solution-architect); grounded in the DISCUSS wave (`docs/feature/source-soft-delete-cold-storage/discuss/`), the live source tree, and the dataset MR-7 cold-storage reference
**Scope:** Application architecture — the HTTP verb convention for lifecycle state, and the concrete contract that gives a **Source** the same recoverable Cold Storage a Dataset already has (`archived_at`/`retention_until`), fixing the DC-195 404.
**Honors:** ADR-005 (frozen dataclasses for domain models — `Source`), ADR-006 (Result monad — the use-case decorator stack), the MR-7 dataset cold-storage design (`migrations/versions/015`, `app/use_cases/dataset/archive_dataset.py`), and the deliberate 403-not-404 cross-tenant authz posture at `app/routers/deps.py:88`.
**Linear:** DC-199 (parent DC-195); permanent deletion deferred to DC-139.

---

## Context

Archiving a **source** node into Cold Storage 404s (DC-195): the UI POSTs a source id to `POST /api/datasets/{id}/archive`, but a source id is not a dataset id and there is **no** source-archive endpoint. Investigation confirmed the backend has **no `deleted_at` field anywhere** and it is in no read contract; the only recoverable-Cold-Storage precedent is the dataset MR-7 model — two nullable timestamps `archived_at` + `retention_until` (= archived_at + 90d), exposed in the dataset read contract, with list endpoints default-excluding archived rows (`app/repositories/metadata/repository.py:350-368`).

Two things need deciding: (1) **which HTTP verb** expresses "move to Cold Storage" — the existing `POST /resource/{id}/archive` ad-hoc verb, a semantic `DELETE`, or a state `PATCH`; and (2) **how a Source persists and exposes** that state. The choice is cross-cutting: datasets and future resources should converge on one convention rather than accreting per-resource archive verbs.

## Decision

### (a) `PATCH` = soft-delete (recoverable Cold Storage); `DELETE` = hard-delete (reserved)

Soft-delete is a **state mutation on a lifecycle field**, not a removal. It is expressed as:

```
PATCH /api/sources/{source_id}   body: {"archived": true|false}
```

- `{"archived": true}` → set `archived_at = now(UTC)`, `retention_until = archived_at + 90d`.
- `{"archived": false}` → clear both to `null` (restore). **Restore is the symmetric PATCH — there is no `/restore` endpoint.**

`DELETE /api/sources/{source_id}` is **deliberately left unimplemented and reserved** for future *permanent / hard* deletion (data-lake lifecycle, DC-139). This makes "recoverable visibility" and "destroy data" **distinct HTTP acts** with distinct verbs, so the destructive one can never be reached by the affordance a curator uses to declutter their catalog.

This **supersedes the `POST /resource/{id}/archive` + `/restore` pattern** (the dataset MR-7 shape, `app/routers/datasets.py:77-94`) as the convention for *new* resources. Datasets are not migrated by this ADR (see Consequences); they remain on the legacy verb until a separate migration chooses to converge.

Rejected alternatives:
- **`DELETE` as soft-delete** (the DC-199 seed's first instinct): conflates recoverable and permanent removal on one verb, forcing a body or query flag to distinguish them, and leaves restore verb-asymmetric (`DELETE` to archive, `POST`/`PATCH` to restore). Reserving `DELETE` for the irreversible act is the safer semantics.
- **`POST /archive` + `/restore`** (status quo): two custom sub-resource verbs per lifecycle, non-idempotent by HTTP semantics, and not a state a client can `PATCH` alongside other fields. The dataset instance is grandfathered, not extended.

### (b) A Source reuses the dataset Cold-Storage persistence — `archived_at` + `retention_until`, no `deleted_at`

Because the product treats **soft-delete ≡ move to Cold Storage**, a Source carries the *same two columns* a Dataset does, not a new `deleted_at` vocabulary:

- Migration adds nullable `archived_at` + `retention_until` to `sources` (mirrors `migrations/versions/015`; portable plain `add_column`, no index — `sources` is org-scoped transitively via `project_id`, already indexed).
- The **read contract** gains both fields: `source_to_dict` (`_mappers.py:100`), `Source.serialize()` / `Source.from_record()` (`app/models/source.py`).
- `GET /api/sources` **default-excludes** archived (`archived_at IS NULL`); `?archived=true` returns **only** archived — the same filter shape as `list_datasets` (`repository.py:350-368`).

This keeps one Cold-Storage vocabulary so the UI reads "in Cold Storage" uniformly across node types (source and dataset), and `retention_until` drives the same client-side days-left countdown.

### (c) One use case, boolean-driven, idempotency-preserving

The single PATCH maps to **one** use case `archive_source(source_id, *, archived: bool)` (not a separate archive/restore pair — the boolean body already carries direction), on the standard decorator stack (`@handle_returns` / `@with_repositories`), writing through a new generic `MetadataRepository.update_source(source_id, **kwargs)` setter that mirrors `update_dataset`.

Crucially, `archive_source` **preserves the original `archived_at` on re-archive** — it sets the timestamps only when transitioning from active (`archived_at IS NULL`), so a repeated `{"archived": true}` is a true no-op and does **not** advance the retention clock. This is a deliberate **improvement over `archive_dataset`**, which overwrites `archived_at` on every call. Restore (`{"archived": false}`) is unconditionally idempotent (clears to null).

## Consequences

**Positive**
- DC-195's 404 is fixed at the contract level: a source has a real, org-scoped Cold-Storage endpoint whose state survives reload and syncs across clients (no more client-only archive).
- The UI reads Cold Storage identically for sources and datasets (same two fields, same default-exclude semantics).
- `DELETE` stays free for DC-139's permanent deletion without a contract change.

**Negative / debt**
- **This is the 2nd instance of the Cold-Storage pattern** (dataset was 1st). `RETENTION_WINDOW = timedelta(days=90)` and the archive/restore/filter logic are now duplicated across the dataset and source paths. This ADR **does not** extract a shared soft-delete mixin / shared constant yet — but it flags it as a now-ready refactor candidate (rule of three is one away). A future `/nw-refactor` should extract a `ColdStorable` mixin + one `RETENTION_WINDOW`.
- **Convention divergence during transition:** datasets keep `POST /archive`; sources use `PATCH`. This is intentional (no big-bang migration) but means two archive shapes coexist until a convergence migration is scheduled.

## Amendment to the DISCUSS acceptance criteria (403, not 404, for cross-org)

DISCUSS AC1.2 specified cross-org archival returns **404** "never leaking existence." DESIGN reconciles this to the **established platform posture**: `authorize_project_access` deliberately raises `AuthorizationError` → **403** for cross-tenant access "rather than collapsing to not-found" (`app/routers/deps.py:88`), and every existing source and dataset endpoint follows it. The PATCH route reuses the existing `_authorize_source` helper (`app/routers/sources.py:22`), so: **missing source id → 404** (`SourceNotFound`), **cross-org → 403** (`AuthorizationError`). Overriding the AC keeps sources consistent with the rest of the API surface; see `docs/feature/source-soft-delete-cold-storage/design/upstream-changes.md`.
