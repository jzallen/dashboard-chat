# DISCUSS Decisions — source-soft-delete-cold-storage

## Key Decisions

- **[D1] Verb = PATCH (not DELETE) for soft-delete.** Per Mayor preference. Soft-delete is a
  state mutation on a lifecycle field, not a removal; PATCH expresses "update this field" and
  yields a symmetric restore (PATCH back). The `DELETE` verb is deliberately **reserved for
  future hard/permanent deletion** (DC-139), keeping "recoverable visibility" and "destroy
  data" as distinct HTTP acts. *Open sub-decision for DESIGN/ADR: PATCH body shape —
  recommended `{"archived": boolean}`; alternative a `status` enum.* (see: user-stories.md)

- **[D2] Reuse the dataset cold-storage convention (`archived_at` + `retention_until`),
  not a new `deleted_at`.** Confirmed by investigation: **no `deleted_at` exists anywhere in
  the backend**, and it is **not** in any read contract. Datasets already model recoverable
  Cold Storage as `archived_at` (+ `retention_until` = archived_at + 90d), expose both in
  their read contract, and default-exclude archived rows in list endpoints
  (`repository.py:350-368`). Sources should mirror this so the UI reads "in Cold Storage"
  uniformly across node types. Since the product treats *soft-delete ≡ move to Cold Storage*,
  a separate `deleted_at` vocabulary would fork the model for no gain. *DESIGN to ratify via
  ADR; also flag that this becomes the 2nd instance of the pattern → candidate for a shared
  soft-delete mixin.* (see: user-stories.md AC2.4)

- **[D3] Soft-delete state joins the source read contract; list default-excludes archived.**
  `Source.serialize()` + the source response gain `archived_at`/`retention_until`; `GET
  /api/sources` hides archived by default with `?archived=true` to fetch Cold Storage —
  mirroring datasets. (see: user-stories.md Story 2)

- **[D4] Restore is the symmetric PATCH `{"archived": false}`** clearing both fields —
  no separate `/restore` endpoint. (see: user-stories.md Story 3)

## Requirements Summary
- Primary need: curator moves a source into recoverable Cold Storage (and back) via the
  backend, so archived state survives reload and syncs across clients — replacing the DC-195
  client-only archive and fixing the 404.
- Walking skeleton scope: N/A (brownfield; extends existing source machinery).
- Feature type: backend.

## Constraints Established
- `org_id`-scoped; `404` (never `403`) for cross-org / missing ids.
- Idempotent archive & restore; archival timestamp not advanced on re-archive.
- No warehouse/SQL-model side effects; no cascade to child datasets (DC-139 owns that).

## Upstream Changes
- None. No DISCOVER/DIVERGE artifacts for this feature; SSOT `jobs.yaml` unchanged (JOB-CANDIDATE
  proposed but not ratified — recommend ratifying if source-lifecycle grows beyond this slice).

## Handoff
→ DESIGN (nw-solution-architect): ratify D1 PATCH body + D2 field convention as a short ADR
(the "DELETE-as-hard-delete vs PATCH-as-soft-delete" API convention), then → DISTILL for the
regression/acceptance tests → DELIVER (Outside-In TDD). Backend-only; follow `backend-use-case`
+ `alembic-migration` skills.
