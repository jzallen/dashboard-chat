# JTBD Four Forces — `project-and-chat-session-management` (J-002)

> **Wave**: DISCUSS
> **Date**: 2026-05-13

For each primary J-002 job story, the four forces shaping adoption.
The **push** (current frustration) and **pull** (desired future) are
the demand side; **anxiety** (adoption concerns) and **habit**
(current behavior the new flow must displace) are the friction side.

Evidence for the forces is drawn from in-repo artifacts: the
`features/chat-first-ui.feature` Gherkin (canonical product
behavior), the research at
`docs/research/user-flow-inventory-and-gaps.md` (especially §4
Candidate 3 and §5 Prioritization rationale), and the J-001 deliver
log (which named the ChatView project-context race as a recurring
real-world bug).

---

## J002-Job-1 — Resume

| Force | Detail | Evidence |
|---|---|---|
| **Push** | A returning user opens Dashboard Chat and lands on the bare app shell or a generic landing page. They have to click into "Projects," scan the grid, find their most recent project, click it, then click into the most recent session. This is 3–4 clicks of "the app forgot who I am." | `frontend/app/routes.ts:18-34` — the app-shell layout's `index` route renders `chat.tsx` (a generic ChatView shim) with no pre-resolved project. The "Recent sessions in nav" affordance at `features/chat-first-ui.feature:64-68` lists sessions but no last-used-project signal. |
| **Pull** | The first thing the returning user sees after sign-in is their last-used project's chat surface — project chip painted, session list visible, suggestion chips ready. They feel resumed in <2 seconds. | `features/chat-first-ui.feature:109-113` says session resume restores the dataset context from session metadata — establishes the user-experience expectation that resume is a first-class affordance. |
| **Anxiety** | "What if it picks the wrong project? What if it picks a project I'd archived?" Users want last-used to be deterministic and overridable — never a guess. | The session list's "most recent first" ordering (`features/chat-first-ui.feature:60`) is the deterministic anchor; J-002 picks the project whose most-recent session is the most recent across all the user's projects. Tied — not a guess. |
| **Habit** | The current habit is to bookmark a deep link to a specific project's first table view (`/projects/{projectId}/datasets/{datasetId}` per `frontend/app/routes.ts:24-27`). Users have learned to compensate for the missing resume affordance. | The deep-link affordance is exactly what J002-Job-3 (US-204) preserves. The new resume flow displaces the bookmarking habit gradually — bookmarks still work, but the morning-routine click is replaced by the auto-resume. |

## J002-Job-2 — Switch projects without bleeding context

| Force | Detail | Evidence |
|---|---|---|
| **Push** | The canonical bug class named at `adr-027:14` is the ChatView project-context race — Maya switches project and the chat input is briefly bound to the old project's session list, or vice versa. She has seen the chip update before the body, or the body update before the chip. The feeling is "did I click the wrong thing?" | `journey-inventory.md:281-289` (J-001 wave) explicitly cites this as the canonical state the framework retires. ADR-029 §1 invariant 1 + Round-2 D9 codify the fix. |
| **Pull** | A click changes project A → project B. Within ≤300ms: project chip updates, session list updates, any in-flight chat-turn dispatch retargets, suggestion chips render fresh. ALL on the same paint. | ADR-029's "no FE component reads `org_id` or `project_id` from anywhere other than `active_scope`" invariant. The Remix loader pattern at `adr-029:60-92` is the implementation primitive. |
| **Anxiety** | "What about my in-flight chat turn?" Users want a switch to either complete the turn under the old project (safer) or cancel it cleanly (faster). The wrong shape is "the turn lands under project B's session with project A's prompt." | J-002's machine treats `switching_project` as a state that cancels any in-flight chat dispatch and refuses new dispatches until the switch completes. The agent contract from US-207 enforces this — turns missing `active_scope` are rejected with 400 (a switch that lost the scope is impossible to land at the agent). |
| **Habit** | Users today work around the race by full-page-refreshing after a project switch. The new flow displaces that habit by making the switch reliable without the refresh. | The first acceptance-test scenario for US-207 explicitly forbids a full-page-refresh between projects (no `route.reload()` calls). |

## J002-Job-3 — Open a deep link cold

| Force | Detail | Evidence |
|---|---|---|
| **Push** | Cold deep-links to `/projects/{projectId}` today land on the app-shell with no pre-resolved project context. The page renders, then a fetch happens, then the project chip updates, then the body re-renders. The user sees a brief "wrong project" or empty state. | `frontend/app/routes/project-detail.tsx` is a library-mode shim (no `loader` export) per `frontend/app/routes.ts:1-4` — the legacy `frontend/src/ui/components/ProjectDetailView` runs client-side. The cold-load behavior today is "render shell, fetch project, re-render." |
| **Pull** | The deep link is honored at first paint. Project chip, session list, page body all paint with the right values on the same frame. | ADR-029 §2 (Option D, the chosen framework path) — the Remix loader at `app/routes/projects.$projectId.tsx` reads the J-002 projection with `intent_project_id` derived from URL params before render. |
| **Anxiety** | "What if the URL is stale (project deleted) or cross-tenant (a colleague sent me a link to a project I lost access to)?" Users want a clear path — not a 500 page, not a silent redirect to the wrong place. | US-204b commits to a named-diagnostic rejection (403 from the projection endpoint with `scope mismatch: project belongs to a different org` per ADR-029 invariant 4). The error state UI surfaces a "this project is no longer accessible" panel with a return-to-projects-list CTA. |
| **Habit** | Users have learned to refresh-after-clicking-a-stale-link. The new flow displaces that habit by making the failure path deterministic. | The named-diagnostic surface ensures the user never sees a raw 403 / 500. |

## J002-Job-4 — Resume a specific session with its context restored

| Force | Detail | Evidence |
|---|---|---|
| **Push** | A user resumes a session, asks a follow-up about "the same table" — and the agent says "what's a column? You have no dataset attached." The session preserved messages but lost the dataset context, breaking the conversational continuity. | `features/chat-first-ui.feature:109-113` requires "the dataset context (if any) is restored from session metadata." Today, this is unimplemented (`backend/app/use_cases/session/update_session.py:50-52` allows only `title` and `last_active_at`). |
| **Pull** | Resume restores the transcript AND the dataset chip. The conversation continues as if no time had passed. | US-205 commits to this (the resume + dataset-context-restoration story); the J-002 machine reads session metadata at resume-time and materializes `active_scope.resource_*` from it. |
| **Anxiety** | "What if the dataset has been deleted since I last used it?" Users want a graceful resume — transcript restored, dataset-chip says "this dataset is no longer available," chat input still works in conversational mode. | J-002's `session_active` state has a graceful-degradation branch: `resource_id` from session metadata is validated at resume-time; if invalid, `active_scope.resource_*` is null and the dataset chip shows an empty-state. The conversation is NOT blocked. |
| **Habit** | Users today re-attach a dataset every time they resume a session by re-typing "the patients table" into chat. The new flow displaces that. | The reduction in friction is the proof of the pattern; users will stop the re-attach habit once they observe resume restores it for them. |

## J002-Job-5 — Start a fresh conversation cleanly

| Force | Detail | Evidence |
|---|---|---|
| **Push** | "New Session" today is a navigation event with no clear lifecycle — clicking it creates a session row eagerly and shows an empty chat. If the user closes the tab without typing, an empty session sits in their list forever. | The chat-first-ui.feature behavior of "session title defaults to first message" (`features/chat-first-ui.feature:142-145`) implies a lazy-creation shape — you can't title a session until there IS a first message. |
| **Pull** | "New Session" lands the user in a welcome state with suggestion chips visible. The session row is created lazily on the first message. Empty "ghost" sessions don't accumulate. | US-206 commits to lazy creation. The welcome-state chips (Upload CSV, Browse Projects) per `features/chat-first-ui.feature:71-76` orient without committing. |
| **Anxiety** | "What if I navigate away before typing — is my session lost?" Lazy creation means there's nothing to lose, but the user might worry about it. | The welcome state has no destructive affordance and no committed-row state — navigation away is free. The UI copy ("New conversation — what would you like to do?") makes this explicit. |
| **Habit** | Users today might create sessions, name them, and then never use them ("I'll come back to that"). Lazy creation removes the ceremony — sessions exist when they have content. | The historical pattern surfaces if implementation regresses; we'll see empty-session rows grow if lazy creation is broken. |

## J002-Job-6 — Stay scoped during a chat turn

| Force | Detail | Evidence |
|---|---|---|
| **Push** | Today, the FE passes `project_id` to the chat handler in the request body (`agent/lib/chat/handleChat.ts:75 + 33`). The agent reads it but does NOT validate it against the user's JWT — if a malformed client sends `project_id="project-of-a-different-org"`, the agent operates on it. There is no scope contract enforcement at the agent layer. | `agent/lib/chat/handleChat.ts:75` destructures `project_id` from the request body; no header-based scope reading; no rejection logic. |
| **Pull** | Every chat-agent invocation carries `X-Active-Scope` from the J-002 projection. The agent rejects turns missing `org_id` or `project_id` with 400 + named diagnostic. The agent NEVER operates on a project the JWT doesn't authorize. | ADR-029 §4 contract. US-208 wires it end-to-end. |
| **Anxiety** | Backwards-compat: existing curl-based or headless harness calls that pass `project_id` in the body might break. | A migration path: the agent reads scope from the header preferentially, falls back to the body for one release, then enforces header-only. The DISTILL wave's acceptance suite asserts the new shape. |
| **Habit** | Developer habit: writing acceptance tests today uses `DatasetLayerHarness.chat_turn(project_id=..., dataset_id=...)`. The new shape uses the TS harness's `assert_scope({...})` from US-004's Round-2 extension. | The Python harness's contract stays intact; the new TS harness composes on top. No habit is broken; a new one is added. |

## J002-Job-7 — Switch dataset context inside a session

| Force | Detail | Evidence |
|---|---|---|
| **Push** | `agent/lib/chat/tools.ts:13-22` exposes `resolve_dataset`. The agent returns a tool-input-available chunk; the FE intercepts it and shows a picker. Today, the FE state for "what dataset is currently in scope" lives in a TanStack Query key + a route param + a React Context — three places that can drift (the `ChatView project-context race` family). | `agent/lib/chat/handleChat.ts:99-104` confirms the tool-call is intercepted as `data-agent-request`. The FE state-management is the drift surface. |
| **Pull** | Dataset-context lives in `active_scope.resource_type/resource_id`. When the agent returns a `resolve_dataset` tool-call, the FE emits `dataset_resolved_by_agent` to J-002; J-002 updates `active_scope.resource_*` and the chat turn is re-submitted with the new scope. Single source. | US-208's contract; ADR-029's `active_scope` invariants. |
| **Anxiety** | "What if the user resolves to a dataset they don't have access to?" The ScopeResolver's invariant 4 (cross-tenant access is rejected) covers this — the J-002 machine surfaces the rejection as a `scope_reconciled` event, and the chat input shows "you don't have access to that dataset." | ADR-029 §1 invariant 4. |
| **Habit** | Today's habit: users re-type the dataset's name multiple times because the FE forgets the resolution. The new flow displaces that by persisting the resolution into `active_scope.resource_*` (and onto session metadata for resume — per J002-Job-4). | The reduction is observable in the second chat-turn within a session: the second `resolve_dataset` is unnecessary if the first succeeded. |

## J002-Job-8 — Survive a token expiry without re-submitting

| Force | Detail | Evidence |
|---|---|---|
| **Push** | Before J-001 shipped, every JWT expiry surfaced as a generic network error and dropped the request. Users re-submitted. | `docs/evolution/2026-05-12-user-flow-state-machines/discuss/user-stories.md` US-005 problem statement. |
| **Pull** | J-002 participates in the cross-machine FREEZE/THAW contract. Mid-mutation token expiry pauses J-002's mutations; silent re-auth completes; intents replay with the original `correlation_id`. The user never re-clicks a session or re-types a chat turn. | ADR-028 §"Decision outcome" specifies the replay-buffer shape. J-002 just declares a `FREEZE` handler. |
| **Anxiety** | "What if the silent re-auth takes too long?" The replay buffer has a 5-second timeout (ADR-027 §5). On timeout, the user's intent is preserved as a draft in the relevant UI (composer for chat turns; route param for project switches). | ADR-027 §5 replay-buffer contract. |
| **Habit** | The "tab refresh after a long-idle return" habit. J-001's `expired_token` retired this for chat turns; J-002's FREEZE/THAW retires it for J-002 mutations too. | The reduction is observable in mid-session refresh telemetry (K4 from J-001's KPI list extends to J-002 mutations). |
