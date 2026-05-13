# Visual Journey — J-002 Project + Chat Session Management

> **Wave**: DISCUSS
> **Date**: 2026-05-13
> **Persona**: **Maya Chen (returning)** for the deep-dive path;
> **Maya (first-time-in-org)** for the no-projects branch.

This is the human-readable companion to
`journey-project-and-chat-session-management.yaml`. The YAML is the
contract; this file is the emotional + visual narrative.

---

## Overall arc

> **Curious** (cold open) → **Oriented** (project chip + session
> list paint together) → **In-flow** (transcript, suggestion chips,
> dataset chip restoration) → **Confident** (chat turn lands with
> scope intact)

The big emotional inflection is between scenes 1 and 2: **the moment
the project chip appears tells Maya "the app remembers where I was."**
Everything after that is grounding — sessions, datasets, chat — and
J-002's job is to make each one paint without flicker.

---

## State map (TUI)

```
                     +-----------------------------+
                     |     J-001 ready (no chat)   |
                     +--------------+--------------+
                                    |
                                    v
                +-------------------+-------------------+
                |    resolving_initial_scope            |  ← entry point
                |   (reads: URL, J-001 session.current, |
                |    project list, last-used signal)    |
                +-+-----------+-----------+-------------+
                  |           |           |
              (zero       (project    (URL says
              projects)   resolved)   inaccessible)
                  |           |           |
                  v           v           v
        +---------+     +-----+----+   +------------------------+
        | no_     |     | project_ |   | scope_mismatch_        |
        | projects|     | selected |   | terminal               |
        +---+-----+     +-----+----+   +-----------+------------+
            |                 |                    |
   (create_project_clicked)   |              (back_to_projects)
            |                 v                    |
        +---v------+    +-----+--------+           |
        | creating_|    | loading_     |           |
        | project  |    | session_list |           |
        +----+-----+    +------+-------+           |
             |                 |                   |
        (project_created)      v                   |
             |          +------+--------+          |
             +--------> | session_list_ |          |
                        | visible       |          |
                        |  (or          |          |
                        |  no_sessions_ |          |
                        |  empty_state) |          |
                        +-+--+----+-----+          |
                          |  |    |                |
                  (session|  |    | (new_session   |
                  _clicked)  |    |  _clicked)     |
                          |  |    |                |
                          v  v    v                |
                +---------+--+----+------+         |
                | resuming_session       |         |
                +-----+------------------+         |
                      |                            |
                      v                            |
              +-------+---------------------+      |
              |       session_active        |◄-----+
              |  (transcript + dataset chip |
              |   restored from metadata)   |
              +-----+--+--+--+--+-----------+
                    |  |  |  |  |
               +----+  |  |  |  +----+
               |       |  |  |       |
               v       v  v  v       v
       +-------+-+  +--+--+-+  +-----+-----------------+
       |switching_| |session_| | switching_project     |
       |dataset_  | |active_ | | (invalidate session;  |
       |context   | |no_msgs | |  loop back to         |
       +----+-----+ +-+------+ |  loading_session_list)|
            |         |        +-----------------------+
       (dataset_      (first_                  |
       attached)      message_                 |
            |         sent)                    |
            +---------+                        |
                      v                        |
              +-------+--------+                |
              | session_active |◄---------------+
              +----------------+

Side-state (reachable from any J-002 state):
              +-----------+
              |  FREEZE   |  ← from J-001 expired_token
              +-----+-----+
                    |
                  (THAW)
                    v
            (last live state)
```

---

## Scenes

### Scene 1 — Cold open (entry from J-001 ready)

```
+-- dashboard-chat.app (cold-open after sign-in) ------------+
| [Acme Data ▾]                                  [Maya ▾]    |
+------------------------------------------------------------+
|                                                            |
|                Loading your workspace...                   |
|                                                            |
+------------------------------------------------------------+
```

**State**: `resolving_initial_scope`
**Emotional entry**: Anticipatory — Maya just clicked sign-in and
the app paint just started.
**Emotional exit (success)**: Oriented — the project chip is about
to appear.
**Emotional exit (failure)**: Mildly confused (no-projects case is
NOT a failure, it's its own scene; scope-mismatch is the failure).

The visible state is brief (< 200ms target for returning users with
a cached projection; up to ~800ms cold). The TUI deliberately does
NOT show the project chip blank or "Default Org" — those are
J-001's K2 invariants extended to J-002.

### Scene 2a — Returning user, project resolved

```
+-- /projects/q4-analytics --------------------------------+
| [Acme Data ▾] [Q4 Analytics ▾]                [Maya ▾]   |
+----------------------------------------------------------+
| Recent sessions               | Q4 Analytics             |
|  > What's avg rev by region   |  No session selected.    |
|  > Top 10 customers           |                          |
|  > Revenue trend Q3-Q4        |  What would you like     |
|  > Churn analysis             |  to do?                  |
|  > [+ New Session]            |                          |
|                               |  +--------+ +--------+   |
| Projects                      |  | Upload | | Browse |   |
|  + New project                |  | CSV    | | Project|   |
|  Q4 Analytics ●               |  +--------+ +--------+   |
|  Q3 Sales                     |                          |
|                               |  [type a message...]     |
+----------------------------------------------------------+
```

**State**: `session_list_visible` (or `no_sessions_empty_state` if
the project has zero sessions).
**Emotional state**: **Oriented**. The project chip ("Q4 Analytics")
paints simultaneously with the session list and the welcome chips.
No flicker.

**Shared artifacts visible**:
- `${active_scope.project_id}` → "Q4 Analytics"
- `${session.list}` → 4 prior sessions visible
- `${org.name}` → "Acme Data" (from J-001)
- `${user.display_name}` → "Maya" (from J-001)

### Scene 2b — First-time-in-org user, no projects

```
+-- / -----------------------------------------------------+
| [Acme Data ▾]                                 [Maya ▾]   |
+----------------------------------------------------------+
|                                                          |
|         Welcome to Acme Data, Maya!                      |
|                                                          |
|         Let's get started by creating your first         |
|         project. A project is a workspace for your       |
|         datasets, transforms, and chat sessions.         |
|                                                          |
|         +----------------------------------+             |
|         | Project name                     |             |
|         | +------------------------+       |             |
|         | | e.g., Q4 Analytics     |       |             |
|         | +------------------------+       |             |
|         +----------------------------------+             |
|                +---------------------+                   |
|                |  Create project     |                   |
|                +---------------------+                   |
|                                                          |
+----------------------------------------------------------+
```

**State**: `no_projects_empty_state`.
**Emotional state**: Curious-and-undeterred. The empty state is
explicitly NOT framed as a failure — it's the natural next step
after J-001 setup.

**Decision point**: Maya types a project name and clicks Create.
This transitions through `creating_project` (in-flight) →
`project_selected` (with the new project_id) → `loading_session_list`
→ `no_sessions_empty_state` (a fresh project has no sessions).

### Scene 3 — Resuming a session

```
+-- /projects/q4-analytics/sessions/chat-9b2a -----------+
| [Acme Data ▾] [Q4 Analytics ▾]              [Maya ▾]  |
+--------------------------------------------------------+
| > What's avg rev by region    ▼ │ ┌─ Maya ────────────│
|   Top 10 customers              │ │  what's avg rev by│
|   Revenue trend Q3-Q4           │ │  region           │
|   Churn analysis                │ │                   │
|   [+ New Session]               │ │ ┌─ Dashboard ─────│
|                                 │ │  | West   | $12M  │
|                                 │ │  | East   | $9M   │
|                                 │ │  | South  | $7M   │
|                                 │ │                   │
|                                 │ │ Maya              │
|                                 │ │  now filter to    │
|                                 │ │  > $10M           │
|                                 │ │ [...]             │
|                                 │ │                   │
|                                 │ │ [type a message...│
|                                 │ │   sales_2026 ▾] ──│  ← dataset chip restored
+--------------------------------------------------------+
```

**State**: `session_active`.
**Emotional state**: **In-flow**. Transcript is intact; dataset
context ("sales_2026") is restored from session metadata; chat
input ready.

**Shared artifacts visible**:
- `${active_scope.project_id}` → "Q4 Analytics" (unchanged from Scene 2a)
- `${session.id}` → "chat-9b2a"
- `${active_scope.resource_type}` → "dataset"
- `${active_scope.resource_id}` → id-for-sales_2026
- `${session.active_dataset_id}` → restored from session metadata

**Failure modes for this scene**:
- Dataset deleted since last session: dataset chip renders as
  "(no dataset)" + inline copy "the dataset for this session is no
  longer available." Transcript still renders.

### Scene 4 — Switching project (without bleeding context)

```
+-- /projects/q3-sales -----------------------------------+
| [Acme Data ▾] [Q3 Sales ▾]                  [Maya ▾]  |  ← project chip flipped atomically
+--------------------------------------------------------+
| Recent sessions             | Q3 Sales                 |
|  > Inventory forecast       | No session selected.     |
|  > Pricing review           |                          |
|  > [+ New Session]          | What would you like      |
|                             | to do?                   |
| Projects                    |                          |
|  + New project              | +--------+ +--------+    |
|  Q3 Sales ●                 | | Upload | | Browse |    |
|  Q4 Analytics               | | CSV    | | Project|    |
|                             | +--------+ +--------+    |
|                             |                          |
|                             | [type a message...]      |
+--------------------------------------------------------+
```

**State**: `session_list_visible` for project Q3 Sales.

**The invariant**: Maya clicked "Q3 Sales" in the nav (or via the
Projects grid, or via a deep link). Between the click and this paint,
J-002 went through `switching_project` → `project_selected` →
`loading_session_list` → `session_list_visible`. The project chip
flipped on the SAME paint as the session list — never one before the
other.

**Critical AC**: If Maya had a chat turn in flight for Q4 Analytics
when she clicked, that turn is cancelled at the FE boundary. It does
NOT land at the agent with Q4 Analytics's session_id but the X-Active-Scope
header for Q3 Sales (which would be the canonical drift bug).

### Scene 5 — Dataset context switching via agent's `resolve_dataset`

```
[ Maya (in session_active, no dataset attached) ]
  > filter rows where age > 30

[ Agent SSE stream returns tool_call: resolve_dataset(name="patients") ]

  +- pipeChatStream intercepts; emits data-agent-request ----+
  | Which dataset did you mean?                              |
  | • patients_2025                                          |
  | • patients_archive (read-only)                           |
  +----------------------------------------------------------+

[ Maya clicks "patients_2025" ]

[ FE emits dataset_resolved_by_agent → J-002 ]
  ┌─ switching_dataset_context ─────────────────────────────┐
  │ - ScopeResolver validates access to patients_2025       │
  │ - active_scope.resource_id = patients_2025-id           │
  │ - session.active_dataset_id = patients_2025-id          │
  └─────────────────────────────────────────────────────────┘
        ↓
[ Chat turn re-submitted with new X-Active-Scope ]
  > filter rows where age > 30
  → agent receives turn WITH active_scope.resource_id = patients_2025-id
  → agent dispatches filterTable tool with the correct dataset
```

**State traversal**: `session_active` → `switching_dataset_context`
→ `session_active` (with new `resource_id`).

**Emotional state**: **In-flow, undisrupted**. The picker is inline
in the chat (not a modal); the resubmission is silent; Maya sees the
filter applied as if the agent figured out which dataset to use
on its own.

### Scene 6 — Stale deep link (cross-tenant or revoked access)

```
+-- /projects/some-other-org-project ---------------------+
| [Acme Data ▾]                               [Maya ▾]   |
+--------------------------------------------------------+
|                                                        |
|         This project is no longer accessible.          |
|                                                        |
|         The project you linked to either doesn't       |
|         exist, was deleted, or belongs to another      |
|         organization.                                  |
|                                                        |
|                  +---------------------+               |
|                  |  Back to projects   |               |
|                  +---------------------+               |
|                                                        |
|         Reference: R-q3-bad-link-7c4f                  |
+--------------------------------------------------------+
```

**State**: `scope_mismatch_terminal`.
**Emotional state**: Mild surprise → reoriented (the "Back to
projects" CTA gives an immediate path forward; the correlation id
reference makes support contactable if needed).

**Critical**: The user sees this **instead of** ever rendering the
project's chrome with a placeholder or stale-org chip. ADR-029
§1 invariant 4 (`project belongs to a different org`) → 403 →
named-diagnostic UI.

### Scene 7 — Token expires mid-session-resume (FREEZE/THAW)

```
[ Maya in session_list_visible; clicks session "chat-9b2a" ]
   ↓
[ J-002 → resuming_session; intent is in-flight ]
   ↓
[ J-001's machine emits token_expired; orchestrator broadcasts FREEZE ]
   ↓
+-- /projects/q4-analytics -------------------------------+
| [Acme Data ▾] [Q4 Analytics ▾]              [Maya ▾]   |
+--------------------------------------------------------+
| Recent sessions             | ! Refreshing session...   |
|   ...                       |                           |
+--------------------------------------------------------+
   ↓
[ Silent re-auth completes; J-001 → ready; orchestrator broadcasts THAW ]
   ↓
[ J-002 resumes resuming_session WITH the original correlation_id ]
   ↓
[ Session "chat-9b2a" loads; Maya in session_active ]
```

**State traversal**: `session_list_visible` → `freeze` (transition
target was `resuming_session`) → `resuming_session` (re-entered
via replay) → `session_active`.

**Critical**: Maya does NOT re-click the session. The intent is
queued in the orchestrator's replay buffer with the original
correlation_id; on THAW it replays. From Maya's POV: she clicked a
session, saw a brief "Refreshing session..." banner, the session
loaded. Indistinguishable from a slow normal resume.

---

## Emotional arc coherence

* **Anticipatory (1) → Oriented (2a)** — the project chip's
  first-paint validates that the app remembered Maya.
* **Curious-undeterred (2b) → Confident-after-create (2b →
  creating_project → 2a)** — the empty-state copy is welcoming, not
  apologetic; the create-project step is short.
* **Oriented (2a) → In-flow (3)** — transcript loads with dataset
  chip on the same paint; no separate skeleton phases.
* **In-flow (3) → In-flow (4)** — project switch is atomic;
  no flicker, no orphan in-flight chat turn.
* **In-flow (3) → In-flow (5)** — dataset switching via the agent's
  resolve_dataset feels conversational, not modal.
* **In-flow (3) → Mild surprise → Reoriented (6)** — the
  scope-mismatch case is the only "negative" emotional path; it ends
  in a clear next step.
* **In-flow → Mild interruption → Restored (7)** — token expiry is
  invisible-by-default; the only visible signal is a sub-second
  "Refreshing..." banner.

The arc never sustains anxiety. Every J-002 state has a clear
emotional anchor and at most one transient anxiety beat (the in-flight
states).

---

## Failure modes summary (visible-to-user)

| Tag | User-visible | State |
|---|---|---|
| `j002_no_projects_in_org` | Scene 2b empty-state copy | `no_projects_empty_state` |
| `j002_stale_deep_link_cross_tenant` | Scene 6 panel | `scope_mismatch_terminal` |
| `j002_session_not_found` | Session disappears from the list silently; user can click another | `session_list_visible` (silent recovery) |
| `j002_dataset_access_denied` | Inline copy in chat input gutter: "you don't have access to that dataset" | `session_active` (silent recovery) |
| `j002_list_sessions_transient_failure` | "Couldn't load sessions — try again" + retry CTA | `error_recoverable` |
| `j002_create_project_validation_failed` | Inline form error | `no_projects_empty_state` |
| `j002_token_expired_during_mutation` | "Refreshing session..." banner; silent recovery | `freeze` → live state |

---

## Cross-references to existing artifacts

* **Gherkin product specs**: `features/chat-first-ui.feature` (esp.
  scenarios at lines 36-41, 64-68, 71-76, 84-87, 89-93, 109-113,
  135-145) — every behavior here is preserved or extended; nothing
  is broken.
* **J-001 contract**: `docs/product/journeys/login-and-org-setup.yaml`
  — J-002 reads `session.current` from `state.ready`'s exit payload.
* **ADR-027 / 028 / 029 / 030**: the architectural substrate; J-002
  obeys all four.
* **Research**: `docs/research/user-flow-inventory-and-gaps.md` §3 +
  §5 — the catalog-to-deep-dive promotion this wave performs.
