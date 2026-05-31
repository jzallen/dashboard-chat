# Path Forward — Pipeline Layers UI Redesign

**Wave:** DESIGN (brownfield) · **Author:** Morgan (Solution Architect) · **Date:** 2026-05-30
**Inputs:** the design handoff bundles (transcript + throwaway HTML/CSS/JS prototype) — **pulled on demand, not committed; see `design-sources.md` for links + fetch recipe** — plus current `frontend/` (RRv7 framework mode), `frontend/src/core/dataCatalog/*.ts`, ADRs 033/034/044–047.

---

## 0. Executive framing

The redesign is **overwhelmingly a frontend restructure**. The designer deliberately mirrored the prototype's `data.js` on the real `frontend/src/core/dataCatalog/*.ts` types, and the three-layer domain (Datasets/staging `stg_` → Views/intermediate `int_` → Reports/marts `fct_`/`dim_`) already exists end-to-end: types, REST client (`createDataCatalog`), routes, and dbt export (`exportDbtProject`). Upload also already exists server-side (`POST /api/uploads`, `processUploadWithChoices`, `getFormats`).

Per the user's constraint, the **five backend services stay largely unchanged**. Only a thin set of *new persisted concepts* (source display name, cold-storage/retention state, theme/dark-mode preference) need a home, and most of those can live frontend-local or in `ui-state` rather than the backend API. Net: the backend API needs **one small additive surface** (archive/retention on a "source" concept) and **nothing else** is structurally required.

The single biggest architectural decision is **where the theme token system lives**, because the current frontend has **no global design-token layer** — every component is a CSS Module with hardcoded values, and `frontend/index.css` is just the three `@tailwind` directives. The prototype's entire "swap a root class to reskin everything" premise depends on a token layer that does not yet exist. This is the load-bearing prerequisite for the whole aesthetic story (Studio/Neon/Macintosh/Neobrutalist/Comic + Solarized dark mode) and must be sequenced first.

---

## 1. Current-state map (what exists today)

| Concern | Current implementation | File(s) |
|---|---|---|
| Shell / layout | `AppShell` = `SideNav` + `<main><Outlet/></main>`; `RequireAuth`/`RequireOrg` guards; `StreamProvider`+`ChatProvider` wrap | `frontend/src/ui/components/AppShell/index.tsx` |
| Nav | Left sidebar: New Session, Projects, Query Engines, All Chats, Recent (from `useSessions`) | `frontend/src/ui/components/SideNav/UnifiedNav.tsx` |
| Routes | RRv7 framework mode; landing route `/` = `ChatView`; `projects`, `projects/:id`, `view/:id`, `report/:id`, `query-engines`, `sessions`, `chat/:channelId` | `frontend/app/routes.ts` |
| Composition root | `root.tsx` owns `<html>`, request-scoped `QueryClient`, `AuthProvider`, `createStateProxy` seed | `frontend/app/root.tsx` |
| Data model | `Dataset`, `View` (source_refs/joins/grain/columns/materialization), `Report` (report_type/columns_metadata) — matches prototype `data.js` | `frontend/src/core/dataCatalog/{datasets,views,reports}.ts` |
| Data access | `createDataCatalog(fetch)` REST client incl. `exportDbtProject`, `uploadFile`, `processUploadWithChoices`, `getFormats`, `listSessions`, `getOrgInfo` | `frontend/src/core/dataCatalog/client.ts` |
| Chat | `ChatView` + `chat/` components, SSE via `StreamProvider`; `ui-state` XState actors carry flow state (ADR-044–046); deep-links via `open_deep_link` events | `frontend/src/ui/components/ChatView/`, `frontend/app/lib/ui-state-client.ts` |
| Upload (backend) | `POST /api/uploads` (file → dataset in one step; `awaiting_input` for sheet choices), `POST /api/uploads/{id}/process` | `backend/app/routers/uploads.py` |
| Org | `OrgView` (`getOrgInfo` → `{id,name}`); project grid | `frontend/src/ui/components/OrgView/` |
| Styling | Tailwind (`@tailwind` directives) + **per-component CSS Modules**. No global design-token layer, no dark-mode mechanism, no root theme class | `frontend/index.css`, `**/*.module.css` |
| Lineage view | **Does not exist** — there is no pipeline/DAG/lanes/audit view at all | — |

There is **no lineage graph, no breadcrumb shell, no FAB assistant, no cold-storage, no theme system** today. The redesign introduces all of these.

---

## 2. Gap analysis — the 8 feature areas

Classification key: **(a)** pure-frontend · **(b)** frontend + data-model/backend change · **(c)** needs new backend capability.

### 2.1 Pipeline lineage view as landing page (Flow / Lanes / Audit) — **(a) pure-frontend**
- **Today:** landing is `ChatView` at `/`. No lineage anywhere.
- **Design:** a Pipeline view (3 in-canvas-switchable styles) is the landing surface; orphan detection (disabled in Flow, "Orphaned" badge in Lanes).
- **Delta:** new `Pipeline`/lineage feature module + a new landing route. The **graph is derivable client-side** from existing data: nodes = sources + datasets + views + reports; edges = `view.source_refs` and `report.source_refs` (plus source→dataset). **Orphan = a non-source node whose inputs are all archived/absent** — pure derivation, no persistence. No new backend data is required for the view itself. The only new *inputs* it consumes (archived sources, display names) come from areas 6–7.

### 2.2 Breadcrumb nav replacing sidebar — **(a) pure-frontend**
- **Today:** left `SideNav`/`UnifiedNav`.
- **Design:** transparent floating breadcrumb `OrgIcon / Project ▾ / Model ▾`; project = searchable picker (`listProjects`), model = searchable picker grouped Datasets/Views/Reports (`listDatasets`/`listViews`/`listReports`), org icon = toggle → × → Org Settings sheet.
- **Delta:** replace `SideNav` with a `Breadcrumb` component in `AppShell`. All picker data already has client functions. Recent/New-Session move into the assistant overlay (area 4). No backend change.

### 2.3 Org Settings page (General / Pipeline defaults / Members / Appearance) — **(b) mostly frontend; one optional backend gap**
- **Today:** `OrgView` exists but `getOrgInfo` returns only `{id, name}`. No members, no plan/seats, no pipeline defaults endpoint.
- **Design:** General (name, workspace URL, region, plan), Pipeline defaults (engine, materialization, dbt prefix), Members (roster + seats), Appearance (dark-mode toggle).
- **Delta:** The **Appearance / dark-mode toggle is pure-frontend** (area 8). General/Members/Pipeline-defaults as **display-only** can ship pure-frontend with mock/derived content (the transcript explicitly treats them as mock — "happy to wire any of it to real settings controls"). Making them *functional* (editable members, real pipeline defaults persisted org-wide) is **(c)** and is explicitly **out of scope / deferred** — surface as an open question. Recommendation: ship the page as the dark-mode host + display-only panels now; defer the functional org-admin surface.

### 2.4 Assistant FAB → glass overlay (light) / docked TUI terminal (dark) — **(a) pure-frontend**
- **Today:** chat is the landing route; sessions/recents in sidebar; `StreamProvider`/`ChatProvider` already wire SSE + `ui-state`.
- **Design:** corner FAB → bottom-anchored glass overlay holding New Session (+), history (clock), recent-chat chips, streaming tool-call audit cards. Clock opens "All Chats" searchable list in the main window (overlay fades). In dark mode the overlay is instead a docked TUI terminal rendering the same feed.
- **Delta:** This is a **presentation reshell of existing chat plumbing**. The FAB/overlay/terminal are new components that consume the *same* `ChatProvider`/`StreamProvider`/`ui-state` machinery. Recents come from `listSessions` (already used by `UnifiedNav`). "All Chats" maps to the existing `/sessions` route/`SessionList`. The terminal-vs-glass branch is a render switch off the dark-mode flag. **No backend or ui-state change** — the wire surface ("ui-state API in flux" per project memory) is untouched; we only re-skin the consumer.

### 2.5 Model detail (deps strip, Assistant-changes audit, data preview, columns/measures, compiled SQL) — **(a) pure-frontend**
- **Today:** `view-detail`/`report-detail`/`DatasetView` exist; reports route exists. Audit-per-model and a prominent "Assistant changes" panel are partial/absent; data preview exists in `Dataset.preview_rows` but the design wants it on every layer.
- **Design:** dependency strip, prominent Assistant-changes audit panel, data preview grid, columns/measures table, compiled SQL with `ref()` wiring.
- **Delta:** Mostly recomposition of existing detail views. **Preview rows already exist** on `Dataset` (`preview_rows`); views/reports need preview too — the prototype mocked these. **Decision point:** is per-layer preview data already served by the API for views/reports? If not, computing it is **(c)** (requires the query engine to materialize a sample). Recommendation: confirm whether `getView`/`getReport` already return sample rows; if not, treat view/report preview as a **deferred (c)** and ship deps-strip + audit + columns + SQL first (all (a)). The "Assistant changes" audit is **derivable from existing chat/tool-call history** — confirm the agent persists per-model tool-call provenance; if it only lives in transcripts, deriving a per-model audit may need a small **(c)** read endpoint (open question 5).

### 2.6 Upload flow (modal, dial-up progress, schema view, editable display name, "create source") — **(b)**
- **Today:** backend `POST /api/uploads` does file→dataset in one step (+ `awaiting_input`/`process` for sheet choices). `UploadWidget` exists in chat. No standalone upload modal, no "source" node concept distinct from a dataset, no editable display name separate from filename.
- **Design:** toolbar upload button → modal (browse/drop) → 3-leg progress animation → parsed schema → editable **display name** (filenames fixed) → "upload another to same schema" / "create source" (drops a node into lineage). Clicking a source node reopens the modal.
- **Delta:**
  - Modal + dial-up animation + schema view = **pure-frontend (a)**.
  - The **3-leg progress is cosmetic** over the existing single-step upload call — no streaming-upload backend needed; animate around the in-flight `uploadFile` promise.
  - **"Source" as a first-class node with multiple files + a display name distinct from filename** is the genuinely new concept. Today a CSV maps 1:1 to a `Dataset`. The design wants raw-source nodes that (a) hold one-or-more files, (b) carry an editable display name, (c) can exist *before* a `stg_` dataset is created. **Recommendation:** model "source" as a thin extension of the existing dataset/upload concept rather than a new aggregate — see §3.1. This is **(b)**: the display-name field needs a persisted home; the rest reuses existing upload.

### 2.7 Cold storage / "fridge" (archive source, retention, restore) — **(b) frontend + minimal backend**
- **Today:** nothing. Datasets are not archivable; no retention metadata.
- **Design:** archive a source (confirm dialog) → leaves lineage → cold-storage list with retired-at / retention-end / days-left / restore. Snowflake on buttons, fridge on toolbar; playful random-food empty state.
- **Delta:** Archive is **state that must survive reload and affect lineage derivation** (orphan detection in 2.1 depends on it). The transcript itself flags "archived state lives in session memory… if you want it to persist, I can wire that." Persistence is the user's stated intent ("the data model may need updating… cold-storage/retention state"). **Recommendation:** add `archived_at` + `retention_until` to the source/dataset record via the backend API (smallest viable: two nullable columns + filter on list + restore endpoint). Retention math (days-left) is **frontend-derived** from `retention_until`. The fridge/snowflake/empty-state are pure-frontend. Net: **(b)** with a small additive backend change (§3.1).

### 2.8 Theme token system (5 aesthetics + Solarized dark mode) — **(b) frontend + tiny persistence**
- **Today:** **no token layer, no dark mode.** CSS Modules with hardcoded values; `index.css` = `@tailwind` only.
- **Design:** aesthetic = a CSS-token skin class on root (Studio/Neon/Macintosh/Neobrutalist/Comic), zero behavior change; Solarized dark mode toggle stacks on any aesthetic; final landing = Neobrutalist default + Comic-styled assistant.
- **Delta:** Two-part:
  1. **Establish a global design-token layer** (CSS custom properties) and refactor the most-visible components to consume tokens instead of hardcoded values. This is the prerequisite and the biggest single chunk of frontend work. The aesthetics are then `data-theme="…"` / `.theme-neobrutalist` root classes that redefine the tokens. **(a)** structurally, but large.
  2. **Persist the chosen aesthetic + dark-mode flag.** Lightest home = **frontend-local (`localStorage`) hydrated on `root.tsx`**, with an SSR-safe default (Neobrutalist + light) to avoid a flash. Optionally promote to per-user preference later. **(b)** only in the trivial sense of a persisted preference; recommend **frontend-local first**, backend-persisted user preference deferred (open question 3).

### Gap summary table

| # | Feature | Class | New backend? | Notes |
|---|---|---|---|---|
| 1 | Pipeline lineage (Flow/Lanes/Audit) | **(a)** | No | Graph derived from `source_refs` |
| 2 | Breadcrumb nav replaces sidebar | **(a)** | No | Pickers use existing list APIs |
| 3 | Org Settings page | **(b)** | Optional/deferred | Display-only now; functional admin = deferred (c) |
| 4 | FAB/overlay + dark TUI assistant | **(a)** | No | Reshell of existing chat plumbing |
| 5 | Model detail (audit/preview/SQL) | **(a)** | Maybe (c) | View/report preview + per-model audit may need read endpoints |
| 6 | Upload flow + source display name | **(b)** | Small | Display name needs a persisted home |
| 7 | Cold storage / retention | **(b)** | Small | `archived_at`+`retention_until` + restore |
| 8 | Theme tokens + dark mode | **(b)** | Trivial | Token layer (large FE); preference persisted local-first |

---

## 3. Data-model changes (concrete, lightest viable home)

Principle: respect "backend largely unchanged" + hexagonal (dependencies inward, Zod only at the inbound adapter boundary). Default each new concept to the **lightest layer that still satisfies persistence + multi-device needs**.

### 3.1 Source: display name + archive/retention — **backend API (smallest additive surface)**
The "source" is the raw-upload concept that today collapses into `Dataset`. Rather than introduce a new aggregate (which would ripple through the backend the user wants untouched), **extend the existing dataset/source record** with three nullable, additive fields:

```
# conceptual — additive columns on the existing datasets/source table
display_name      TEXT      NULL   -- editable; falls back to name; filenames untouched
archived_at       TIMESTAMP NULL   -- set on "move to cold storage"
retention_until   TIMESTAMP NULL   -- set = archived_at + org retention window (default 90d)
```

- **Why backend, not frontend-local:** archive state changes what appears in the lineage graph and must survive reload + be consistent across devices/users in the same org. The transcript's "session memory" approach was a prototype shortcut the user explicitly wants to outgrow.
- **API surface (additive, no breaking change):**
  - `display_name` returned on dataset/source reads; settable via the existing `updateDataset` (`DatasetUpdate` gains `display_name?`).
  - List endpoints filter out `archived_at IS NOT NULL` by default; add `?archived=true` to fetch the cold-storage list.
  - Two new thin endpoints: `POST /api/datasets/{id}/archive` and `POST /api/datasets/{id}/restore` (or a `PATCH` with `archived_at`). One Alembic migration (next in sequence after `013_…`).
- **`dataCatalog` type changes:** `Dataset` / `DatasetSparse` gain `display_name?: string | null`, `archived_at?: string | null`, `retention_until?: string | null`. **Days-left is computed frontend-side** from `retention_until` (no stored countdown).
- **Hexagonal note:** these are plain DTO fields on the existing boundary types; no domain class on the wire. Retention *policy* (the 90-day window) is an org default — read-only for now (lives with Org defaults, §3.3).

### 3.2 Upload schema capture — **already served; no change**
The parsed schema the modal displays is the dataset's existing `schema_config` (`SchemaConfig`/`FieldConfig`), already returned by `getDataset`. "Upload another file to same schema" reuses `uploadFile(endpoint, file, { dataset_id })` — the backend already accepts `dataset_id` on `POST /api/uploads` to append to an existing dataset. **No new backend capability.** The per-source file list (names + rows + when) is the one piece not obviously served today — confirm whether upload history is queryable; if not, it is a small **(c)** read endpoint (open question 6) or shown best-effort.

### 3.3 Org pipeline defaults / members / plan — **deferred (c); display-only now**
`getOrgInfo` returns `{id, name}`. The design's defaults (engine, materialization, dbt prefix), members roster, and plan/seats are **not served**. Recommendation: **display-only with derived/static content now**; if/when made functional, add an `GET/PATCH /api/orgs/me/settings` surface — explicitly deferred. The retention window (§3.1) would live here when org settings become functional.

### 3.4 Theme aesthetic + dark-mode preference — **frontend-local first (`localStorage`)**
- Lightest home: a small `themePreference` persisted in `localStorage` (`{ aesthetic: "neobrutalist", dark: false }`), read in `root.tsx` and applied as a root class. SSR renders the default (Neobrutalist + light) to avoid hydration flash; client reconciles on mount.
- **Why not backend/ui-state:** it's a pure presentation preference with no cross-service consumer; the project memory note ("keep ui-state refactors internal, FE untouched until redesigned") argues *against* threading a cosmetic flag through the in-flux ui-state wire. Promote to a backend per-user preference later if multi-device theme sync is wanted (open question 3).

### 3.5 Orphan flag — **derived, never persisted**
Orphan = non-source node with zero live (non-archived) inputs. Computed in the lineage builder from edges + archive state. No field.

---

## 4. Frontend architecture (mapping onto RRv7 framework mode)

### 4.1 Shell: breadcrumb replaces sidebar
`AppShell` (`frontend/src/ui/components/AppShell/index.tsx`) keeps its responsibilities (`RequireAuth`/`RequireOrg`, `StreamProvider`, `ChatProvider`, `<Outlet/>`) but swaps `<SideNav>` for a new transparent `<Breadcrumb>` floating over the centered content frame. The breadcrumb is **context-aware off the route**:
- On Pipeline/list views: `OrgIcon / Project ▾`.
- On a model view: `OrgIcon / Project (link) / Model ▾` (picker grouped Datasets/Views/Reports).
- Org icon is a toggle → morphs to × → renders the Org sheet on a darker inset backdrop (the assistant FAB hides while open).

The picker data comes from existing TanStack Query hooks (`useOrgProjectsQuery`, `useProjectQuery`, plus new `useViews`/`useReports` list hooks wrapping `listViews`/`listReports`). Keep key factories consistent with the existing `projectKeys`-style pattern (CLAUDE.md convention).

### 4.2 Routes (RRv7 framework mode)
Per ADR-034, routes stay library-mode unless they need SSR; the landing page benefits from SSR (shareable, fast first paint). Proposed `routes.ts` evolution (additive; preserves existing paths):

| Path | Component | Mode | Notes |
|---|---|---|---|
| `/` (index) | **new `Pipeline`** (was `ChatView`) | framework (loader) | Landing = lineage; loader seeds graph data SSR. Chat moves into the FAB overlay, not a route. |
| `projects` / `projects/:id` | existing | unchanged | Picker targets |
| `view/:id`, `report/:id`, `table/:datasetId` | existing detail views, recomposed | unchanged paths | Add deps-strip/audit/preview/SQL |
| `sessions` | existing `SessionList` ("All Chats") | unchanged | Clock in overlay routes here |
| `org` (new) or org-sheet overlay | Org Settings | overlay state, not necessarily a route | Transcript treats it as an in-place sheet; can be `?org=1` search param to keep it linkable without a full route |

**Decision:** the chat landing → pipeline landing swap is the one route-semantics change. Chat is no longer a top-level page; it is an overlay available everywhere via the FAB. The existing `/chat/:channelId` and `/sessions` routes remain for deep-links and "All Chats."

### 4.3 Theme token system — where it lives
- **Global tokens** in a new `frontend/app/theme/tokens.css` (or extend `index.css`) defining CSS custom properties: `--bg`, `--surface`, `--ink`, `--accent`, `--layer-source/staging/intermediate/mart`, `--radius`, `--shadow`, `--glass`, `--grid`, font tokens. This is the layer the prototype assumed and the current codebase lacks.
- **Aesthetics** = root classes (`.theme-neobrutalist`, `.theme-neon`, …) that redefine the tokens; **dark mode** = an orthogonal `.dark` class (Solarized palette) that stacks on any aesthetic. Applied on the `<html>`/`#root` in `root.tsx`'s `Layout`.
- **Migration of components**: refactor high-visibility CSS Modules (pipeline, breadcrumb, detail, chat overlay, org sheet) to read tokens. Lower-traffic components can migrate opportunistically — the token layer is additive, so un-migrated components simply don't reskin (acceptable interim).
- **Tailwind interplay**: keep Tailwind; map a few Tailwind theme colors to the CSS variables so utilities and tokens agree. Avoid a hard Tailwind→token rewrite in one shot.

### 4.4 Assistant FAB / overlay / terminal
A new `Assistant` feature module mounts at the shell level (sibling of `<Outlet/>`), not per-route, so it floats over every view. It consumes the existing `ChatProvider`/`StreamProvider` context unchanged. Render branch: `dark ? <TerminalAssistant/> : <GlassOverlay/>`. New Session, recents (`listSessions`), and history (→ `/sessions`) are overlay-internal controls. **The ui-state wire is untouched** (honors project-memory guidance).

### 4.5 Lineage feature module
New `frontend/src/ui/components/Pipeline/` (or `frontend/app/routes/pipeline.tsx` + component): a `buildGraph(datasets, views, reports, archivedSet)` pure function produces nodes/edges; three presentational view components (`FlowView`, `LanesView`, `AuditView`) share it. Hexagonal-friendly: the graph builder is a pure core function (testable in isolation), the views are adapters over it. Orphan detection lives in the builder.

---

## 5. Phasing / sequencing (MRs via `gt mq submit` — not GitHub PRs)

Each MR is independently landable and demo-able. Ordered to retire the highest risk (token layer, route-landing swap) early and to keep every step shippable.

- **MR-1 — Design-token foundation + dark-mode plumbing (walking-skeleton thin slice).**
  Add global CSS-variable token layer in `root.tsx` defining the **single Neobrutalist aesthetic** (light) + a `.dark` root class carrying the **Solarized-dark** palette. **No `.theme-*` aesthetic switcher** (decision §9 → Option A). Persist only the dark-mode flag in `localStorage` with an SSR-safe default (Neobrutalist light). Refactor *one* visible surface (e.g. the shell frame + breadcrumb stub) to consume tokens, proving light↔dark reskin end-to-end. **Demo:** toggle dark mode on a single surface. *This is the walking skeleton — it de-risks the load-bearing token prerequisite (§2.8/§4.3) before any feature depends on it.*

- **MR-2 — Lineage Pipeline view + landing swap.**
  New `Pipeline` module with `buildGraph` + Flow/Lanes/Audit; make it the `/` landing (SSR loader). Orphan detection wired against an empty archive set for now. **Demo:** land on the pipeline, switch styles, drill into a node.

- **MR-3 — Breadcrumb shell replaces SideNav.**
  Swap `SideNav` for `Breadcrumb` (org icon toggle, project picker, model picker). Org sheet as `?org=1` overlay (display-only panels + Appearance/dark-mode toggle moved here). **Demo:** navigate entirely via breadcrumb; open org sheet; toggle dark.

- **MR-4 — Assistant FAB / glass overlay / dark TUI terminal.**
  Reshell existing chat into the FAB+overlay (light) and terminal (dark); recents + New Session + history (→ `/sessions`) inside. **Demo:** open assistant, run a chat, history opens All Chats, dark mode shows terminal.

- **MR-5 — Model detail recomposition.**
  Deps strip + Assistant-changes audit + columns/measures + compiled SQL on view/report/dataset detail. Per-layer preview where already served; defer view/report preview if it needs a backend sample endpoint. **Demo:** drill into each layer, see audit + SQL.

- **MR-6 — Upload modal + editable source display name (needs §3.1 `display_name`).**
  Upload modal, dial-up animation over the existing `uploadFile` call, schema view, editable display name (backend `display_name` field + `updateDataset`), "upload another / create source," source-node click reopens modal. **Demo:** upload, rename source (filename unchanged), node appears in lineage.

- **MR-7 — Cold storage / retention (needs §3.1 archive columns + endpoints).**
  Backend migration (`archived_at`, `retention_until`) + archive/restore endpoints + list filtering; fridge toolbar, snowflake buttons, confirm dialog, cold-storage list with days-left, random-food empty state. Wire orphan detection to live archive state. **Demo:** archive a source → leaves lineage, downstream goes orphaned, restore brings it back.

- **MR-8 — Aesthetic polish pass.**
  Migrate remaining high-traffic components to tokens; finalize the **single Neobrutalist skin + Comic-styled assistant** (light) and the **Solarized-dark + TUI console assistant** (dark); contrast fixes (the dark-mode contrast bugs the transcript hit). **Demo:** polished light + dark across the app. *(No multi-aesthetic switcher — scope collapsed per §9 Option A.)*

Backend touches are isolated to **MR-6 (one field)** and **MR-7 (two columns + 2 endpoints + 1 migration)** — everything else is frontend-only, honoring the "backend largely unchanged" constraint.

---

## 6. ADR candidates

1. **Global design-token system + aesthetic/dark-mode root-class skinning** (supersedes the implicit "CSS Modules with hardcoded values" status quo). Why: introduces a cross-cutting styling layer the codebase lacks; sets the rule that aesthetics are token redefinitions, not behavior changes; defines Tailwind↔token coexistence. Alternatives: per-component theming, Tailwind-only theming, styled-components/runtime CSS-in-JS.
2. **Breadcrumb-driven navigation replacing the sidebar** (amends ADR-034-era shell). Why: removes `SideNav`, makes navigation route-context-derived, moves session controls into the assistant. Alternatives: keep sidebar + add pipeline; collapsible sidebar.
3. **Pipeline lineage as landing + chat-as-overlay** (route-semantics change). Why: `/` stops being chat; chat becomes an everywhere-overlay. Alternatives: keep chat landing + pipeline as a sub-route.
4. **Source display-name + cold-storage retention model** (data-model extension). Why: introduces `display_name`/`archived_at`/`retention_until` as additive backend fields rather than a new aggregate; defines retention as frontend-derived from `retention_until`. Alternatives: new "source" aggregate; frontend-local archive state (rejected — must persist + affect lineage).
5. **Dark-mode terminal assistant as a presentation branch** (optional, lighter — could fold into ADR #2). Why: documents that the TUI is a render variant over the same chat plumbing, not a separate chat stack.
6. **Theme preference persistence: frontend-local first** (could fold into ADR #1). Why: records the deliberate choice not to thread a cosmetic flag through in-flux ui-state.

---

## 7. Risks & open questions (for the user to decide)

**Still-relevant questions carried from the transcript:**
1. **dbt semantic models / metrics for marts** — should reports surface dbt `semantic_models`/MetricFlow definitions, or stay plain aggregation SQL? (Affects model-detail scope, MR-5.)
2. **Inline-editable joins/grain on Views** vs purely chat-driven editing? (Affects view-detail interactivity; default = chat-driven, matching current creation model.)
3. **Persistence of renames/archives** — confirmed needed for archives (§3.1). For *theme/dark-mode*, is `localStorage` (per-device) acceptable, or do you want per-user backend persistence (multi-device sync)?
4. **Raw-source → `stg_` cleaning handoff** — when a source is created, should the assistant auto-offer to clean it into a `stg_` dataset, or stay manual? (Affects MR-6/MR-7 boundary; today a CSV→dataset is one step, so "source without a dataset" is a genuinely new state to design.)

**New questions surfaced by this analysis:**
5. **Per-model audit provenance** — does the agent/backend persist per-model tool-call history, or does it only live in chat transcripts? The "Assistant changes" panel (MR-5) needs a per-model audit source. If only transcripts exist, a small read endpoint or client-side derivation from session history is required (possible (c)).
6. **View/report preview + source file list** — are sample rows served for views/reports today (like `Dataset.preview_rows`), and is per-source upload history queryable? If not, those are deferred (c) requiring query-engine sampling / an uploads-history read endpoint.
7. **Org Settings scope** — confirm General/Members/Pipeline-defaults stay **display-only** for this redesign (functional org admin deferred), so we don't accidentally pull a large backend surface into a UI redesign.
8. **Token-migration breadth** — accept the interim where only high-traffic components are token-migrated (others don't reskin until MR-8), or require full migration before shipping aesthetics?

**Risks:**
- **Theme token layer is the critical path** — every aesthetic depends on it and the codebase has none. Mis-sequencing (building features before tokens) would force rework. Mitigated by MR-1 as the walking skeleton.
- **SSR theme flash** — applying a `localStorage` theme client-side risks a flash of the default. Mitigated by SSR-rendering the default aesthetic and reconciling on mount; accept a one-frame reconcile for non-default themes, or persist to a cookie the SSR loader can read (lighter than backend, heavier than localStorage) if flash is unacceptable.
- **ui-state in flux** (project memory) — the assistant reshell must not touch the ui-state wire. Mitigated by treating MR-4 as a pure consumer reskin.

---

## 8. Handoff notes (DISTILL / acceptance-designer)

- **No external integrations** are introduced by this redesign (Groq/agent SSE and the query engine are pre-existing internal boundaries; no new third-party API). No new contract-test recommendations beyond what already exists.
- **Backend changes are confined to MR-6 (one field) and MR-7 (two columns + archive/restore endpoints + one Alembic migration).** Acceptance tests for those MRs should assert: display-name persists while filenames are unchanged; archived sources leave the lineage and create orphaned downstream nodes; restore reverses both; days-left is derived from `retention_until`.
- **Pure-frontend MRs (1–5, 8)** are testable via the frontend suites (`cd frontend && npx vitest run`) + acceptance suites per `tests/acceptance/<feature>/`.
- **The walking-skeleton thin slice is MR-1** (token layer + dark-mode plumbing on one surface).

---

## 9. Addendum — base design vs. remix (added 2026-05-30)

> **DECISION LOCKED (2026-05-30): Option A — single Neobrutalist aesthetic.**
> Production ships **one** aesthetic, not the swappable 5-way switcher:
> - **Light mode:** Neobrutalist chrome (thick ink borders, hard offset shadows, electric palette, yellow FAB) with a **Comic-styled assistant** overlay (rounded ink panel, Ben-Day halftone, Baloo heading, blue mark, red send).
> - **Dark mode:** **Solarized-dark** palette + the assistant rendered as a **docked console/TUI** instead of the glass/comic overlay.
> - **No in-app aesthetic switcher.** The design-token layer (MR-1) is still built — dark mode and maintainability need it — but Tweaks carries no Studio/Neon/Macintosh/Comic selector. The only user-facing appearance control is the **dark-mode toggle in the org view**.
> - **Core Studio behaviors retained (confirmed in scope):** (1) nav eliminated — breadcrumb is the primary nav; New Session + chat-history toggle live **inside the chat/assistant interface**; (2) project Pipeline view (Flow / Lanes / Audit) is the **landing page**; (3) **assistant FAB in the bottom-right corner**; (4) **org view toggled by the org icon in the breadcrumb**; (5) **upload modal separated from the assistant**; (6) **single-page dataset view** (data preview + schema + SQL); (7) **cold-storage window** for retired resources.
> - **Effect on the plan:** MR-1 and MR-8 scope collapse to one skin + dark mode (see §5). MR order is unchanged. Open question on theme persistence is now trivially "dark-mode flag in `localStorage`."


The handoff we analyzed is a **remix that forked an earlier base design** (project `dashboard-chat`; both bundles pulled on demand per `design-sources.md`). The fork point is exact: the base transcript ends at the **breadcrumb/model-picker** feature, and the remix transcript continues from that point with *"We've got a great foundation but in this remix, I want to explore alternative aesthetics…"*. The prototype file sets confirm it — the base lacks `themes.css`, `upload.jsx`, `upload.css`; everything else is shared. This gives a clean **validated-foundation vs. exploratory-delta** split that refines (but does not overturn) the analysis above.

### Shared foundation (base — validated against the warm "Studio" aesthetic)
Layered pipeline lineage (Flow/Lanes/Audit) · model detail with prominent audit + data preview · chat-driven creation · All-Chats search · pipeline-as-landing · sidebar→breadcrumb restructure · org settings page · glass FAB assistant overlay · transparent header / dot-grid. **These are the lower-design-risk, already-iterated MRs: MR-2, MR-3, MR-5, and the light-mode half of MR-4.**

### Remix-only deltas (newer, less-validated)
Multi-aesthetic theme system + neobrutalist default + comic assistant · Solarized dark mode · dark-mode TUI terminal · **upload modal detached from the assistant** + "source" node concept · cold storage / retention · orphaned-node detection. **These carry more product risk: MR-1/MR-8 (theme), the dark half of MR-4, MR-6, MR-7.**

### What this changes
1. **Theme-system scope is now an explicit product decision, not an assumption.** The base is a *single coherent aesthetic* with **no theme system at all**; the swappable 5-aesthetic switcher was an explicit remix *exploration* ("I want to explore alternative aesthetics"). The user landed on neobrutalist, but that does not by itself mean the production app must ship a runtime 5-way aesthetic switcher.
   - **Option A — single production aesthetic** (e.g. neobrutalist, or keep Studio): still build the design-token layer (MR-1 stays — it is good practice and dark-mode needs it), but **drop the in-app aesthetic switcher** and MR-8's "five skins" scope collapses to "one polished skin + dark mode." Materially less work and less surface to maintain.
   - **Option B — full swappable theme system** as in the remix: MR-1/MR-8 as originally scoped.
   - **Recommendation:** Option A unless multi-aesthetic theming is a real product goal. The token layer is the durable asset; the 5-way switcher is the exploratory part. This is the single most consequential thing the base/remix split surfaces.
2. **Default aesthetic is a decision, not a default.** §4.3/MR-1 assumed neobrutalist as the SSR default; the base's default was Studio (warm). Treat the production default as a user choice — it's a one-line change either way once the token layer exists.
3. **Detached upload is a deliberate departure from the base's "fully chat-driven" principle.** The base (and the user's original answers — *"creation_model: Same as transforms — fully chat-driven"*) created everything, including uploads, through the assistant. The remix intentionally moves upload **out** of the assistant into a standalone modal with a first-class "source" node. This confirms open-question 4 is real and intentional: a source can now exist *before/without* a `stg_` dataset and outside any chat. MR-6 should treat detached upload as the intended model, and the raw-source→`stg_` handoff (auto-offer to clean) becomes the bridge back to the chat-driven flow.

### What this does NOT change
Backend/data-model conclusions are unchanged: both designs share the same `data.js` mirroring the real `dataCatalog` types (the remix's `data.js` is only +13 lines). The two backend touches (`display_name`; `archived_at`/`retention_until` + archive/restore) and the "backend largely unchanged" framing stand exactly as in §3. The MR sequence is unchanged in order; only MR-1/MR-8 *scope* depends on the theme decision above.
