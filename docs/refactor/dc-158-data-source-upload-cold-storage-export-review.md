# Design review — Data-Source Upload, Cold Storage & Export flow (DC-158)

Part of the DC-151 UI Design Review, sliced by core user flow. Evaluates the
upload → cold-storage → export surface against four axes: **readability**,
**cohesion (coupling & connascence)**, **state-presentation segregation**, and
**use of common React idioms**.

**Files in scope**

- `ui/app/components/Upload/{Upload.tsx,hooks.ts}`, `ui/app/lib/source-upload-driver.ts`
- `ui/app/components/ColdStorage/{ColdStorageModal.tsx,hooks.ts}`
- `ui/app/components/Export/{ExportDrawer.tsx,hooks.ts}`
- `ui/app/components/AppShell/Overlays.tsx`
- Mutation seam: `ui/app/routes/ui-server/{source-create,upload-request,upload-process,dataset-archive,dataset-restore}.tsx`

## Verdict

Architecturally sound at the saga seam: `source-upload-driver.ts` is a pure,
port-injected coordinator with no browser/React/network dependencies, and it is
well tested. The weaknesses are concentrated in **silent-failure paths** (a
broken narration report could abort the real saga; a drifting backend error
shape silently disables the recovery UX; restore fired with no confirmation) and
in **overlay-hook duplication**. This review's fixes address the silent-failure
paths with regression tests first, then DRY the structural smells.

## Findings by axis

### Cohesion — coupling & connascence

| Sev | Finding | Location |
|---|---|---|
| **Major** | The saga `await`ed each `report()` narration inline, so a rejecting `StateProxy.postEvent` aborted the real create→upload→process work **and** tripped the optimistic-node rollback — a side-channel controlling the main path (connascence of execution). A broken report path froze the canvas. | `source-upload-driver.ts` (report call sites) |
| **Minor** | Three overlay hooks — `useExport`, `useColdStorage`, and the disclosure half of `useUpload` — each re-derived the same `useState(false)` + open + close trio (connascence of algorithm across modules). | `Export/hooks.ts`, `ColdStorage/hooks.ts` |
| **Minor** | The confirm-dialog markup + CSS was duplicated between `ConfirmArchive` and `ModelDetail`'s machine-name confirm (connascence of meaning: two hand-rolled "are you sure?" dialogs). | `Upload.tsx`, `ModelDetail.tsx` |

### State ↔ presentation segregation

| Sev | Finding | Location |
|---|---|---|
| **Major** | `parseSchemaMismatch` digs `error.body.errors[0].detail` with no contract pinned — backend JSON:API shape drift silently returns `null`, disabling the recovery affordance with zero signal. | `Upload/hooks.ts:31` |
| **Minor** | `ExportDrawer` reads `catalog.listDbtFiles()` / `listAddedNodes()` directly at render (not through the reactive path the rest of the app uses) — stale-view risk. | `ExportDrawer.tsx:12-14` |

### Readability & React idioms

| Sev | Finding | Location |
|---|---|---|
| **Major** | Cold-storage **restore** fired `onRestore(id)` directly from a single click — asymmetric with archive (which confirms) and easy to trigger by accident on a lineage-rewiring action. | `ColdStorageModal.tsx` |
| **Note** | The "Download .zip" button calls `onClose` and performs **no real export** — there is no zip/export endpoint in the tree. This is a missing feature, not a refactor. | `ExportDrawer.tsx:92-99` |

## Prioritized backlog & disposition

| # | Item | Kind | Disposition |
|---|---|---|---|
| B1 | Broken narration must not freeze the canvas | bug | **Fixed** — `safeReport` makes narration best-effort; regression tests prove the saga completes (and does **not** roll back) when reports reject, yet still rolls back on a genuine catalog failure. |
| B2 | Pin the 422 schema-mismatch contract | bug (latent) | **Fixed** — contract tests pin the JSON:API envelope so backend drift breaks a test, not prod. |
| B3 | Confirm cold-storage restore | bug/UX | **Fixed** — restore now routes through a confirm dialog; ColdStorage gains its first tests. |
| S2 | De-duplicate the confirm dialog | refactor | **Fixed** — extracted `ConfirmDialog` primitive; `ConfirmArchive` and the new restore confirm both delegate to it. |
| S1 | Unify the twin overlay hooks | refactor | **Fixed** — `useDisclosure` primitive; `useExport`/`useColdStorage` rebuilt on it with their named API preserved. |
| B4 | Wire a real dbt-project zip export | **feature** | **Deferred** — no export endpoint exists; needs a backend surface + an acceptance test (route to `/nw-distill`). |
| S3 | Route Export/ColdStorage reads through the reactive catalog path | refactor | **Deferred** — larger reactive-read change; lower value than the silent-failure fixes. Worth a follow-up if stale views are observed. |

## What shipped

- `lib/source-upload-driver.ts` — `safeReport`; narration is now best-effort.
- `components/primitives.tsx` (+ `.module.css`) — shared `ConfirmDialog`; the
  confirm CSS moved here from `Upload.module.css` (its sole consumer).
- `components/Upload/Upload.tsx` — `ConfirmArchive` delegates to `ConfirmDialog`.
- `components/ColdStorage/ColdStorageModal.tsx` — restore confirmation.
- `lib/useDisclosure.ts` — new primitive; `Export/hooks.ts` + `ColdStorage/hooks.ts`
  rebuilt on it.
- Tests: driver narration-resilience, `parseSchemaMismatch` contract, ColdStorage
  restore confirmation (new), `useDisclosure`.

`ModelDetail`'s machine-name confirm was left untouched (out of scope for this
slice); it is a natural third adopter of `ConfirmDialog` in a later pass.
