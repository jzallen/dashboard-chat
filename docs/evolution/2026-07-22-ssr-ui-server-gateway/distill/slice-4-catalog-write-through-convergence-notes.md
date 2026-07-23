# DISTILL notes — slice-4 catalog write-through convergence (DC-119)

> Story: **DC-119** — Converge the bespoke client `DataCatalog` write-through to RRv7
> actions + SSE-triggered revalidation. Realises **ADR-034 §"Amendment (2026-06-25)"**
> (idiomatic RRv7 for catalog data; SSE is a revalidation trigger — resolves Open Question 1).
> Roadmap SSOT: [`slice-4-catalog-write-through-convergence-roadmap.json`](./slice-4-catalog-write-through-convergence-roadmap.json).

## Why this is a repoint, not a rewrite

The `DataCatalog` `dataSource` indirection is the strangler-fig harness (DISCUSS §Constraints).
DC-12 (S5) already repointed rename / `model_name` / audit-toggle onto `/ui-server/*` RRv7
`action`s via `useFetcher` (`ui/app/components/ModelDetail/ModelDetail.tsx`). Those bespoke
`catalog.x() → metadataApiSource.x()` paths are therefore **dead code**. This slice deletes
the dead machinery, converges the remaining write surfaces (archive/restore) the same way,
and turns SSE into a pure trigger — dropping the catalog's last client-side reflection duty.

## Acceptance criteria (port-to-port, Given-When-Then)

Business language in scenario names; driving port named for each. These drive the deliver
session's tests (target gate: `cd ui && npx vitest run`). Tags in brackets.

### Task A — S5 dead-code removal
- **AC-A1** `[@real-io]` *Rename still lands through the framework.* **Given** an open model,
  **when** the user renames it via the model detail rename form (driving port: `ModelDetail`
  `useFetcher` → `PATCH /ui-server/datasets/:id`), **then** it persists and the loader
  re-derives the new name — with the bespoke `catalog.renameSource`/`renameModel` paths
  removed.
- **AC-A2** `[@real-io]` *Audit toggle still lands through the framework.* **Given** a
  transform audit entry, **when** the user toggles it (driving port: `useFetcher` →
  `PATCH /ui-server/projects/:pid/audit/:auditEntryId`), **then** the lineage/preview
  re-derives from server truth after the 2xx — with `catalog.toggleAudit` /
  `metadataApiSource.toggleAuditEntry` / `useCatalog.toggleAudit` removed.
- **AC-A3** `[@static]` *No dead references remain.* **When** the tree is grepped,
  **then** there are zero references to `catalog.renameSource` (model), `catalog.setModelName`,
  `catalog.toggleAudit`, and the deleted `metadataApiSource` ports / `source.ts` decls.

### Task B — Archive/restore convergence
- **AC-B1** `[@real-io]` *Archive lands through an action.* **Given** an active dataset,
  **when** the user archives it (driving port: `Upload/hooks.ts` `useFetcher` →
  `POST /ui-server/datasets/:id/archive`), **then** after the 2xx the loader re-derives and
  the dataset appears in Cold Storage — and the **just-archived node stays visible in the
  drawer** (former `preserveCold`, now loader-derived).
- **AC-B2** `[@real-io]` *Restore lands through an action.* **Given** an archived dataset,
  **when** the user restores it (driving port: `ColdStorage/hooks.ts` `useFetcher` →
  `POST /ui-server/datasets/:id/restore`), **then** the loader re-derives it back into
  active lineage — with `catalog.archiveSource`/`restoreSource` +
  `metadataApiSource.archiveModel`/`restoreModel` removed.
- **AC-B3** `[@real-io][error-path]` *A failed archive/restore strands nothing.* **Given**
  the upstream returns non-2xx, **when** the user archives/restores, **then** an error
  surfaces, **no** phantom client state is committed, and there is **no** `/login` redirect
  (preserve `ui-server-client.ts` byte-intact pass-through; RRv7 revalidates on 2xx only).

### Task C — SSE-as-trigger seam
- **AC-C1** `[@real-io]` *Assistant transform reflects via the framework.* **Given** an SSE
  `transform_applied` frame on the chat stream (driving port: `chat-stream.ts`
  `CATALOG_MUTATING_EVENTS`), **when** it arrives, **then** `revalidator.revalidate()` (or a
  scoped `fetcher.load()`) fires and the loader re-derives lineage/preview — with **no**
  client-side graph state and **no** delta-merge.
- **AC-C2** `[@real-io]` *Every catalog-mutating event triggers revalidation.* **Then** each
  of `transform_applied`, `column_renamed`, `row_added`, `row_deleted`, `transform_undone`,
  `transform_re_enabled` triggers the framework revalidation — and `catalog.revalidateScope`
  / `revalidateScoped` / captured-pid fences are removed.
- **AC-C3** `[@real-io][error-path]` *Fast project switch does not bleed state.* **Given** a
  revalidation in flight, **when** the user switches project (loader re-runs keyed on
  `:projectId`), **then** derivation re-scopes to the new project with no stale cross-project
  state (the framework replacement for the deleted captured-pid fence). Test the route hook
  through the router (memory: prove behaviour via `createMemoryRouter` navigation).

### Task D — Decision #1 reconciliation
- **AC-D1** `[@docs]` *SSOT points at the amendment.* **Then** `discuss/idea-capture.md`,
  `discuss/wave-decisions.md`, and `discuss/open-questions.md §Non-questions` annotate the
  "reactive reads stay client-side" lean as superseded by ADR-034 §Amendment (2026-06-25),
  and the Linear project description bullet #1 references it.
- **AC-D2** `[@docs]` *Back-reference intact.* **Then** ADR-034 still records that the DISCUSS
  lean is superseded and should be reconciled here (already present, line ~53) — verified.

## Test strategy (inherits DWD-6)

Same as slice-1: `ui/` vitest (real component + real `/ui-server` action/loader in one
process; downstream `/api` port stubbed via `fetch`). Port-to-port makes TBU defects
structurally impossible. `tools/test/test.sh --auto` maps `ui/` to `--backend`, so
`cd ui && npx vitest run` green is MANDATORY on the crafter before submit (gate caveat carried
from slice-1).

## Deferred / escalated
- **OI-1** source-node rename (local-only) — see roadmap `open_items`.
- **OI-2** trigger granularity (whole-loader vs scoped) — measured decision in Task C.
- **OI-3** catalog store surface (`subscribe`/`getSnapshot`) — re-evaluate after Task C.
