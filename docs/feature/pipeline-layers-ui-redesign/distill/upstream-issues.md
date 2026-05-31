# DISTILL Upstream Issues — pipeline-layers-ui-redesign

Gaps/contradictions in prior-wave inputs surfaced while writing acceptance tests.
MR-1 findings (UI-1..UI-3) below; MR-5 findings (UI-5..UI-6); MR-6 finding (UI-7) at the end.

## UI-1 — SSR ingress currently blocked (affects the true port-to-port WS)
**Finding:** The no-flash guarantee is most truthfully verified by fetching
server-rendered HTML through the reverse-proxy/web-ssr ingress. Per session notes
(`resume-ssr-build-and-demo`), there is an active **SSR asset-hash 404 blocker**,
so that ingress cannot be relied on to serve cleanly right now.
**Resolution (reconciled with user):** gate the MR-1 walking skeleton in vitest
(`theme.test.tsx` AC1) and author the HTTP-ingress check as a deferred, skipped
adapter-integration suite (`tests/acceptance/pipeline-ui-design-tokens/`). Un-skip
once SSR serves cleanly. No contradiction with path-forward — just a medium choice
forced by current infra state.

## UI-2 — No DISCUSS artifacts for this feature (graceful degradation applied)
**Finding:** `docs/feature/pipeline-layers-ui-redesign/` has `path-forward.md`
(DESIGN-equivalent) + `design-sources.md`, but no `discuss/` (user stories, AC,
journeys). No `docs/product/journeys/*` covers this redesign.
**Resolution:** Per the DISTILL graceful-degradation rule, acceptance criteria
were **derived from the DESIGN artifact** (path-forward §5/§9) and story↔scenario
traceability was skipped. Not blocking. If MR-2+ grows, consider a light
`/nw-discuss` pass to capture the redesign's user stories/journey for traceability.

## UI-3 — `brief.md` lacks a "For Acceptance Designer" driving-ports section
**Finding:** `docs/product/architecture/brief.md` exists but has no explicit
driving-port handoff section.
**Resolution:** Driving ports derived from path-forward §4.3 + repo precedent
(`frontend/app/root.test.tsx`, `tests/acceptance/frontend-coexistence/`). Non-blocking.

## UI-5 — Per-model "Assistant changes" audit is not persisted/served (MR-5, open q5) — deferred (c)
**Finding:** The MR-5 model-detail "Assistant changes" audit panel needs a per-model
provenance source. Inspection of the existing data layer shows there is NONE served
today: `Session` (`frontend/src/core/dataCatalog/sessions.ts`) is project-scoped, and
the chat `Message` / `ToolCall` shapes (`frontend/src/core/chat/types.ts`) carry **no
model id** — the model context set via `setContext("view"|"report"|"dataset", id)` is
runtime-only and is not persisted onto messages. There is no `GET .../audit` or
per-model tool-call-history endpoint.
**Resolution (MR-5, DWD-M5-5):** Ship the audit panel as a presentational shell fed by
the **only per-model provenance available client-side** — the live chat session bound to
the current model (`deriveAssistantChanges(useChatContext().messages)`), with an explicit
empty-state. The **persisted, cross-session per-model audit feed** is a deferred **(c)**:
it requires either (a) the agent to persist per-model tool-call provenance and a backend
read endpoint to query it by model id, or (b) deriving it from full session-history
transcripts (also a new read surface). NOT built in MR-5 — backend touches are reserved
for MR-6 (`display_name`) and MR-7 (archive/retention). Revisit when a per-model audit
backend surface is in scope. Not blocking.

## UI-6 — View/report data preview is not served by the API (MR-5, open q6) — deferred (c)
**Finding:** The MR-5 model-detail design wants a data-preview grid on every layer.
Only `Dataset` carries sample rows (`preview_rows`, `frontend/src/core/dataCatalog/datasets.ts`)
and only `getDataset` accepts `{ includePreview }`. `getView` / `getReport` return
`View` / `Report` shapes (`views.ts` / `reports.ts`) with **no** sample-rows field —
view/report preview is not served today.
**Resolution (MR-5, DWD-M5-6):** Ship the **dataset** layer's preview now (the existing
interactive `TablePanel`, the dataset's real preview grid). The **view/report** layers
render a documented "preview not yet available" empty-state (`data-preview-unavailable`).
Materializing a view/report sample requires the query engine — a deferred **(c)**
(query-engine sampling + a preview read option on `getView`/`getReport`). No backend
sample endpoint invented in MR-5. Not blocking.

## UI-7 — Per-source upload history is not served by the API (MR-6, open q6) — deferred (c)
**Finding:** The MR-6 upload-modal design wants a per-source file list (names + rows +
when uploaded) when reopening a source. Inspection of the uploads router
(`backend/app/routers/uploads.py`) shows it exposes only `POST ""` (file -> dataset,
single step), `POST /{upload_id}/process` (sheet choices), and `GET /formats` — there is
**no list-uploads-by-dataset / per-source upload-history endpoint**, and no `listUploads`
client function exists in `frontend/src/core/dataCatalog/client.ts`. The `UploadEvent`
record exists server-side but is not exposed as a queryable per-dataset history.
**Resolution (MR-6, DWD-M6-6):** Ship the modal's per-source file list as a documented
**empty-state** (`upload-history-empty`) — best-effort from what is available client-side
(none today). A queryable upload-history feed requires a NEW backend read endpoint
(`GET /api/datasets/{id}/uploads` or `GET /api/uploads?dataset_id=`) — a deferred **(c)**.
**NOT built in MR-6**: the only backend touch is the single additive nullable `display_name`
column (archive/retention + any new read endpoints stay reserved for MR-7 / a later MR).
Revisit when an upload-history backend surface is in scope. Not blocking.
