# Dashboard Chat — Current State of the System (RESEARCH wave)

> **Wave:** RESEARCH (CROSS_WAVE) · **Date:** 2026-05-29 · **Branch:** `research/system-state-overview`
> **Method:** Intent-first (vision / product docs / ADRs) → verified against code; gaps labelled.
> **Scope:** READ-only whole-monorepo survey. No source changed. Evidence is `file:line` anchors + ADR numbers (this is an internal code survey, not a web-sourced study).
> **Caveat:** `ui-state/`, `frontend/`, `auth-proxy/`, and `tests/acceptance/` are under active parallel edit (ADR-046 `/state` migration). Anchors into those trees reflect a 2026-05-29 snapshot and may have moved by the time you read this.

## TL;DR

Dashboard Chat is a **chat-first prototyping tool** that turns uploaded files into a **data catalog** and a **handoff-ready dbt project**. A user uploads CSV/Excel/FHIR/HL7v2 → the backend converts to Parquet in object storage, profiles columns, and catalogs a `Dataset` → the user shapes it through natural-language chat (clean / filter / rename, plus views and reports) → the project exports as a complete 4-layer dbt archive (sources → staging → intermediate → marts) and can expose a live SQL endpoint. **Stages 1, 2, and 4 of the product vision are genuinely IMPLEMENTED and wired end-to-end.** The system is a maturing, multi-service application (FastAPI backend, two Hono BFFs, an RRv7 frontend, an ingress auth-proxy, and Postgres/Redis/MinIO/pg_duckdb infra), built under a disciplined ADR + nwave methodology with ~1,800+ tests.

**Maturity verdict:** the **data/staging layer is production-quality prototype code** — not a stub. The most prominent gaps are (a) **Stage 3 "Preview"** (Vizro dashboards, in-chat grid mockups, DuckDB-WASM hot reload) which is **purely aspirational** — the `planner/` package exists but is unwired and renders placeholder charts; (b) the **in-flight ADR-046 ui-state `/state` migration** (MR-1…MR-5 landed, MR-6 acceptance + MR-7 cleanup pending — the system currently runs two parallel UI-state surfaces); and (c) a **stale root `README.md`** describing a long-superseded Cloudflare-Workers prototype.

**Demo-readiness of the data/staging layer:** **YES, demoable today** via Docker Compose — upload a CSV → see catalog + column profiles → chat-driven transforms → download a working dbt zip → optionally enable a Postgres-wire SQL endpoint. Caveats: bring up the stack with `make up` (Bazel-built images), seed a dev org/project (`backend/scripts/setup_dev.py`), and be aware of a **`web-ssr` image-load gap** in the Makefile (see §6). The handoff (dbt) and SQL-access paths are the strongest demo material; the dashboard *preview* is not demoable at all.

---

## 1. System Purpose + End-to-End Flow

### 1.1 What the product is (intent)

Per `docs/vision.md:1-5`, Dashboard Chat is a **chat-first prototyping tool for data models and dashboards**: users go from raw files (or synthetic data) to a working prototype, then **hand off** a dbt project to data engineers and renderable dashboard code to software engineers. It targets domain experts who know some SQL but don't want to run data infrastructure. The vision frames four stages (`docs/vision.md:9-21`):

| Stage | Vision label | Reality (verified) |
|---|---|---|
| 1. UPLOAD | "COMPLETE" | **IMPLEMENTED** |
| 2. MODEL (chat) | "COMPLETE (reports in progress)" | **IMPLEMENTED** (report agent tools also landed) |
| 3. PREVIEW (live dashboard) | "PLANNED" | **ASPIRATIONAL** — no wired implementation |
| 4. HANDOFF (dbt + SQL) | "COMPLETE" | **IMPLEMENTED** (dbt export + pg_duckdb SQL access) |

Note: the public README at the repo root (`README.md`) is **stale** — it describes the original Cloudflare-Workers single-table prototype (`README.md:30-39,113-127`) and its "Live Demo" link points at the retired Cloudflare Pages deployment. `docs/vision.md` is the current source of intent.

### 1.2 The verified end-to-end data path (uploaded files → catalog → dbt project)

```
 UPLOAD                INGEST / PARSE              CATALOG                 MODEL (chat)            HANDOFF
 ┌────────┐  multipart ┌──────────────┐  Parquet  ┌────────────┐  NL ops ┌──────────────┐  zip   ┌──────────────┐
 │ client │──POST────▶│ plugin parse │──to S3───▶│  Dataset    │◀──────▶│ Transforms   │──────▶│ dbt project   │
 │  file  │ /api/     │ → DataFrame  │  + profile │  (Postgres  │  agent  │ (Ibis 3-stage│ /export│ 4 layers +    │
 └────────┘ uploads   │ → Parquet    │  + preview │  metadata)  │  tools  │  MUTATE→     │ /dbt   │ profiles.yml  │
                      └──────────────┘            └────────────┘         │  FILTER→     │        └──────────────┘
                                                        │                │  RENAME)     │              │
                                                        ▼                └──────────────┘              ▼
                                                 GET /api/datasets                              SQL access:
                                                 (catalog browse)                          pg_duckdb schema + views
```

1. **Upload entrypoint — `POST /api/uploads`** (`backend/app/routers/uploads.py:19-63`). Multipart form (`file`, `project_id`, optional `dataset_id`); reads bytes (`:43`); verifies org owns the project (`:30`); two internal steps — `post_upload` then `post_dataset` (`:47-62`). Multi-sheet Excel returns HTTP 202 `awaiting_input` (`:55-56`) and the client re-POSTs sheet choices.
   - **Format detection** is extension-based via `PluginRegistry.get_for_filename()` (`backend/app/plugins/registry.py:33-42`) — compound extensions first (e.g. `.fhir.json`), then simple. No MIME/magic-byte sniffing.
   - **Registered formats:** CSV, Excel (`.xlsx/.xls`), FHIR (`.ndjson`/`.fhir.json`), HL7v2 (`.hl7`, requires Mirth) — `backend/app/plugins/__init__.py:26-32`. **GAP:** `docs/vision.md:27` and `docs/domain/dataset-lifecycle.md:15` advertise **JSON and Parquet** as input formats, but **no JSON or Parquet input plugin is registered** — ASPIRATIONAL vs IMPLEMENTED divergence.

2. **Ingestion / parse → Parquet → S3** (two use cases):
   - `upload_file` (`backend/app/use_cases/upload/upload_file.py:51-126`): validate, `detect_choices`, `process` for preview, record an outbox `UploadFileReceived` event, write raw bytes to MinIO via `lake_repo.write_raw_file()` (`:108`).
   - `create_dataset_from_upload` (`backend/app/use_cases/dataset/create_dataset_from_upload.py:52-118`): read raw back from S3 (`:77`), dispatch the plugin (`backend/app/use_cases/dataset/_pipeline/plugin_dispatch.py:45-67`), analyze + persist.
   - **Parquet conversion** runs through an **in-process DuckDB** `COPY … TO … (FORMAT PARQUET)` then uploads to S3 (`backend/app/repositories/lake/repository.py:98-172`). Note a **CSV round-trip**: the DataFrame is re-serialized to CSV before the DuckDB conversion (`backend/app/use_cases/dataset/_pipeline/ingestion.py:97-99`) — lossy for type precision (DuckDB re-infers).
   - **Column profiling + preview**: `analyze_dataframe()` infers schema, computes per-column profiles, and keeps the first 10 rows (`backend/app/use_cases/dataset/_pipeline/ingestion.py:31-56`).

3. **Catalog — the `datasets` table.** `create_dataset_from_upload` → `metadata_repo.create_dataset()` (`backend/app/repositories/metadata/repository.py:396-425`). Browse via `GET /api/datasets?project_id=…` (cursor-paginated by UUIDv7), `GET /api/projects/{id}/datasets`, `GET /api/datasets/{id}`, and `search_datasets_by_name` (ILIKE, top-10). The repository layer is split per ADR-020 into `MetadataRepository` (control plane), `LakeRepository` (Parquet data plane), `OutboxRepository` (event log), wired lazily in `backend/app/repositories/__init__.py:69-115`.

4. **Model — the 3-stage Ibis transform pipeline.** `Transform` types are `filter | clean | alias | map` (`backend/app/models/transform.py:15`). SQL is generated MUTATE → FILTER → RENAME (`backend/app/models/dataset_sql.py:78-98`): cleaning mutations (`:101`), filter predicates (`:113`), alias renames (`:126`), compiled with `ibis.to_sql(dialect="duckdb")` (ADR-007 / ADR-026). Transforms are **non-destructive** — enabled / disabled / soft-deleted (`docs/domain/dataset-lifecycle.md:60-65`); raw Parquet is never mutated. Driven by the chat agent's tool calls (§2.1).

5. **Handoff — `GET /api/projects/{project_id}/export/dbt`** (`backend/app/routers/projects.py:54-85`) returns a streamed `.zip`. Orchestrated by `generate_dbt_project_zip()` (`backend/app/use_cases/project/_dbt/__init__.py:68-178`). See §3 for the full artifact list and the Ibis→`{{ source() }}`/`{{ ref() }}` compilers.

6. **DuckDB's three roles** (ADR-003): (A) in-process Parquet conversion at ingest; (B) `pg_duckdb` query engine over S3 Parquet for previews and transform execution (`backend/app/database.py:93-135`); (C) external SQL access — per-project pg_duckdb schemas + Parquet-backed views over the Postgres wire protocol.

---

## 2. Component Inventory

Source-tree directories are named for the **body of code** they contain; compose services for their **runtime role** (ADR-033). Divergences are intentional (e.g. `backend/` → service `api`; `frontend/` → services `reverse-proxy` + `web-ssr`).

### 2.1 `agent/` — Chat / SSE service · **IMPLEMENTED**
Hono (Node) + Vercel AI SDK + Groq `llama-3.3-70b-versatile` (ADR-002), streaming via SSE (ADR-004). Composition root `agent/index.ts:37-175`; core dispatch `agent/lib/chat/handleChat.ts:86-228`. Surface: `POST /chat`, `GET /health`, `GET /api/channels/{id}/presentation-state` (reflect-only directive log, ADR-015), `GET /openapi.json`. Four context modes, each with its own toolset + system prompt (`handleChat.ts:144-159`): **dataset** (`addRow`, `deleteRow`, `trimWhitespace`, `standardizeCase`, `renameColumn`, `fillNulls`, `mapValues`, `applyCleaningTransform`, undo/re-enable), **view** (`createView`, `addJoin`, `setGrain`, `setMaterialization`, …), **report** (`createReport`, `addDimension`, `addMeasure`, …), and **conversational** (`resolve_dataset` only). Dispatchers call the backend through `AUTH_PROXY_URL` with the forwarded JWT; domain events are persisted to a Redis thread log for replay (ADR-014). The LLM never writes SQL — tools emit structured column/transform metadata the backend's Ibis compilers translate.
- **Vision-vs-reality note:** `docs/vision.md:42` says report "agent tools in progress." In code the report toolset is **fully present and wired** (`agent/lib/chat/reportToolDefinitions.ts`, dispatched at `handleChat.ts:145`). Treat reports as IMPLEMENTED; the vision note is stale.

### 2.2 `auth-proxy/` — Ingress / identity gateway · **IMPLEMENTED**
Hono + `jose`. The single network ingress: verifies Bearer JWTs (WorkOS in prod, dev JWKS in dev), strips client identity headers, injects `X-User-Id`/`X-Org-Id`/`X-User-Email`, and routes to two upstreams — `/ui-state/*` → `UI_STATE_URL` (prefix stripped), everything else → `BACKEND_URL` (`auth-proxy/app.ts:39-40,404-487,631-671`). Also mints M2M `client_credentials` tokens (`:252-293`, `M2M_ENABLED`) and PATs (`:298-395`), and reissues a fresh org-scoped user token after `POST /api/orgs` (`:684-730`, ADR-043). **ADR-046 MR-5 (landed today):** after every `/ui-state/*` response it sniffs the `/state` document — `regions.onboarding.{state, context.underlying_cause_tag}` with a transitional fallback to the legacy flat shape — to emit KPI events (`:522-605`).

### 2.3 `ui-state/` — UI flow-state BFF · **IMPLEMENTED (mid-migration)**
Hono + **XState v5** actors + Redis (ADR-027/028/030). **Holds UI *coordination* state, not application data** — it sequences the onboarding → project-selection → chat lifecycle per principal. Composition root `ui-state/index.ts:1-211`. The **ChatApp** parent coordinator (ADR-044) drives three child machines — `onboarding`, `project-context`, `session-chat`; the legacy `FlowOrchestrator` is gone from `index.ts`. Redis: append-only `FlowEventLog` (`ui-state:<flow_id>:events`) + a ChatApp snapshot store for hot restart. **Two surfaces are mounted simultaneously today** (the in-flight piece): the new `/state` actor surface — `GET /state`, `GET /state/stream` (SSE), `POST /state/events` (`index.ts:122-124`) — *additively alongside* five legacy per-machine wire paths (`index.ts:67-76`). Token lifecycle is **not** modelled here (ADR-043 retired freeze/thaw; auth-proxy owns it).

### 2.4 `frontend/` — RRv7 SPA + SSR · **IMPLEMENTED (RRv7 migration ongoing)**
React 18 + React Router v7 framework mode (ADR-034) + TanStack Query + XState. One source tree → **two OCI images / two compose services** (ADR-033, `frontend/BUILD.bazel`): `reverse-proxy` (nginx, serves `dist/client/` static + routes `/api/*`, `/worker/*`, `/ui-state/*`, presentation-state, health; `//frontend:image` :388-409) and `web-ssr` (Hono SSR handler on :3001; `//frontend:ssr_image` :461-473). Entries: client hydration `frontend/main.tsx` (`hydrateRoot(document, <HydratedRouter/>)`), SSR `frontend/ssr.ts`, root module `frontend/app/root.tsx`. ~16 routes (`frontend/app/routes.ts:13-37`) — login/logout/callback, org create, app-shell + `chat`, `projects`, `projects/:id`, dataset/table/view/report detail, query-engines, sessions. **ADR-046 MR-4 (landed today):** `root.tsx` loader fetches one `GET /state` and seeds a `StateProxy`, read via `useSelector` — `WelcomePanel` renders on first paint without a round-trip (`root.tsx:83-101,131-148`).

### 2.5 `shared/chat/` — `@dashboard-chat/shared-chat` · **IMPLEMENTED**
Single source of truth for the chat wire schema, imported by `agent/` and `frontend/`. `events.ts`: `DomainEventSchema` ∪ `UiDirectiveSchema` discriminated unions (ADR-014). `domainEvents.ts`: which events persist to the thread log vs ephemeral directives; the Python mirror `backend/app/use_cases/session/_domain_event_types_generated.py` is **codegen'd** from it (`npm run codegen:domain-events`). `applyDirective.ts`: client-side directive application. (A sibling `shared/failure-simulation/` package is also wired into `agent/` and `ui-state/`.)

### 2.6 Components not in the daily request path

| Dir | What it actually is | Status |
|---|---|---|
| `planner/` | Standalone Python **LangGraph + Vizro** multi-agent pipeline (prompt + manifest → Vizro dashboard plan). 5 agents (planner→section fan-out→filter→assembler→validation). ~41 files. CLI `planner plan/serve` (`planner/planner/cli.py:1-64`, graph `agents/orchestrator.py:1-155`). **Not in docker-compose; not imported by any service; renderer emits `_placeholder_chart`/`_placeholder_kpi` only** (`planner/planner/schema/vizro_builder.py:32-50`). | **SCAFFOLD / UNWIRED** — the intended Stage-3 engine, not integrated |
| `dashboard_chat_sdk/` | Generated typed Python SDK over the FastAPI OpenAPI surface (`openapi-python-client`), thin `Client` wrapper (`src/.../_client.py:1-64`), `regenerate.sh`, smoke test. v0.1.0 alpha, proprietary, **not published, not a runtime dependency**. Covers projects/datasets/uploads/sessions/views/reports/sql-access/query-engines/org/auth; excludes PAT/M2M + chat SSE. | **DISTRIBUTION ARTIFACT** (complete for REST surface) |
| `e2e/` | Playwright (TS), 20 specs across 7 suites (smoke, auth, table-ops, data-cleaning, upload). Layered fixtures + `global-setup.ts` seeds a project/dataset. Tagged `manual`/`requires-docker` — runs via `e2e/run-e2e.sh`, **not in the auto gate**. Some selectors look **stale** vs the current RRv7 UI (`e2e/smoke.spec.ts:25` still seeks the old `Type a command...` input). | **IMPLEMENTED but manually-gated; partly stale** |
| `features/` | 12 Gherkin `.feature` files (chat-first UI, table ops, token refresh, dbt export, data cleaning, query engine, view/report layers, file-format plugins, external data access). **No step definitions / runner** — they are DISTILL-wave *specifications*; the executable analogues live in `tests/acceptance/` as pytest suites. | **SPEC DOCS** (not executable as-is) |
| `tools/` | Build/CI tooling. `tools/test/test.sh` (214 LOC) is the **merge-queue gate** — content-aware `--auto` selector dispatches per changed subtree (`--backend/--ui/--ui-state/--agent/--all/--integration/--acceptance=<f>`); docs-only diffs exit 0. Plus `check_workspace_consistency.py`, Bazel version-stamping (`workspace_status.sh`, `version_layer.bzl`), and toolchain bootstrappers. | **TOOLING (active)** |
| `tests/` | `tests/acceptance/` — 11 self-contained pytest suites (compose-gated; run via `--acceptance=<name>`). Includes `dbt-test-validation-v2` (dbt export, supersedes a v1 BDD orchestrator per ADR-024) and the ui-state flow suites. | **IMPLEMENTED (out-of-gate)** |

---

## 3. The Data / Staging Layer (in depth)

This is the requester's focus and the most mature part of the system. "Staging" here means **two related-but-distinct things**, which is worth disentangling:

1. **The dbt *staging* layer** (`stg_*` models) — the first transformed layer of the exported dbt project, sitting over dbt `sources`.
2. **A dataset's runtime *staging SQL*** — the Ibis-compiled SQL that materializes a dataset's transformed view for previews/queries.

### 3.1 How a file becomes a queryable dataset
Covered in §1.2 steps 1–4. Net: raw bytes → MinIO (`uploads/{project_id}/{file}`) → parsed to a DataFrame → re-serialized CSV → DuckDB `COPY … FORMAT PARQUET` → Parquet to `datasets/{project_id}/{dataset_id}/` (optionally Hive-partitioned) → `Dataset` row cataloged with `schema_config`, `column_profiles`, `preview_rows`, `partition_fields` (`backend/app/models/dataset.py:64-265`; ORM `backend/app/repositories/metadata/dataset_record.py:20-83`).

### 3.2 The two SQL representations
Each `Dataset` exposes `staging_sql` (compact, `read_parquet()` against S3 — used by the engine) and `display_sql` (pretty, dataset-name alias — shown in UI), both via `backend/app/models/dataset_sql.py` (`docs/domain/dataset-lifecycle.md:67-73`). Note the API serializes `display_sql` *under the key* `staging_sql` (`backend/app/models/dataset.py:249`) — a deliberate-but-confusing naming choice for consumers.

### 3.3 dbt project generation — the 4-layer archive · **IMPLEMENTED & WIRED**
`generate_dbt_project_zip()` (`backend/app/use_cases/project/_dbt/__init__.py:68-178`) emits a complete, `dbt run`-ready project:

| Artifact | Generator | Notes |
|---|---|---|
| `dbt_project.yml` | `project_yml.py` | project scaffold |
| `profiles.yml` | `profiles_yml.py` | DuckDB profile |
| `models/staging/sources.yml` | `sources_yml.py:11-40` | each source → `meta.external_location: s3://…/{storage_path}**/*.parquet` (`:25-26`) |
| `models/staging/stg_{name}.sql` | `model_sql.py:51-105` | Ibis-compiled; `SELECT * FROM {{ source(...) }}` passthrough when no transforms (`:69`) |
| `models/intermediate/int_{name}.sql` | `intermediate.py:13-49` | views; structured-column path uses ibis `{{ ref() }}` compiler |
| `models/marts/{domain}/{fct,dim}_{name}.sql` | `marts.py:11-32` | reports; ref-id via `str.replace` (`:26-29`) |
| `models/schema.yml` | `schema_yml.py:110-151` | constraint-driven dbt tests: `not_null`, `unique`, `accepted_values`, `dbt_utils.expression_is_true` |
| `packages.yml` | `packages_yml.py` | conditional — only when `dbt_utils` tests are emitted |
| `macros/custom_functions.sql` | `macros_sql.py` | `title_case`, `snake_case`, `kebab_case` DuckDB macros |
| `macros/plugin_{name}.sql` | per-plugin `dbt_macros` | e.g. HL7v2 `parse_hl7_date` |
| `scripts/bootstrap_db.sql` | `bootstrap_sql.py:63-115` | pg_duckdb views over S3 Parquet |
| `README.md` | `readme.py` | usage |

**Ibis → dbt Jinja (ADR-007 / ADR-026):** `IbisDbtSourceDuckDBCompiler` overrides `visit_UnboundTable` to emit `{{ source('project','dataset') }}` at the FROM position (`backend/app/use_cases/project/_dbt/ibis_dbt_source.py:113-159`); `IbisDbtRefDuckDBCompiler` emits `{{ ref('model') }}` for intermediate models (`:63-110`); a legacy text path uses `substitute_ref_ids_in_text()` (`:218-246`). This is how a no-SQL-from-the-LLM design still produces idiomatic dbt.

### 3.4 DuckDB / pg_duckdb (ADR-003) — query + external access · **IMPLEMENTED**
- **Preview / transform execution:** asyncpg pool to a persistent pg_duckdb service (`backend/app/database.py:93-135`); `Dataset.query_preview_rows()` runs the full transformed staging SQL via `COPY FROM duckdb.query()` against live S3 Parquet (`backend/app/models/dataset.py:179-221`), installing a MinIO `PERSISTENT SECRET` on first use (`database.py:118-134`).
- **External SQL access:** `POST /api/projects/{id}/sql-access` provisions a per-project pg_duckdb schema (`project_{id[:8]}`) with Parquet-backed views; external BI/ODBC clients connect over the Postgres wire protocol, PgBouncer pools connections (`docs/domain/dataset-lifecycle.md:80-88`; use cases in `backend/app/use_cases/sql_access/`).

### 3.5 Views & reports (downstream of datasets) · **IMPLEMENTED**
`use_cases/view/` (joins, grain, materialization; `ViewIbisCompiler`) and `use_cases/report/` (dimensions, measures, materialization; `ReportIbisCompiler`, column validation) build the dependency graph that feeds the intermediate + marts dbt layers (`docs/domain/dataset-lifecycle.md:90-97`).

### 3.6 How you'd demo just the data/staging layer
1. `make up` (see §6 caveats) → seed via `backend/scripts/setup_dev.py` (dev org/project + MinIO buckets).
2. Upload a CSV (e.g. `e2e/fixtures/data/dirty-products.csv` is deliberately messy) → `POST /api/uploads`.
3. Show the catalog + column profiles (`GET /api/datasets`).
4. Chat: "trim whitespace on category, filter amount > 100, rename col" → transforms applied non-destructively; preview re-queried via pg_duckdb.
5. `GET /api/projects/{id}/export/dbt` → download a working dbt zip; show `stg_/int_/fct_` models + `sources.yml` external locations.
6. Optional: `POST /api/projects/{id}/sql-access` → connect `psql`/DBeaver on host port 5433 and `SELECT` the dataset.

---

## 4. Runtime Topology

### 4.1 Services (Docker Compose)
From `docker-compose.yml` + `docker-compose.override.yml`. Core services start on plain `docker compose up`; others are profile-gated.

| Service (compose) | Source | Image / build | Host:container | Role |
|---|---|---|---|---|
| `reverse-proxy` | `frontend/` | `dashboard-chat/reverse-proxy:bazel` | **5173**:80 | nginx — static assets + routing gateway (primary ingress) |
| `web-ssr` | `frontend/` | `dashboard-chat/web-ssr:bazel` | *expose* 3001 | Hono RRv7 SSR handler (internal only) |
| `auth-proxy` | `auth-proxy/` | `:bazel` (override builds `:ui-state-dev`) | **1042**:3000 | JWT verify + identity inject + multi-upstream routing |
| `api` | `backend/` | `:bazel` (override builds `:ui-state-dev`) | **8000**:8000 | FastAPI + SQLAlchemy + DuckDB |
| `agent` | `agent/` | `dashboard-chat/agent:bazel` | **1041**:8787 | chat/SSE via Groq |
| `ui-state` | `ui-state/` | built from `ui-state/Dockerfile` (no Bazel image yet) | **1043**:8788 | XState flow-state BFF |
| `query-engine` | infra | `pgduckdb/pgduckdb:16-main` | **5433**:5432 | pg_duckdb analytical engine over S3 Parquet |
| `minio` | infra | `minio/minio:latest` | **9000**/**9001** | S3 object store (Parquet + logs) |
| `redis` | infra | `redis:7-alpine` | **6379**:6379 | replay event log / presentation-state / flow events |
| `db` *(profile: full,postgres)* | infra | `postgres:18` | **5432**:5432 | Postgres (default dev uses SQLite) |
| `api-full` *(profile: full)* | `backend/` | source build, hot-reload | 8000:8000 | FastAPI against Postgres |
| `mirth` *(profile: healthcare)* | infra | `nextgenhealthcare/connect:4.5` | **8443**/**6661** | HL7v2→FHIR conversion |

**Synthea** is a *strategy* (ADR-012), not a service — synthetic FHIR is generated offline and uploaded through the normal pipeline.

### 4.2 Source-tree vs compose-service naming (ADR-033/034)
`backend/` → service **api**; `frontend/` → **two** services **reverse-proxy** + **web-ssr** (split lives in `frontend/BUILD.bazel`, not in two source dirs). `agent/`, `auth-proxy/`, `ui-state/` keep their names. The decoupling is deliberate; the source-tree name is canonical (`CLAUDE.md:9`).

### 4.3 Ingress / network path
```
Browser :5173 → reverse-proxy (nginx :80)
  ├─ /assets/*                      → nginx static (dist/client/)
  ├─ /worker/*                      → agent:8787 (direct; prefix stripped)
  ├─ /api/channels/*/presentation-state → agent:8787 (direct)
  ├─ /api/*                         → auth-proxy:3000 → api:8000
  ├─ /ui-state/*                    → auth-proxy:3000 → ui-state:8788
  └─ /* (catch-all)                 → web-ssr:3001 (SSR)
```
`api`, `ui-state`, `query-engine` also bind host ports for host-side pytest/tooling, but browser traffic flows through nginx → auth-proxy. `web-ssr` has **no** host port.

### 4.4 How a developer runs it
- Image build is **Bazel** (ADR-010), not `compose build`; Bazel-image services use `pull_policy: never`. `make up` → `bazel build //:all_images` → load reverse-proxy/api/agent/auth-proxy → `docker compose up -d` (`Makefile:9-16`). `make up-full` adds Postgres + hot-reload api.
- `ui-state` is the exception — it builds from its own Dockerfile (no Bazel image yet, `docker-compose.yml` comment ~:149).
- **Turbo** drives JS builds/tests only (`turbo.json`); it does not bring up the stack. There is **no root `npm run dev`** despite `CLAUDE.md` Quick Commands — only `dev:agent` exists; the real happy path is the Makefile.
- **Seed data:** `backend/scripts/setup_dev.py:81-129` (dev org `dev-org-001`, project `default-project-001`, MinIO buckets); `e2e/global-setup.ts:37-113` seeds a project + uploads `products.csv` for tests; static fixtures in `e2e/fixtures/data/`; `backend/sql/init-query-engine.sql` installs `httpfs` + roles. No committed Synthea data.

---

## 5. Current State: Implemented vs Partial vs In-Flight

| Capability / Area | Status | Evidence |
|---|---|---|
| Upload (CSV/Excel/FHIR/HL7v2) → Parquet → S3 | **IMPLEMENTED** | `routers/uploads.py:19-63`; `repositories/lake/repository.py:98-172` |
| JSON / Parquet as *input* formats | **ASPIRATIONAL** (advertised, not built) | `plugins/__init__.py:26-32` vs `vision.md:27`, `dataset-lifecycle.md:15` |
| Column profiling + preview rows | **IMPLEMENTED** | `_pipeline/ingestion.py:31-56` |
| Data catalog (datasets CRUD + search) | **IMPLEMENTED** | `repositories/metadata/repository.py:329-469` |
| 3-stage Ibis transforms (clean/filter/alias/map, non-destructive) | **IMPLEMENTED** | `models/dataset_sql.py:78-126`; `models/transform.py:15` |
| Chat agent — dataset/view/report tools (Groq, SSE) | **IMPLEMENTED** | `agent/lib/chat/handleChat.ts:144-159`; report tools wired despite vision "in progress" note |
| dbt export — 4-layer zip (sources→staging→intermediate→marts) | **IMPLEMENTED & WIRED** | `routers/projects.py:54-85`; `use_cases/project/_dbt/__init__.py:68-178` |
| Ibis → `{{ source() }}` / `{{ ref() }}` compilers | **IMPLEMENTED** | `_dbt/ibis_dbt_source.py:63-159` |
| External SQL access (pg_duckdb schema + views, PG wire) | **IMPLEMENTED** | `use_cases/sql_access/`; `dataset-lifecycle.md:80-88` |
| Views & reports (Ibis compilers, materialization) | **IMPLEMENTED** | `use_cases/view/`, `use_cases/report/` |
| HL7v2 ingestion | **PARTIAL** (needs external Mirth; raises if `MIRTH_CONNECT_URL` unset) | `plugins/hl7v2_plugin.py:60-62` |
| **ADR-046 `/state` migration MR-1…MR-5** | **DONE (IN-FLIGHT epic)** | commits `edbd9b5,ee91a48,0b5efe1,5fa457f,6b119d0`; `ui-state/index.ts:122-124`; `frontend/app/root.tsx:83-101` |
| ADR-046 MR-6 (acceptance migration to `/state`) | **PENDING** | acceptance suites still hit `/projection` (`tests/acceptance/user-flow-state-machines/harness/…ts:268,430,510`) |
| ADR-046 MR-7 (delete legacy per-machine surface + fallbacks) | **PENDING** | `ui-state/index.ts:67-76`; `auth-proxy/app.ts:558-604` (flat fallback marked "Retired at ADR-046 MR-7") |
| Stage 3 PREVIEW — Vizro dashboards, in-chat grid mockup, hot reload | **ASPIRATIONAL** | `vision.md:45-83`; no wired code |
| `planner/` (Vizro generation engine) | **SCAFFOLD / UNWIRED** (placeholder charts) | `planner/planner/schema/vizro_builder.py:32-50`; absent from compose |
| DuckDB-WASM in-browser query | **ASPIRATIONAL** | no `duckdb-wasm` anywhere in `frontend/` |
| Stream.io session-event persister | **NOOP / DEFERRED** (Redis is the only live impl) | `agent/lib/chat/threadPersisterDispatch.ts:6`; `backend/app/use_cases/session/event_replay.py:8-9` |
| WorkOS ↔ backend org sync | **TODO** (stores can drift) | `ui-state/lib/machines/onboarding/machine.ts:151` |
| ADR-040 LEAF-4/5/6 (hexagonal transport finish) | **DEFERRED** | `docs/feature/ui-state-hexagonal-transport/deliver/leaf-3-progress.md:12-14` |
| `dashboard_chat_sdk/` | **DISTRIBUTION ARTIFACT** (not internally wired) | `dashboard_chat_sdk/README.md:4` |
| CI (GitHub Actions) | **DISABLED** (quota) — merge-queue gate runs locally | `.github/workflows/ci.yml:6` |
| E2E Playwright suite | **IMPLEMENTED but manual + partly stale selectors** | `e2e/BUILD.bazel` tags; `e2e/smoke.spec.ts:25` |
| Root `README.md` | **STALE** (Cloudflare-Workers epoch) | `README.md:30-39,113-127` |

**The one big moving piece:** ADR-046's `/state` cutover. MR-1…MR-5 are merged (the new `/state` document, the FE `StateProxy`+`useSelector`, the auth-proxy KPI sniffer). **MR-6 (acceptance) and MR-7 (cleanup) are not done**, so the system intentionally runs **two parallel ui-state surfaces** right now: the new `/state` actor surface *and* the legacy per-machine `/flow/:machine/projection` wire + auth-proxy's flat-shape fallback. This is a clean-cutover sequencing decision, not breakage — but it means anchors in `ui-state/`, `frontend/`, and `auth-proxy/` are the most likely to shift.

---

## 6. Demo-Readiness

**Can the system run end-to-end (upload → catalog → dbt project) today? — YES.** Stages 1, 2, and 4 are implemented and wired through real services. The dbt handoff and SQL-access paths are the strongest demo material.

**To demo the data/staging layer specifically:**
- **Services:** `reverse-proxy`, `api`, `agent`, `auth-proxy`, `query-engine` (pg_duckdb), `minio`, `redis`. (`ui-state` is needed for the full chat-app onboarding UI but not for the raw upload→catalog→dbt API path.)
- **Bring-up:** `make up` (builds + loads Bazel images, then `docker compose up -d`).
- **Seed:** run `backend/scripts/setup_dev.py` for a dev org/project + MinIO buckets; demo CSVs in `e2e/fixtures/data/`.
- **Flow:** the six steps in §3.6.

**Known blockers / caveats to rehearse before a live demo:**
1. **`web-ssr` image-load gap.** `//frontend:ssr_image_tar` is **not** in the Makefile `load` step nor the root `BUILD.bazel` `all_images` filegroup, and the Makefile still references a stale `//reverse-proxy:image_tar` path. The `web-ssr` container can fail to start unless you `bazel run //frontend:ssr_image_tar` separately. *(Verify against the current Makefile before demoing the full browser UI; the headless API path — upload/catalog/dbt via curl or the SDK — sidesteps `web-ssr` entirely and is the safest demo.)*
2. **HL7v2 needs Mirth** (`healthcare` profile + `MIRTH_CONNECT_URL`); demo with **CSV/Excel/FHIR** instead.
3. **No committed seed datasets** beyond small e2e fixtures — bring your own CSV or generate Synthea output offline.
4. **CI is disabled** (quota); correctness rides on the local merge-queue gate (`tools/test/test.sh --auto`) — fine for a demo, relevant for stakeholder confidence questions.
5. **Do NOT promise Stage 3** (dashboard preview / Vizro / DuckDB-WASM hot reload) — it is not implemented. The deliverable to show is the **dbt project + SQL endpoint**, which *is* the product's actual handoff value proposition.

**Honest verdict for the stakeholder's "can we demo the staging data layer?":** **Yes — confidently.** Upload → Parquet/catalog → chat transforms → 4-layer dbt export → live pg_duckdb SQL all work in code today and are covered by acceptance tests (`tests/acceptance/dbt-test-validation-v2`). The safest, highest-signal demo is the **headless API path** (curl/SDK or a scripted walkthrough) which avoids the `web-ssr` load gap; a full browser walkthrough is also possible once the SSR image is loaded. Avoid the dashboard-preview narrative entirely — it is roadmap, not reality.

---

## References

**Product / intent**
- `docs/vision.md` — 4-stage prototyping vision (upload/model/preview/handoff)
- `docs/domain/dataset-lifecycle.md` — canonical data-path narrative
- `docs/requirements/` — NFRs (dbt validity H1, SQL latency H2, PG wire H3, multi-tenancy, etc.)
- `README.md` — **stale**, superseded by `docs/vision.md`

**Core data path (backend)**
- `backend/app/routers/uploads.py`, `projects.py`, `datasets.py`, `transforms.py`, `sql_access.py`
- `backend/app/use_cases/upload/upload_file.py`, `dataset/create_dataset_from_upload.py`, `dataset/_pipeline/{ingestion,plugin_dispatch}.py`
- `backend/app/use_cases/project/_dbt/` — `__init__.py`, `ibis_dbt_source.py`, `model_sql.py`, `schema_yml.py`, `sources_yml.py`, `intermediate.py`, `marts.py`, `bootstrap_sql.py`
- `backend/app/models/{dataset,dataset_sql,transform,view,report}.py`
- `backend/app/repositories/{metadata,lake}/`, `backend/app/database.py`, `backend/app/plugins/`

**Other components**
- `agent/index.ts`, `agent/lib/chat/handleChat.ts`, `agent/lib/chat/*ToolDefinitions.ts`
- `auth-proxy/app.ts`; `ui-state/index.ts`, `ui-state/lib/machines/`; `shared/chat/`
- `frontend/app/{root.tsx,routes.ts}`, `frontend/{main.tsx,ssr.ts,BUILD.bazel}`
- `planner/` (standalone), `dashboard_chat_sdk/` (artifact), `e2e/`, `features/`, `tools/test/test.sh`

**Runtime**
- `docker-compose.yml`, `docker-compose.override.yml`, `Makefile`, `turbo.json`, `backend/scripts/setup_dev.py`, `backend/sql/init-query-engine.sql`

**Load-bearing ADRs**
- ADR-002 Groq · ADR-003 DuckDB/pg_duckdb · ADR-004 SSE · ADR-007 + ADR-026 Ibis as SQL compiler · ADR-008 MinIO/S3 · ADR-010 Bazel · ADR-012 synthetic-first healthcare · ADR-014 ChatEvent stratification · ADR-020 metadata-repository split · ADR-022 upload-pipeline modularity
- ADR-027/028/030 flow-state tier + XState v5 · ADR-033 source-tree/topology separation · ADR-034 RRv7 framework mode · ADR-043 retire ui-state token lifecycle · ADR-044 ChatApp coordinator · ADR-045 (superseded) · **ADR-046 StateProxy actor surface (in-flight)**

---

*Generated during the RESEARCH wave. Report only — no source changed, no recommendations-as-changes. Anchors into actively-migrating trees (`ui-state/`, `frontend/`, `auth-proxy/`, `tests/acceptance/`) reflect the 2026-05-29 snapshot.*
