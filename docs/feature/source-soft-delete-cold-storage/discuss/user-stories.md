# User Stories — source-soft-delete-cold-storage

**Feature**: Backend soft-delete for sources (UI reads as "move to Cold Storage")
**Linear**: [DC-199](https://linear.app/tackle-chop-urgent/issue/DC-199) (parent [DC-195](https://linear.app/tackle-chop-urgent/issue/DC-195))
**Feature type**: Backend · **JTBD**: light bridge (see Job Traceability)

## Job Traceability

No dedicated SSOT job covers source lifecycle management yet. This feature is a
**light JTBD bridge**: it serves the operator/curator need to manage which sources
are *visible and active* in a project without destroying data — the recoverable
half of the data-lake lifecycle. Candidate job (proposed, not yet ratified into
`docs/product/jobs.yaml`):

> **JOB-CANDIDATE — Manage catalog visibility without losing data.** When a source
> is no longer relevant to a project's active graph, I want to move it out of the
> active catalog into recoverable Cold Storage, so I can declutter the workspace
> and remap downstream nodes later — while permanent deletion and warehouse
> lifecycle stay a separate, deliberate act.

Relates to the catalogued **J-003 Dataset upload** journey (sources are the ingress
of that flow) and the **DC-195** archive-a-source display behaviour.

---

## Story 1 — Soft-delete a source into Cold Storage

**As** a project curator
**I want** to move a source into Cold Storage through the backend
**So that** it leaves the active catalog but remains recoverable, and the UI can
reflect it as archived across reloads and clients (not just client-local state).

### Elevator Pitch
Before: there is no backend operation to archive a source — the affordance 404s and any "archived" state is client-only, lost on reload.
After: run `PATCH /api/sources/{source_id}` with `{"archived": true}` → sees `200` with the source body now carrying `"archived_at": "<timestamp>"` and `"retention_until": "<timestamp+90d>"`.
Decision enabled: the curator (and the UI, across reloads/clients) can trust the source is in Cold Storage and decide whether to restore or leave it.

### Acceptance Criteria
- **AC1.1** — `PATCH /api/sources/{source_id}` with body `{"archived": true}` on an active source returns `200` and a source body where `archived_at` is set to the request time and `retention_until` is `archived_at + 90 days` (mirroring the dataset cold-storage convention).
- **AC1.2** — The operation is **`org_id`-scoped**: a source belonging to another org returns `404` (not `403`), never leaking existence.
- **AC1.3** — Patching a non-existent `source_id` returns `404`.
- **AC1.4** — Idempotent: patching `{"archived": true}` on an already-archived source returns `200` and does **not** advance `archived_at` / `retention_until` (the original archival timestamp is preserved).
- **AC1.5** — No warehouse / SQL-model side effects and no cascade delete of child datasets occur (out of scope — DC-139). Only the source's own lifecycle fields change.

---

## Story 2 — Archived sources leave active listings but remain retrievable

**As** a project curator
**I want** archived sources excluded from the default source list but still fetchable
**So that** my active catalog stays clean while Cold Storage remains browsable and the source is restorable.

### Elevator Pitch
Before: `GET /api/sources` cannot distinguish active from archived sources — there is no archived state to filter on.
After: run `GET /api/sources?project_id=<id>` → sees only active sources; run `GET /api/sources?project_id=<id>&archived=true` → sees the archived ones with their `archived_at`.
Decision enabled: the curator sees an uncluttered active catalog and can open Cold Storage to decide what to restore.

### Acceptance Criteria
- **AC2.1** — `GET /api/sources` **default-excludes** archived sources (`archived_at IS NULL`), mirroring the dataset list behaviour (`backend/app/repositories/metadata/repository.py:368`).
- **AC2.2** — `GET /api/sources?archived=true` returns **only** archived sources (`archived_at IS NOT NULL`).
- **AC2.3** — `GET /api/sources/{source_id}` returns an archived source (direct fetch by id is not filtered).
- **AC2.4** — The source **read contract** (`Source.serialize()` and the source response) exposes `archived_at` and `retention_until`, so the UI can render Cold Storage state uniformly with datasets.

---

## Story 3 — Restore a source from Cold Storage

**As** a project curator
**I want** to restore an archived source through the same PATCH surface
**So that** the operation is symmetric and I can bring a source back into the active graph for remapping.

### Elevator Pitch
Before: there is no way to un-archive a source; archived state (once it exists) would be terminal.
After: run `PATCH /api/sources/{source_id}` with `{"archived": false}` → sees `200` with `"archived_at": null` and `"retention_until": null`.
Decision enabled: the curator can pull a source back out of Cold Storage and resume using it as active ingress.

### Acceptance Criteria
- **AC3.1** — `PATCH /api/sources/{source_id}` with `{"archived": false}` on an archived source returns `200` and clears both `archived_at` and `retention_until`.
- **AC3.2** — Restoring an already-active source is idempotent: returns `200`, fields remain `null`.
- **AC3.3** — `org_id`-scoped and `404` semantics identical to Story 1 (AC1.2, AC1.3).

---

## Out of Scope (explicit)
- **Permanent / hard deletion** and data-lake / warehouse lifecycle — separate concern, tracked under [DC-139](https://linear.app/tackle-chop-urgent/issue/DC-139). Reserve the `DELETE` verb for that future hard-delete.
- **UI wiring** to call this endpoint instead of the DC-195 client-only archive — follow-up once the endpoint exists.
- **Cascade / disabled-but-visible downstream display** — DC-195 client-side scope.

## Requirements Completeness
All three stories have testable, unambiguous AC tied to observable HTTP output; org-scoping, idempotency, 404, and read-contract exposure are all specified. Completeness estimate: **0.96** (residual: exact PATCH body schema key — `archived` boolean vs a `status` enum — deferred to DESIGN/ADR, see wave-decisions D1).
