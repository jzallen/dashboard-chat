# Research: User Flow Inventory and Gaps

**Date**: 2026-05-13 | **Researcher**: nw-researcher (Nova) | **Confidence**: High | **Sources cited**: 22 files in-repo

## Executive Summary

Dashboard Chat's `ui-state/` tier today owns exactly **one** XState v5 flow machine — `login-and-org-setup` (J-001) — wired into the Hono orchestrator at `ui-state/index.ts:29-60`. The DISCUSS wave that introduced the tier (`docs/evolution/2026-05-12-user-flow-state-machines/`) catalogued seven sibling flows (J-002 through J-007) with named state-machine seeds, scope-dependency declarations, and emotional arcs, but did NOT deep-dive any of them; they sit as catalog stubs in `docs/product/journeys/_inventory.md:29-34`. Beyond the catalogued seven, the product surface (Gherkin features in `features/`, the agent's tool dispatchers in `agent/lib/chat/dispatchers/`, and the backend's use-case modules in `backend/app/use_cases/`) reveals additional flow-shaped behaviors (notably external SQL access / query-engine management) that the J-NNN inventory does not name.

The architectural substrate is ready to absorb more flows cheaply: ADR-027 ratifies the tier, ADR-028 ratifies XState v5 with the orchestrator-mediated actor model (and the cross-machine `FREEZE`/`THAW` contract that pays off once a second flow exists), ADR-029 ratifies the `active_scope` propagation contract, and ADR-030 ratifies single-replica topology behind auth-proxy. The `frontend-coexistence` wave's MR-0 (`frontend/app/routes.ts`) just landed RRv7 framework mode with all twelve routes as library-mode shims pointing at the legacy `frontend/src/ui/components/` tree; the SSR substrate is in place to grow a loader per machine.

The next flow to ship has the strongest cost-of-status-quo signal: **J-002 (project + chat session management)**, because the ChatView project-context race is named explicitly in ADR-027:14 as the canonical bug class the framework retires, and because every flow downstream of it (J-003..J-007) depends on `active_scope.project_id` per the dependency table at `docs/evolution/2026-05-12-user-flow-state-machines/discuss/journey-inventory.md:281-289`.

## §1 Frame & Method

### What "flow" means here
A flow in this codebase is a behavior modeled as an XState v5 machine in `ui-state/lib/machines/` and registered with the `FlowOrchestrator` (`ui-state/index.ts:49`), exposing a JSON `FlowProjection` envelope (shape defined at `docs/decisions/adr-027-flow-state-tier-and-framework.md:111-121`) read by both the FE and the TS harness. Per ADR-028:46-48, "no machine imports another machine"; cross-machine signals (`FREEZE`, `THAW`) are emitted via the orchestrator's `system.get(...)` enumeration. A flow's paired client surface is one or more RRv7 routes that read the projection via `useRouteLoaderData("root").active_scope` (ADR-029:62-79).

### Why this matters
ADR-028:94 frames the cross-machine actor model's payoff: "Cross-machine freeze (US-005) is a 5-line `system.get(...).send(...)` loop, not a hand-rolled pub/sub." That payoff is **zero with one machine** and **N² hand-rolled with N un-machined flows**. Every additional flow modeled here amortizes the substrate cost; every flow that stays implemented as React+TanStack reintroduces the drift class JOB-002 was scoped to retire (`docs/decisions/adr-027-flow-state-tier-and-framework.md:14`).

### Sources consulted
- Implemented machine: `ui-state/lib/machines/login-and-org-setup.ts`, `ui-state/index.ts`
- Wave artifacts: `docs/evolution/2026-05-12-user-flow-state-machines/discuss/{story-map.md,journey-inventory.md,user-stories.md,journey-login-and-org-setup.yaml}`
- ADRs: `docs/decisions/adr-{027,028,029,030,034}-*.md`
- Product SSOT: `docs/product/journeys/_inventory.md`
- Frontend routes: `frontend/app/routes.ts`, `frontend/app/routes/*.tsx`
- Frontend-coexistence wave: `docs/feature/frontend-coexistence/distill/roadmap.json`
- Agent tool surfaces: `agent/lib/chat/{tools.ts,viewToolDefinitions.ts,reportToolDefinitions.ts,dispatchers/index.ts}`
- Backend use cases: `backend/app/use_cases/{dataset,project,session,organization,view,report,sql_access,query_engine,upload,memory}/*`
- Product Gherkin: `features/*.feature`

## §2 Implemented Flows

Exactly **one** flow is wired today.

### J-001 — `login-and-org-setup`
- **Source file**: `ui-state/lib/machines/login-and-org-setup.ts:1-100` (+ helpers in `ui-state/lib/machines/validation.ts`)
- **Registry**: `ui-state/index.ts:23-60` — orchestrator constructor receives `loginMachineDeps`, `createOrgFn`, `reissueOrgJwtFn`; HTTP routes `POST /flow/:machine/begin`, `POST /flow/:machine/event`, `POST /flow/:machine/open-deep-link`, `GET /flow/:machine/projection` at `ui-state/index.ts:86-305`.
- **States (8)**: `anonymous → authenticating → authenticated_no_org → creating_org → ready`, plus side-states `error_recoverable`, `expired_token`, `error_terminal` (`ui-state/lib/machines/login-and-org-setup.ts:24-32`).
- **Paired routes** (RRv7 library-mode shims as of `frontend-coexistence` MR-0): `frontend/app/routes/login.tsx:1-7`, `frontend/app/routes/auth-callback.tsx`, `frontend/app/routes/create-org.tsx`, `frontend/app/routes/recoverable-error.tsx`, `frontend/app/routes/expired-token-banner.tsx` (declared at `frontend/app/routes.ts:14-17`).
- **Ratifying ADRs**: ADR-027 (tier + framework), ADR-028 (XState v5 actor model with seed example at `docs/decisions/adr-028-xstate-v5-actor-model.md:60-78`), ADR-029 (`active_scope` invariants — login is the *only* flow that produces rather than requires `org_id`, per `docs/evolution/2026-05-12-user-flow-state-machines/discuss/journey-inventory.md:281-289`), ADR-030 (single-replica topology).
- **Acceptance suite**: `ui-state/lib/machines/login-and-org-setup.test.ts` + `ui-state/lib/machines/validation.test.ts` (unit), and the wave's deliver-log at `docs/evolution/2026-05-12-user-flow-state-machines/deliver/execution-log.json` records end-to-end harness coverage.
- **Status**: Active, journey YAML promoted to SSOT at `docs/product/journeys/login-and-org-setup.yaml` (the only row in `docs/product/journeys/_inventory.md:18`).

No other flow is implemented. Do not list candidates here.

## §3 Named-but-Stubbed Flows

These six are named in `docs/product/journeys/_inventory.md:29-34` as J-002..J-007. Each has a journey-inventory entry (trigger, persona, emotional arc, state-machine seed, scope dependency) but **no machine file, no acceptance suite, no journey YAML**. The story-map at `docs/evolution/2026-05-12-user-flow-state-machines/discuss/story-map.md:155-189` carries one stub story (US-101..US-106) per flow.

| ID | Name | Stub story | State-machine seed (catalog) | Evidence |
|----|------|------------|------------------------------|----------|
| J-002 | Project + chat session management | US-101 | `project_chosen → loading_sessions → session_list_visible → session_selected` (+ `creating_new_session`, `no_sessions_empty_state`) | `docs/evolution/2026-05-12-user-flow-state-machines/discuss/journey-inventory.md:86-94`; story-map row at `story-map.md:154-159` |
| J-003 | Dataset upload (chat-driven + direct) | US-102 | `no_dataset → uploading → schema_inferring → bound_to_session` (+ `upload_failed`, `unsupported_format`) | `journey-inventory.md:114-122`; `story-map.md:161-165` |
| J-004 | Table / dataset preview | US-103 | `preview_loading → preview_rendered → interactive_idle ↔ sort_applied / filter_applied / column_hidden` | `journey-inventory.md:140-148`; `story-map.md:167-171` |
| J-005 | Transform toggles (preview/apply/undo) | US-104 | `transform_idle → previewing → confirming → applied ↔ undoing` (+ `transform_failed`, `validation_failed_pandera`) | `journey-inventory.md:166-178`; `story-map.md:173-178` |
| J-006 | View + report creation | US-105 | `view_compose_idle → defining → validating → materialized` (report is a sibling machine) | `journey-inventory.md:205-213`; `story-map.md:180-184` |
| J-007 | dbt export | US-106 | `export_idle → bundling → validating → ready_to_download` (+ `bundling_failed`) | `journey-inventory.md:228-237`; `story-map.md:186-189` |

### What's missing to reach Implemented for each
1. A DISCUSS pass producing a `journey-{slug}.yaml` promoted to `docs/product/journeys/`.
2. A DESIGN pass (the framework decisions are already settled in ADR-027/028/029/030 — subsequent dives inherit).
3. A DISTILL pass producing acceptance `.feature` files plus a roadmap.
4. A DELIVER pass producing the machine file at `ui-state/lib/machines/<slug>.ts`, the orchestrator registration in `ui-state/index.ts`, and a paired loader on the existing RRv7 routes.

The `journey-inventory.md:266-273` "existing harness coverage" column ranks J-003, J-005, J-007 as having **strong** existing harness — those dives can promote infrastructure rather than build from zero. J-006 (view+report) is flagged as having the **weakest** existing coverage.

### Cross-cutting concerns (not flows themselves)
`docs/product/journeys/_inventory.md:38-47` and `docs/evolution/2026-05-12-user-flow-state-machines/discuss/journey-inventory.md:246-260` explicitly carve **token expiry** out of flow-counting — it's the `expired_token` side-state every flow inherits — and **org switching** out as "future feature; framework must expose a reset-all-machines signal." Treat both as constraints on every machine, not separate machines to build.

## §4 Implied Flows from Product Surface

Behaviors evidenced by the product surface that the J-NNN inventory does **not** name. Each is a candidate for promotion to the inventory (if flow-shaped) or to remain as a use-case-direct CRUD path (if not).

### Candidate 1 — External SQL access enable/disable (project-scoped)
- **Evidence**: `features/external-data-access.feature:13-30` ("Enable SQL Access" → connection panel appears with host/port/database/credentials; "Disable" → panel hides; toolbar indicator state). Backend use cases at `backend/app/use_cases/sql_access/enable_sql_access.py`, `.../disable_sql_access.py`, `.../sync_sql_access.py`, `.../regenerate_sql_credentials.py`, `.../get_sql_access.py`.
- **Flow-shaped?** Borderline-yes. It is multi-step (enable → provision → ready → in-use → disable), it has visible intermediate states ("Active" indicator at `features/external-data-access.feature:17`, status updates without page refresh at `features/query-engine.feature:21-23`), and it crosses subsystems (sql_access service → pg_duckdb provisioner per `backend/app/use_cases/sql_access/_infra/pg_duckdb_manager.py`). Status-bearing across page navigations argues for a machine.
- **Not in inventory**: This behavior is invisible in `journey-inventory.md`.

### Candidate 2 — Query-engine node management (org-scoped)
- **Evidence**: `features/query-engine.feature:13-40` ("Engine status indicators" with statuses running / degraded / unreachable updating without page refresh; navigation to detail; connection-string copy). `frontend/app/routes.ts:31-32` declares `query-engines` and `query-engines/:nodeId`. Backend use cases at `backend/app/use_cases/query_engine/{seed_default_node,test_query_engine,sync_processor,list_query_engines,get_query_engine}.py`.
- **Flow-shaped?** Partially. The status-streaming requirement ("status updates appear automatically without requiring a page refresh", `features/query-engine.feature:22-23`) is the projection-streams use case that ADR-027:80 (`GET /api/flows/{flow_id}/projection/stream` SSE) was designed for. The "test connection" action is multi-step. **The presence of routes already wired in `frontend/app/routes.ts` plus the absence of a J-NNN entry is the most significant gap**: this surface ships HTTP routes but has no place in the flow inventory.

### Candidate 3 — Chat session lifecycle and dataset-context resolution
- **Evidence**: `features/chat-first-ui.feature:89-93` ("Chat prompts for dataset selection" when no dataset is context AND a table-op command is issued — chat displays inline dataset list, user picks, command is re-processed); `agent/lib/chat/tools.ts:13-22` exposes `resolve_dataset` as a conversational tool returning to FE for re-submission. The session-bound chat surface has its own use cases at `backend/app/use_cases/session/{create_session,update_session,list_sessions,list_session_events,event_replay,event_replay_dispatch}.py`. `features/chat-first-ui.feature:135-145` makes sessions org-scoped (NOT dataset-scoped) and allows dataset context to switch within one session.
- **Flow-shaped?** Strongly yes, and **already half-modeled by J-002** which folds "session management" in. The `resolve_dataset` re-submission loop, the welcome-state suggestion chips at `features/chat-first-ui.feature:71-76`, and the dataset-context restoration at `features/chat-first-ui.feature:109-113` ("Resume existing session" restores dataset context from session metadata) all suggest a richer machine than the catalog's `project_chosen → … → session_selected` seed captures. The journey-inventory entry at `journey-inventory.md:73-94` lumps "project + chat session management" together; the chat dataset-context loop may need its own substate or a sibling machine.

### Candidate 4 — Activity-check / token-refresh modal
- **Evidence**: `frontend/src/ui/components/ActivityCheckModal/index.tsx` and `frontend/src/ui/components/ActivityDebugBadge.tsx` exist; `features/token-refresh.feature:1-30` describes silent background refresh + 401-and-retry semantics.
- **Flow-shaped?** No. Per `docs/product/journeys/_inventory.md:40-43` and `journey-inventory.md:248-251`, token expiry is explicitly a cross-cutting concern modeled as the `expired_token` side-state of J-001 (already in the implemented machine at `ui-state/lib/machines/login-and-org-setup.ts:24-32`). Do NOT promote.

### Candidate 5 — Project memory / context-window persistence
- **Evidence**: `backend/app/use_cases/memory/get_project_memory.py` + `backend/app/use_cases/project/provision_project_memory.py`. Provisioned at project create-time.
- **Flow-shaped?** No (use-case direct). It's persistent state read on session bootstrap, not a multi-step user interaction. Treat as data feeding the J-002 projection, not a separate machine.

### Candidate 6 — Organization invite / membership
- **Evidence**: `backend/app/use_cases/organization/{create_organization,get_organization}.py`; no invite/membership use case exists yet. `features/` carries no membership scenario.
- **Flow-shaped?** Unknown — the product surface for invites does not yet exist. Tracked as a future surface; out of scope for current inventory.

### Candidate 7 — Project create/delete lifecycle
- **Evidence**: `backend/app/use_cases/project/{create_project,delete_project,update_project,list_projects,get_project}.py`. The "create new project" action is referenced in `features/chat-first-ui.feature:36-41` (New Session) but project-create itself is not yet Gherkin-covered.
- **Flow-shaped?** No (single-step CRUD with materialization side effects). The interesting state lives in J-002's "select-or-create project" prologue, which the existing catalog seed at `journey-inventory.md:86-94` covers as `project_chosen → loading_sessions`.

### Summary of §4 candidates
Two genuinely flow-shaped behaviors are missing from the J-NNN inventory: **external SQL access** and **query-engine node management** (Candidates 1 and 2). Both already have routes wired in `frontend/app/routes.ts:31-32` and `frontend/src/ui/components/SqlAccessPanel/` exists today, suggesting the FE has shipped these surfaces ahead of the flow-modeling pass. Three candidates (3, 5, 6, 7) are subsumed by existing inventory entries or are use-case-direct. Candidate 4 (token refresh) is correctly already a cross-cutting concern.

## §5 Recommended Prioritization

Opinionated ranking. Rationale weights the four criteria from the brief: reusability dividend (R), cross-machine pressure (X), customer pain (P), anticipated coupling (C).

### 1. J-002 — Project + chat session management
**(R: High, X: High, P: High, C: Highest)**

Every other flow on the catalog requires `active_scope.project_id` per `journey-inventory.md:281-289`. The ChatView project-context race named at `docs/decisions/adr-027-flow-state-tier-and-framework.md:14` is the canonical bug class JOB-002 was scoped to retire; J-002 is where that retirement actually happens. The actor-model `FREEZE`/`THAW` contract (ADR-028:46-48) is paid for by having **at least one second machine** that can observe J-001's `expired_token` — J-002 is the smallest such second machine. Stub seed states are already drafted at `journey-inventory.md:92-94`. Recommend this be the next DISCUSS dive.

### 2. J-003 — Dataset upload (chat-driven + direct)
**(R: High, X: Medium, P: Medium-High, C: High)**

`features/dataset-upload-chat.feature:1-53` and the existing `UploadsApi` harness coverage flagged as **strong** at `journey-inventory.md:267` mean the DISTILL acceptance work is mostly already written. The upload flow visibly crosses the agent (chat-initiated upload via the `+` action menu at `features/dataset-upload-chat.feature:10-15`) and the backend (the schema-infer wait state). Dataset is required scope for J-004 and J-005 per `journey-inventory.md:281-289` so coupling pressure is real. The "watch upload + schema infer" intermediate state at `story-map.md:38` is exactly the sort of slow-IO state where projection streaming pays off most visibly.

### 3. J-005 — Transform toggles (preview/apply/undo)
**(R: Highest, X: Medium, P: High, C: Medium)**

`journey-inventory.md:181-185` notes "this is the flow with the strongest existing server-side state (transform log is durable, replay-aware, idempotent)" — the substrate already exists and the machine would primarily formalize the *preview* sub-state. Existing transforms API + replay coverage is **strong** per `journey-inventory.md:271`. The preview/apply/undo pattern is the most XState-natural shape (clear interactive states with clear transitions), making it the highest-confidence early dive after J-002 demonstrates the framework's repeatability.

### 4. New addition — `sql-access` (project-scoped enable/disable + sync)
**(R: Medium, X: Low, P: Medium, C: Low)**

Candidate 1 from §4. The status-streaming requirement at `features/query-engine.feature:21-23` is the cleanest fit for the projection-SSE endpoint that ADR-027:80 already specifies but no machine consumes today. Promoting this to a J-008 entry in `docs/product/journeys/_inventory.md` formalizes a behavior that has FE routes (`frontend/app/routes.ts:31-32`) but no flow-layer ownership. Recommend a DISCUSS pass to validate flow-shape; if confirmed, dive after J-005.

### 5. J-007 — dbt export
**(R: High, X: Low, P: Low, C: Low)**

`journey-inventory.md:240-243` notes "ADR-019 / ADR-024 have already formalized much of this flow's backend state at the test-infra level; the FE machine here would be thin." This is the smallest dive remaining and a good capstone — but the customer pain is low (the existing acceptance suite at `tests/acceptance/dbt-test-validation-v2/` works) and the coupling pressure is low. Defer until J-002, J-003, J-005 are in.

### Deliberate de-prioritization
**J-006 (view + report)** is the weakest harness coverage per `journey-inventory.md:272`, which means it has the **largest dive cost** and the least amortizable infrastructure. Compounded by ADR-026's ibis-compiler refactor that just landed in `docs/decisions/adr-026-ibis-as-only-sql-compiler.md`, view/report composition is a moving target. Wait until the compiler stabilizes before modeling its flow.

**J-004 (table preview)** is closest to ADR-015's existing directive log per `journey-inventory.md:151-153`, which means the upgrade-to-machine question is "should we even bother?" — the directive log already covers most of the projection shape. Treat as later-stage cleanup.

## §6 Anti-Patterns to Avoid

Per ADR-027/028 the actor model carries real cost (XState complexity, Redis stream-per-actor at `docs/decisions/adr-027-flow-state-tier-and-framework.md:99-107`, orchestrator coordination, `FREEZE`/`THAW` participation). Three candidates should stay use-case-direct, not become machines:

### Anti-pattern 1 — Single-shot CRUD: project create, dataset rename, org get
Use cases like `backend/app/use_cases/project/create_project.py`, `backend/app/use_cases/dataset/update_dataset.py`, `backend/app/use_cases/organization/get_organization.py` are one-shot mutations. ADR-028:46-48 commits to "no machine imports another machine"; wrapping single-shot CRUD in a machine introduces actor-coordination overhead with zero `FREEZE`-payoff (a single-step mutation has no in-flight state to preserve across a token refresh). Keep them as direct API calls behind TanStack mutations; let J-002's machine *observe* their completion via the projection.

### Anti-pattern 2 — Project memory / context-window persistence
`backend/app/use_cases/memory/{get_project_memory.py}` and `backend/app/use_cases/project/provision_project_memory.py` represent persistent state the chat agent reads on each turn. This is **data**, not a flow — there is no multi-step user interaction with discernible states. Promoting it to a machine would force every chat turn through `system.get('memory').send(...)` for read-only data. Keep as a read model the J-002 projection includes; do not machine-ify.

### Anti-pattern 3 — Token refresh / activity check
`features/token-refresh.feature:1-30` describes a behavior `docs/product/journeys/_inventory.md:40-43` explicitly carves out: token expiry is a **cross-cutting constraint**, modeled as J-001's `expired_token` side-state (already at `ui-state/lib/machines/login-and-org-setup.ts:24-32`). Promoting it to a separate machine would duplicate the `FREEZE`/`THAW` plumbing that already lives in the orchestrator (ADR-027:126-135). The `ActivityCheckModal` component (`frontend/src/ui/components/ActivityCheckModal/`) should remain a presentation-layer reaction to the projection, not its own machine.

## §7 Open Questions

1. **Is the `sql-access` / `query-engine` surface intended to be a J-NNN flow, or to remain use-case-direct under the org/project settings UI?** `frontend/app/routes.ts:31-32` ships `query-engines` and `query-engines/:nodeId` routes today, and `features/query-engine.feature:21-23` requires status streaming, but no entry exists in `docs/product/journeys/_inventory.md`. Adding it would expand the canonical inventory; leaving it out keeps it as a status-polled CRUD surface. The repo does not decide.
2. **Does the chat surface (ChatView + agent SSE stream) compose with J-002, or does it need its own machine?** ADR-027 Round-2 D8 (cited at `docs/decisions/adr-027-flow-state-tier-and-framework.md:17-18`) says "the agent stays the chat brain" and is explicitly NOT a flow-machine host; but the `resolve_dataset` re-submission loop at `agent/lib/chat/tools.ts:13-22` and the welcome-state suggestion chips at `features/chat-first-ui.feature:71-76` add multi-step state the J-002 catalog seed (`journey-inventory.md:92-94`) does not obviously cover. The repo flags this as ambiguous at `journey-inventory.md:291-294` ("Cross-flow state-machine consumers MUST pull scope from `active_scope`, not from parallel re-derivations") but does not name a machine for the chat surface itself.
3. **Should multi-tenant org switching be a flow or a property of the `active_scope` contract?** `docs/product/journeys/_inventory.md:43-47` and `journey-inventory.md:253-259` both flag this as "future feature; framework must expose a reset-all-machines signal" — but a "reset-all" signal could equally well be modeled as an `org_switched` event J-001 emits with every other machine declaring a transition target, OR as a property of the orchestrator (which already does similar work for `FREEZE`/`THAW` per ADR-027:126-135). The repo does not decide.

## Source Analysis

| Source | Path | Type | Cross-verified |
|--------|------|------|----------------|
| Implemented machine | `ui-state/lib/machines/login-and-org-setup.ts` | code (implementation) | Y (matches journey YAML + ADR-028 example) |
| Orchestrator wiring | `ui-state/index.ts` | code (composition root) | Y |
| Story map | `docs/evolution/2026-05-12-user-flow-state-machines/discuss/story-map.md` | wave artifact | Y |
| Journey inventory | `docs/evolution/2026-05-12-user-flow-state-machines/discuss/journey-inventory.md` | wave artifact | Y |
| Journey SSOT | `docs/product/journeys/_inventory.md` | product SSOT | Y |
| ADR-027 | `docs/decisions/adr-027-flow-state-tier-and-framework.md` | architecture decision | Y |
| ADR-028 | `docs/decisions/adr-028-xstate-v5-actor-model.md` | architecture decision | Y |
| ADR-029 | `docs/decisions/adr-029-active-scope-propagation-contract.md` | architecture decision | Y |
| ADR-030 | `docs/decisions/adr-030-flow-state-topology-and-scaling.md` | architecture decision | Y |
| Frontend routes | `frontend/app/routes.ts` | code (route declarations) | Y |
| Frontend-coexistence roadmap | `docs/feature/frontend-coexistence/distill/roadmap.json` | wave artifact | Y |
| Agent tool definitions | `agent/lib/chat/tools.ts`, `viewToolDefinitions.ts`, `reportToolDefinitions.ts` | code (tool schemas) | Y |
| Agent dispatchers | `agent/lib/chat/dispatchers/index.ts` | code | Y |
| Backend use cases | `backend/app/use_cases/{dataset,project,session,organization,view,report,sql_access,query_engine,upload,memory}/*` | code | Y |
| Product Gherkin | `features/{chat-first-ui,dataset-upload-chat,table-chat-ops,data-cleaning-chat,token-refresh,external-data-access,query-engine,dbt-project-export}.feature` | acceptance (product-level) | Y |

All sources are in-repo and authoritative; no external citations required. Cross-reference between (a) the wave inventory at `journey-inventory.md:265-273`, (b) the SSOT at `docs/product/journeys/_inventory.md`, (c) the routes at `frontend/app/routes.ts`, and (d) backend use cases is the load-bearing triangulation.

## Knowledge Gaps

### Gap 1 — No journey YAML for J-002..J-007
**Issue**: The catalog entries at `journey-inventory.md` carry trigger/persona/emotional-arc/scope-dependency but stop short of step-by-step state contracts. **Attempted**: grep'd `docs/product/journeys/` (only `login-and-org-setup.yaml` exists). **Recommendation**: Each subsequent DISCUSS pass should land its journey YAML before the DESIGN pass begins.

### Gap 2 — sql-access / query-engine flow status
**Issue**: These surfaces exist in routes (`frontend/app/routes.ts:31-32`), features (`features/external-data-access.feature`, `features/query-engine.feature`), and backend use cases (`backend/app/use_cases/{sql_access,query_engine}/`), but are absent from the J-NNN inventory. **Attempted**: grep'd `docs/product/journeys/`, `docs/decisions/`, `docs/evolution/` for "sql-access" and "query-engine" — no ADR or journey artifact identifies these as flows. **Recommendation**: §7 Open Question 1 names this; needs an overseer decision.

### Gap 3 — Chat surface as its own machine vs. component of J-002
**Issue**: The chat ChatView, the agent's tool registry, and the J-002 catalog seed each describe overlapping state without explicit boundaries. **Attempted**: read `agent/lib/chat/dispatchers/index.ts:52-74` and `features/chat-first-ui.feature` end-to-end. **Recommendation**: §7 Open Question 2; resolution needed before J-002 dive begins.

## Research Metadata

Duration: ~45 min | Files examined: ~30 | Files cited: 22 | Cross-references: J-NNN inventory triangulated against routes, ADRs, use cases, and features | Confidence: High | Output: `docs/research/user-flow-inventory-and-gaps.md`
