# JTBD Job Stories — `project-and-chat-session-management` (J-002)

> **Wave**: DISCUSS
> **Date**: 2026-05-13
> **Author**: Luna (nw-product-owner)

Concrete job stories Maya (and every other returning user) is trying
to accomplish *inside* J-002's scope. These compose under the
**strategic** JOB-002 ("Drive every user flow through a server-owned
state machine that UI and tests share"); they are not strategic jobs
in their own right.

Each job story uses the format **"When [situation], I want to
[motivation], so I can [outcome]."** Every user story (US-201..US-209)
in this wave traces to at least one job story below.

---

## J002-Job-1 — Resume

> **When I sign in as a returning user with at least one project in
> my org, I want to land on my last-used project's chat surface (not
> a bare app shell), so I can resume where I left off without
> hunting through a project picker.**

* **Functional dimension**: The single best concrete action — pick
  the right project automatically — is mechanically achievable from
  recent session activity (`session.last_active_at` per
  `backend/app/use_cases/session/update_session.py:51`).
* **Emotional dimension**: "The app remembers me." Returning users
  who confront a project picker every morning feel the app is
  treating them like a stranger.
* **Social dimension**: When a colleague asks "where's that analysis
  from yesterday?" the answer is "I'll show you in 3 seconds" — not
  "let me find the right project first."

Traces to: **US-202** (returning user lands in last-used project).

## J002-Job-2 — Switch projects without bleeding context

> **When I switch from project A to project B within my org, I want
> the chat session list, project chip, and any in-flight chat-turn
> dispatch to all atomically retarget to project B, so I never see
> a stale state where the chip says B but the session list still
> shows A's sessions.**

* **Functional dimension**: The retarget happens at the
  ScopeResolver boundary — `active_scope.project_id` is the single
  thing that changes, and every consumer reads from that one source.
* **Emotional dimension**: "When I navigate, the app navigates with
  me." The canonical bug class this retires is the ChatView
  project-context race (`adr-027:14`); the feeling it produces is
  "did I click the wrong thing?"
* **Social dimension**: When teaching a colleague the product, the
  switch is one click and one paint; not "wait, refresh — there it
  is."

Traces to: **US-207** (project switching atomically updates scope
and consumers).

## J002-Job-3 — Open a deep link cold

> **When I open a deep link to a project I have access to (cold load,
> fresh tab), I want active_scope to resolve to that project before
> any chat turn lands, so the first thing I see is the right project
> — not a chat-shell that paints with stale or empty state and then
> resolves.**

* **Functional dimension**: Server-resolved scope per ADR-029. The
  Remix loader at `app/routes/projects.$projectId.tsx` reads the
  J-002 projection with `intent_project_id` derived from URL params;
  the ScopeResolver populates `active_scope` before render.
* **Emotional dimension**: "The link is the source of truth."
  Bookmarks and shared deep links to projects are common; Maya
  expects them to work without ceremony.
* **Social dimension**: When Maya shares a link with a colleague
  ("look at Q4 Analytics's first table"), the colleague's experience
  starts where Maya is, not in a generic empty state.

Traces to: **US-204** (deep-link cold load resolves scope before
paint).

## J002-Job-4 — Resume a specific session with its context restored

> **When I resume a prior chat session, I want the transcript AND
> the dataset context (if any) restored from the session's metadata,
> so the chat picks up exactly where it left off — including which
> dataset was being discussed.**

* **Functional dimension**: Session metadata carries
  `active_dataset_id` (or equivalent — DESIGN owns the storage
  shape per D11). J-002 reads it at session-resume time and
  materializes `active_scope.resource_type = "dataset" /
  resource_id`.
* **Emotional dimension**: "The conversation is intact." Asking a
  question about a column 10 minutes after closing the tab and
  being told "what's a column?" is the failure mode that erodes
  trust.
* **Social dimension**: Resumes work the same way from a colleague's
  shared link as from the user's own session list.

Traces to: **US-205** (session resume restores transcript + dataset
context).

## J002-Job-5 — Start a fresh conversation cleanly

> **When I click "New Session" from any state, I want to land in a
> welcome state with the project's chip visible AND suggestion chips
> ready (Upload CSV, Browse Projects), so I can start typing or
> click a suggestion within a second of clicking the nav.**

* **Functional dimension**: The "New Session" affordance transitions
  J-002 to `creating_new_session → session_active_no_messages`. The
  session row is created lazily on the first message per D11; the
  welcome state is paintable instantly because it carries no
  outstanding writes.
* **Emotional dimension**: "I'm in a fresh start, but the app still
  knows where I am." The project chip stays visible; the suggestion
  chips orient the user without committing them.
* **Social dimension**: "Click New Session" is teachable in one
  sentence and consistent across the app per
  `features/chat-first-ui.feature:36-41`.

Traces to: **US-206** (new session lifecycle).

## J002-Job-6 — Stay scoped during a chat turn

> **When I type a chat turn (any turn — first or hundredth in a
> session), I want the chat-agent to receive active_scope.{org_id,
> project_id} from the SAME source the FE chrome reads, so the agent
> never operates on a project_id different from the one my UI is
> showing.**

* **Functional dimension**: ADR-029 §4 — every agent invocation
  carries `X-Active-Scope` from J-002's projection; agent rejects
  turns missing `org_id` or `project_id` with 400.
* **Emotional dimension**: "Trust." If a chat-turn answers with data
  from a different project than the one the user thinks they're in,
  the failure is silent and corrosive — the user might not detect
  it for hours.
* **Social dimension**: Cross-team safety. Two analysts in the same
  org working on two projects can chat without poisoning each
  other's results.

Traces to: **US-208** (agent invocation carries `active_scope` from
J-002's projection; agent rejects missing scope).

## J002-Job-7 — Switch dataset context inside a session

> **When I'm in a chat session with no dataset attached and I ask
> "filter rows where age > 30", I want the agent to surface a
> dataset picker, AND when I pick one, I want the conversation to
> continue with that dataset attached — not as if I had started a
> new session.**

* **Functional dimension**: The agent's `resolve_dataset` tool-call
  (`agent/lib/chat/tools.ts:13-22`) returns a tool-input-available
  chunk that `pipeChatStream` intercepts and emits as a
  `data-agent-request` typed part (`agent/lib/chat/handleChat.ts:99-104`).
  The FE consumes the part and emits a `dataset_resolved_by_agent`
  event to J-002. J-002 transitions through
  `switching_dataset_context` and updates `active_scope.resource_*`.
  The chat turn is re-submitted with the new scope.
* **Emotional dimension**: "The assistant figures out what I mean."
  The conversational shape is preserved — no jarring
  "please-pick-a-dataset" modal that breaks the chat flow.
* **Social dimension**: New users can learn the dataset-resolution
  affordance by doing it once.

Traces to: **US-209** (dataset context switching via agent's
`resolve_dataset` OR direct selection).

## J002-Job-8 — Survive a token expiry without re-submitting

> **When my JWT expires mid-J-002-mutation (e.g., I just clicked a
> session in the recent-sessions list and the project switch is
> in-flight), I want the action to NOT be lost — it should pause,
> the silent re-auth should complete, and then the action should
> finish — without me re-clicking the session.**

* **Functional dimension**: J-002's machine declares a `FREEZE`
  handler that pauses outgoing mutations (per ADR-028 §"Decision
  outcome"). The orchestrator's replay buffer queues the intent
  event with the original `correlation_id`; on `THAW` the intent is
  re-sent.
* **Emotional dimension**: "I don't think about tokens." Mid-task
  token expiry is silent; chat input and session list stay live
  until the freeze resolves.
* **Social dimension**: This invisible robustness is what makes the
  app feel professional — users who never notice token expiry tell
  others "the app just works."

Traces to: **US-210** (cross-machine FREEZE/THAW participation).

---

## Job-story-to-user-story bridge

Every user story below cites at least one job story above. This is
the **JTBD-to-Story Bridge** that the `nw-discuss` skill requires
(Phase 1 step 5):

| User Story | Title | Job stories cited |
|---|---|---|
| US-201 | First-time-in-org user lands in no-projects empty state | J002-Job-1 (degraded — Maya has no project to resume yet) |
| US-202 | Returning user lands in last-used project on sign-in | J002-Job-1 |
| US-203 | Project's session list renders sorted by recency on project entry | J002-Job-1, J002-Job-5 (suggestion chips visible when no session is active) |
| US-204 | Cold deep-link to a project resolves active_scope before paint (covers cross-tenant rejection too) | J002-Job-3 |
| US-205 | Resuming a session restores transcript and dataset context | J002-Job-4 |
| US-206 | New session lifecycle (lazy create + title from first message) | J002-Job-5 |
| US-207 | User switches projects within an org — scope atomically retargets | J002-Job-2 |
| US-208 | Chat-agent invocation carries `active_scope` from J-002's projection | J002-Job-6 |
| US-209 | Dataset context switching via `resolve_dataset` OR direct selection | J002-Job-7 |
| US-210 | J-002 honors FREEZE/THAW from J-001's `expired_token` | J002-Job-8 |

Every story in `stories/US-*.md` carries the job-story citation in
its frontmatter (`Job mapped: J002-Job-N`).
