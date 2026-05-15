# ui-state vocabulary + bounded-context audit — findings

**Status:** Findings document. NOT a decision; NOT a refactor dispatch.
**Date:** 2026-05-15
**Scope:** `ui-state/lib/machines/{project-context,session-chat}/machine.ts`; cross-machine events via `ui-state/lib/orchestrator.ts`; FlowEvent vocabulary in `ui-state/lib/projection.ts`; supporting `ui-state/lib/active-scope.ts`.
**Outside scope:** failure-simulation (ADRs 035-038), frontend, agent, backend, ui-state harness/test code beyond vocabulary references.
**Methodology:** static read of source + recently-landed ADR-028 / ADR-030 amendments (`5d45951`) + the divergence directions doc at `docs/discussion/session-chat-context-architecture/directions.md`. No code executed.

File-path note: Crafty's directory restructure (`refactor/machines-directory-structure`, landed `b2c3731`) is the current layout. Symbol names below are stable; paths reflect the post-restructure layout.

---

## 1. Bounded-context analysis

### TL;DR

`ui-state/` is **one bounded context** ("the user's current flow state, served as a BFF projection over a per-principal XState actor tree"). The project-context vs. session-chat **machine** split is **not** a bounded-context boundary; it's a Single-Responsibility split *inside* a shared ubiquitous language. Both machines, the orchestrator, and the projection use the same dictionary of terms (scope, intent, resource, session, project) — they have to, because `FlowProjection.context` (`projection.ts:39-118`) is a single flat record regardless of which machine produced the events.

This framing matters: language slip across the machine boundary is a **defect** (one bounded context should have one canonical meaning per term), not a context-map negotiation between two contexts.

### Where the real boundaries are

- `backend/` (functional use-cases; "project" = SQL row + ORM aggregate) — different bounded context.
- `agent/` (chat-loop; "session" = Groq conversation thread) — different bounded context.
- `frontend/` (RRv7 route loaders + composer) — different bounded context.
- **`ui-state/` is ONE context** spanning J-001 + J-002 glued by the orchestrator + projection.

The project-context/session-chat split inside ui-state is an SRP partition (DESIGN §2A/§2B, transcribed at `machine.ts:1-10` in both files). Both machines speak the same ubiquitous language because they're plumbed together by `orchestrator.ts` and produce events into the same `FlowProjection.context`.

### Language slips present today (detail in §5)

1. **`j001_` / `j002_` stale-identifier slip.** Events `j001_ready` (`orchestrator.ts:456,511`), `j002_resolution_started` (`orchestrator.ts:573`), `j002_recoverable_error` (`orchestrator.ts:1228`) encode the journey-numbering vocabulary that was renamed in source (`user-flow-state-machines/`, `project-and-chat-session-management/`).
2. **`intent_` prefix as pass-through scope leak.** `project-context.ts` carries `intent_resource_id`/`intent_resource_type` in `ProjectContextMachineContext` (`machine.ts:78-79`) **solely** to forward them to session-chat via the orchestrator's `project_ready` payload (`orchestrator.ts:432-434, 502-504`). LEAF-1 removed the symmetric pair from session-chat; project-context still carries them.
3. **Wire-name vs. machine-name drift.** `PROJECT_CONTEXT_WIRE_NAME = "project-and-chat-session-management"` (`orchestrator.ts:52`) is the Redis key prefix + HTTP path; source-tree name is `project-context`; journey ID in events is `j002_*`. Three names for the same thing, each load-bearing on a different surface (wire / source / event-log).
4. **"resource" polymorphic supertype vs. "dataset" alias.** `ResourceType = "dataset" | "view" | "report"` (`active-scope.ts:20`); session-chat context uses `resource: { type, id }` (`machine.ts:90`); but event names hard-code `dataset` (`dataset_resolved_by_agent`, `session_dataset_unavailable`, `dataset_unavailable` flag, cause tags `dataset_not_found` / `dataset_access_denied`).

---

## 2. Event nomenclature inventory

**Wire-protocol?** = does this name appear in the FlowEvent log such that `projection.ts:180` reducer consumes it (read by FE + acceptance harness). **Risk:** low = internal rename safe; med = needs coordination with multiple readers; high = wire-protocol stable, breaking change.

### XState machine events (internal to one machine)

| Event name | Emitted by | Wire? | Convention | Risk |
|---|---|---|---|---|
| `sign_in_clicked` | FE → login.anonymous | yes (`orchestrator.ts:300,310`) | user-action `_clicked` | high |
| `auth_callback_resolved` | orchestrator → projection | yes | domain past-tense | high |
| `auth_failed` | orchestrator → projection | yes | domain past-tense | high |
| `org_form_submitted` | FE → login | yes | past-tense imperative | high |
| `validation_failed` | orchestrator → projection | yes | past-tense | high |
| `org_created_and_jwt_reissued` | orchestrator → projection | yes | compound past-tense | high |
| `token_expired` | orchestrator → projection | yes | past-tense | high |
| `reissue_failed_partial` | orchestrator → projection | yes | past-tense | high |
| `retry_clicked` | FE → all error_recoverable states | no | `_clicked` | low |
| `__force_failure__` | failure-simulation probe | no | `__sentinel__` | low |
| `__expire_token__` | failure-simulation probe | no | `__sentinel__` | low |
| `FREEZE` / `THAW` | orchestrator broadcast | no | SCREAMING signal | low |

### Cross-machine broadcast events (orchestrator-mediated)

| Event name | Sender | Receiver | Wire? | Verdict |
|---|---|---|---|---|
| **`j001_ready`** | orchestrator post login.ready | project-context.resolving_initial_scope | **not** logged; cross-machine wire only | **stale journey-number prefix** — rename to `auth_ready` (payload-centric). Risk: low. |
| **`project_ready`** | orchestrator post project-context.project_selected | session-chat.waiting_for_project / loading_session_list / session_active / session_active_no_messages | not logged | clean (payload-shape suffix `_ready`) |
| **`switching_project_intent`** | FE or loader | project-context.project_selected | wire (FE driver + acceptance) | **mixes "intent" vocab; not past-tense** — rename `switch_project_clicked`. Risk: medium. |

### FlowEvent log entries (consumed by `projection.ts:180` EVENT_HANDLERS — wire-protocol)

Canonical (keep):
- `sign_in_clicked`, `auth_callback_resolved`, `auth_failed`, `org_form_submitted`, `org_created_and_jwt_reissued`, `token_expired`, `reissue_failed_partial`, `validation_failed`
- `no_projects_displayed`, `project_validation_failed`, `project_created`, `project_selected`, `project_switched`
- `deep_link_opened`, `scope_reconciled`, `scope_access_denied`
- `session_list_loaded`, `session_resumed`

Problematic:

| Event | Issue | Proposed rename | Risk |
|---|---|---|---|
| `j002_resolution_started` | stale journey-number | `project_context_resolution_started` | high (wire) |
| `j002_recoverable_error` | stale journey-number | `project_context_recoverable_error` | high (wire) |
| `project_creation_started` | `_started` family — see §7 finding | (decide with `_displayed` family) | wire |
| `switching_project_started` | awkward gerund-state + `_started` | `project_switch_started` | wire |
| `last_used_resolution_degraded` | "last_used" is opaque | (keep; document) | — |
| `scope_mismatch_displayed` | `_displayed` family | (decide; see §7) | high |
| `session_chat_project_ready` | machine-name leak | `project_context_inherited` | wire |
| `session_list_load_started` | `_started` family | (decide) | wire |
| `session_list_displayed` | `_displayed` family | (decide) | wire |
| `session_resume_started` | `_started` family | (decide) | wire |
| `session_dataset_unavailable` | adjective state, not past-tense event; "dataset" hard-coded | `session_resource_became_unavailable` (or commit to "dataset") | high |
| `session_resume_not_found` | mixed convention | `session_resume_target_not_found` | high |
| `session_chat_recoverable_error` | compound (subject + outcome) | (canonical-ish; rename in lockstep with `j002_recoverable_error`) | high |
| `session_welcome_displayed` | `_displayed` family | (decide) | high |
| `session_active_reached` | one-off `_reached` suffix | (decide) | high |

### Inline-guard events (XState-only, not logged)

Canonical: `create_project_clicked`, `create_project_submitted`, `back_to_projects_clicked`, `session_clicked`, `new_session_clicked`, `first_message_sent`, `dataset_resolved_by_agent`.

Inconsistent (low-risk renames):
- `open_deep_link` (bare verb) — rename `deep_link_opened` (align with the log entry name).
- `refresh_session_list` (bare verb) — rename `refresh_session_list_clicked` or `session_list_refreshed`.
- `dataset_picked_directly` (bare past-tense) — rename `dataset_chip_picked_clicked` or align.
- `suggestion_chip_clicked_upload` / `suggestion_chip_clicked_browse_projects` — verb-target order issue; rename `suggestion_chip_upload_clicked` / `suggestion_chip_browse_projects_clicked`.

---

## 3. State-name nomenclature inventory

| State | Machine | Noun/Gerund | Finality | Verdict |
|---|---|---|---|---|
| `anonymous` | login | adjective | settled-pre-action | canonical |
| `authenticating` | login | gerund | transient (invoke) | canonical |
| `authenticated_no_org` | login | adjective+modifier | settled | canonical-ish (the `_no_org` is sub-shape vocab) |
| `creating_org` | login | gerund | transient | canonical |
| `ready` | login | adjective | settled | canonical |
| `expired_token` | login | noun+adjective reversed | settled | acceptable (disambiguates from `token_expired` event) |
| `error_recoverable` | login + project-context + session-chat | adjective+modifier | settled w/ retry | canonical-ish |
| `error_terminal` | login | adjective+modifier | TERMINAL | canonical-ish |
| `resolving_initial_scope` | project-context | gerund | transient | canonical |
| `no_projects_empty_state` | project-context | noun + redundant `_empty_state` | settled | **rename: `no_projects`** (low risk) |
| `creating_project` | project-context | gerund | transient | canonical |
| `project_selected` | project-context | past-participle | settled | canonical |
| `switching_project` | project-context | gerund | transient | canonical |
| `scope_mismatch_terminal` | project-context | noun+`_terminal` | TERMINAL | canonical-ish |
| `waiting_for_project` | session-chat | gerund (passive) | transient (event-driven) | canonical |
| `loading_session_list` | session-chat | gerund | transient | canonical |
| `session_list_visible` | session-chat | adjective (UI-render vocab) | settled | **rename: `session_list_loaded`** (medium risk — surfaces in `projection.context.state`) |
| `resuming_session` | session-chat | gerund | transient | canonical |
| `session_active_no_messages` | session-chat | neither noun nor gerund — a *shape* | settled | **rename: `session_welcome`** (pairs with `session_welcome_displayed` event) |
| `creating_session_eagerly` | session-chat | gerund + adverb encoding strategy | transient | **rename: `creating_session`** (drop `_eagerly`) |
| `session_active` | session-chat | adjective | settled | canonical |
| `switching_dataset_context` | session-chat (MR-5) | gerund | transient | "dataset_context" overspecifies; see resource/dataset finding |
| `freeze` | session-chat (MR-6) | bare verb (mirror of `FREEZE` event) | special | acceptable (document the rule) |

**De facto rule** (recommended to lock in): gerund for transient/invoke states; noun-shape (adjective or past-participle) for settled states. `session_active_no_messages` violates this; `session_list_visible` mixes render vocab.

---

## 4. Context-field nomenclature inventory

### Cross-machine inconsistencies

| Issue | Where | Detail |
|---|---|---|
| **Counter suffix inconsistency** | `retries` (login + project-context + session-chat), `reissue_attempts` (login), `retry_budget_used` (login), `scope_reconciled_count` (project-context), `stale_intents_dropped_count` (both) | Three patterns. Recommend canonicalize on `_count` suffix. |
| **User-fields nesting inconsistency** | login uses `user: { email, display_name }` (nested); project-context uses flat `user_first_name` | Pick one. Recommend nest: `user: { first_name, display_name, email }`. |
| **Project-fields nesting inconsistency** | project-context uses `project: { id, name }` (nested); session-chat uses flat `project_id`, `project_name` | Nest both. |
| **`intent_` prefix overload** | `intent_project_id` / `intent_session_id` / `intent_resource_id` / `intent_resource_type` (project-context); `intent_session_id` (session-chat — survives async-invoke boundary, violates Direction F per ADR-030 amendment) | See §5 "intent" — split into `deeplink_*` (URL) + `pending_resume_*` (click). |
| **`pending_` prefix** | `pending_project_name` (project-context), `pending_first_message` (session-chat), `pending_org_name` (login) | Canonical de facto convention — composer-text preservation. |
| **`_tag` suffix** | `underlying_cause_tag` (everywhere) | Canonical de facto convention — discriminated-union markers. |
| **`_id` suffix** | Pervasive | Canonical for foreign-key references; bare `id` only nested inside aggregate object. |
| **`session_chat_project_id` / `session_chat_project_name` on projection** | `projection.ts:87-88` | Machine-name leak into projection field names. Consumers should not care which machine wrote it. |
| **`last_used_degraded_project_ids`** | `project-context/machine.ts:103` | Awkward — reads as "(last used) degraded" but means "for the last-used resolution." Rename `last_used_resolution_degraded_ids` (matches event name). |
| **`resource: { type, id }` shape asymmetry vs. `project: { id, name }`** | session-chat | resource has no name; project has no type. Polymorphic vs. monomorphic. Acceptable. |
| **`ResourceType` is forward-compat scaffolding** | `active-scope.ts:20` — `"dataset" \| "view" \| "report"` | Only `"dataset"` is instantiated today. See §5 resource/dataset finding. |

---

## 5. Ubiquitous-language ambiguities

### "scope" — single canonical meaning, low risk

Usages: `ActiveScope` (`active-scope.ts:22`), `resolveActiveScope`, `resolving_initial_scope` state, `scope_reconciled_count`, `scope_mismatch_terminal`, `scope_mismatch_displayed`, `scope_reconciled`, `scope_resolution_error`, `scope_access_denied`, `resolved_scope`, `X-Active-Scope` HTTP header.

All usages are consistent: "scope" = the `(org_id, project_id, resource_type, resource_id)` tuple in `ActiveScope`. **Recommendation: document the canonical definition in a glossary; no renames needed.**

### "intent" — THREE meanings, highest-risk ambiguity

1. **Deep-link intent** (URL-level wish): `intent_project_id` / `intent_session_id` / `intent_resource_id` / `intent_resource_type` carried in `open_deep_link` event payload (`project-context/machine.ts:76-79`).
2. **Transition intent** (user-action command): `switching_project_intent` event (`project-context/machine.ts:126`).
3. **Resume intent** (click-captured target): `capturePendingResumeIntent` action stores in `intent_session_id` (`session-chat/machine.ts:261`).

**The same field `intent_session_id` holds (1) and (3)**, with no nomenclature signal to disambiguate.

**Recommendation:**
- Split: `deeplink_session_id` (URL) vs. `pending_resume_session_id` (click; matches `pending_*` family).
- Rename `switching_project_intent` → `switch_project_clicked`.
- Rename `stale_intents_dropped_count` → `stale_deeplinks_dropped_count`.

After these changes, "intent" means only "URL-level user wish, not yet confirmed/denied." **Risk: high (wire-protocol — projection.context.intent_session_id read by FE + acceptance).**

### "session" vs. "chat session" vs. "active session" — low risk

- "session" = the backend `Session` row (domain entity).
- "chat session" = "session" (the "chat" qualifier is layering vocabulary, not domain vocabulary).
- "active session" = currently-resumed session (state `session_active`, projection field `session_id`).

The machine is named `session-chat` because of its responsibility (chat-session lifecycle), not because "chat session" is a distinct domain concept. The `session_chat_project_id` / `session_chat_project_name` projection-field prefix is the only true leak. **Recommendation: no renames; document in glossary.** Tracking item: collapse the duplicate fields when feasible.

### "resource" vs. "dataset" — medium risk; half-converted polymorphism

- `ResourceType = "dataset" | "view" | "report"` defines polymorphic supertype.
- `resource: { type, id }` shape in machine + projection.
- BUT: event names + cause tags hard-code "dataset" (`session_dataset_unavailable`, `dataset_resolved_by_agent`, `dataset_picked_directly`, `dataset_unavailable` actor-output flag, cause tags `dataset_not_found` + `dataset_access_denied`).

Highest-risk consequence: when MR-5 (switching_dataset_context) and future view/report ResourceTypes land, the dataset-named events either lie or proliferate (parallel `session_view_unavailable`, `session_report_unavailable` etc.).

**Recommendation: pick one explicitly.**
- (a) Commit to "resource" — rename event names + cause tags to `resource_*` (wire-protocol — high risk).
- (b) YAGNI — collapse `ResourceType` to just `"dataset"`; restore polymorphism when a second type actually ships (internal — low risk).

User-action event names like `dataset_resolved_by_agent` and `dataset_picked_directly` stay either way — they're user-actions on dataset specifically (FE dataset chip, agent's dataset tool).

### Additional terms

#### "ready" — three uses, loosely coupled

- `ready` state of login (Maya has org + JWT).
- `j001_ready` cross-machine event (sender-centric naming).
- `project_ready` cross-machine event (payload-centric naming).
- `waiting_for_project` state (what session-chat waits on).

**Asymmetry:** `j001_ready` is sender-named; `project_ready` is payload-named. **Recommendation:** when renaming `j001_ready`, align on the payload-centric pattern: `auth_ready` (payload `{ org_id, user_first_name }`).

#### "live state" / "_terminal" / "_recoverable"

`last_live_state`, `_terminal`/`_recoverable` suffixes are machine-implementation vocabulary. Consistent across machines; acceptable as machine-internal. Minor leak: `last_live_state` is carried in `session_chat_recoverable_error` payload (`orchestrator.ts:889-895`); not exposed via projection context today.

#### `_displayed` suffix family — render vocabulary in event names

`no_projects_displayed`, `scope_mismatch_displayed`, `session_list_displayed`, `session_welcome_displayed`. The orchestrator emits these before any FE render happens; "displayed" is aspirational. **Recommendation: either rename family to `_settled` (consistent with `waitForSettledState`) OR document the convention and accept it.**

---

## 6. Cross-machine event-flow coherence

| Event | Sender meaning | Receiver meaning | Slip? | Recommendation |
|---|---|---|---|---|
| `j001_ready` | login: "I'm in `ready`; here's the org I provisioned + user first name" | project-context: "I have the org I need to start resolving_initial_scope" | vocabulary asymmetry only — sender-named not payload-named | rename `auth_ready` |
| `project_ready` | project-context: "I'm in `project_selected`; here's org + project + forwarded intents" | session-chat (`waiting_for_project` → `loading_session_list`): "I have a project; list sessions." On re-broadcast with project_id change: invalidate session_id + transcript + resource. | none semantic; the `intent_*` forwarding is the context leak (project-context pass-through fields exist only for this) | keep event name; address `intent_*` leak per §5 |
| `switching_project_intent` | FE: "Maya clicked project picker, target_id=X" | project-context (`project_selected` → `switching_project`): "command — invoke switchProject now" | name says "intent" (forward-looking, maybe abandoned); receiver treats as immediate command (no abandonment path) | rename `switch_project_clicked` |
| `open_deep_link` (XState event) vs. `deep_link_opened` (FlowEvent log) | FE: "Maya navigated; capture intents" | project-context: capture + re-enter resolving_initial_scope; orchestrator: also append `deep_link_opened` to log | event/log name asymmetry | rename event to `deep_link_opened` (single name across cause + effect) |
| `FREEZE` / `THAW` | orchestrator broadcast | every machine (today: no-op) | none | keep |

**One additional slip not captured above:** `session_chat_project_ready` (FlowEvent log entry, `orchestrator.ts:738`) is session-chat's local log marker for having received `project_ready`. Semantically redundant with the cross-machine `project_ready`; exists because the two events go to different Redis streams (ADR-030 §6 — separate per-machine, per-principal keys). Naming makes the redundancy visible (good) but bakes machine-name into the event vocabulary (bad). **Recommendation:** rename `project_context_inherited` or similar payload-shape name.

---

## 7. Findings summary

### Tier 1 — Vocabulary that's actively misleading

| # | Finding | Recommendation | Risk | Effort |
|---|---|---|---|---|
| 1 | `j001_*` / `j002_*` stale journey-numbering identifiers in event names | Rename `j001_ready` → `auth_ready` (internal); `j002_resolution_started` → `project_context_resolution_started` (wire); `j002_recoverable_error` → `project_context_recoverable_error` (wire) | low / high / high | small / medium / medium |
| 2 | `intent_session_id` carries TWO meanings (deep-link URL + click-to-resume) in the same field | Split: `deeplink_session_id` + `pending_resume_session_id` | high (wire) | medium |
| 3 | `switching_project_intent` event name conflates "user wish" with "machine command" | Rename `switch_project_clicked` | medium (wire) | small |
| 4 | resource/dataset half-converted polymorphism — event names hard-code "dataset" while field shapes are polymorphic `resource: { type, id }` | (a) Rename event names + cause tags to `resource_*` family OR (b) collapse ResourceType to `"dataset"` (YAGNI) | (a) high / (b) low | (a) medium / (b) trivial |
| 5 | Machine-name leak into projection vocabulary: `session_chat_project_ready` event + `session_chat_project_id` / `session_chat_project_name` fields | Rename event `project_context_inherited`; longer-term collapse duplicate fields into `project.id` / `project.name` | high (wire) | medium for event; large for field collapse |

### Tier 2 — Inconsistencies the team should normalize

| # | Finding | Recommendation | Risk | Effort |
|---|---|---|---|---|
| 6 | Three counter-suffix conventions: `retries`, `reissue_attempts`, `retry_budget_used`, `scope_reconciled_count`, `stale_intents_dropped_count` | Canonicalize on `_count` suffix | low | small |
| 7 | `session_active_no_messages` is a shape, not a state | Rename `session_welcome` (pairs with existing `session_welcome_displayed` event) | low | small |
| 8 | `creating_session_eagerly` encodes implementation strategy in state name | Rename `creating_session` | low | trivial |
| 9 | `_displayed` suffix family is render vocab in event names (orchestrator emits before FE renders) | Either rename family to `_settled` OR document existing convention | (rename) high / (doc) trivial | (rename) medium |
| 10 | `open_deep_link` (event) vs. `deep_link_opened` (log) — same concept, two names | Use `deep_link_opened` for both | low | small |
| 11 | `user_first_name` flat on project-context vs. `user.display_name` nested on login | Nest: `user: { first_name, display_name, email }` | low | small |
| 12 | `project_id` / `project_name` flat on session-chat vs. `project: { id, name }` nested on project-context | Nest both | low | small |
| 13 | `no_projects_empty_state` state name is redundant | Rename `no_projects` | low | trivial |
| 14 | `session_list_visible` uses FE-render vocab in machine state name | Rename `session_list_loaded` (pairs with the `session_list_loaded` event) | medium (state surfaces in `projection.context.state`) | small in code |
| 15 | `session_active_reached` uses one-off `_reached` suffix | Align with the `_displayed` decision in #9 (rename `session_active_displayed`) | high (wire) | small |
| 16 | `suggestion_chip_clicked_upload` / `suggestion_chip_clicked_browse_projects` have verb-target order swapped | Rename to `<subject>_<modifier>_<verb>` order | low | trivial |
| 17 | `last_used_degraded_project_ids` is awkward to parse | Rename `last_used_resolution_degraded_ids` (matches event name) | low | small |

### Tier 3 — Forward-looking conventions

| # | Convention |
|---|---|
| C1 | User-action events end in `_clicked` / `_submitted` / `_sent` depending on trigger shape. Past-tense imperative. |
| C2 | Domain-event events end in past-tense verb. State-entry events follow ONE pattern (either bare state-name OR `_settled` suffix); avoid `_started` / `_displayed` / `_reached` suffix proliferation. |
| C3 | Cross-machine broadcast events are payload-centric, not sender-centric. `project_ready` good; `j001_ready` bad (encodes sender). |
| C4 | `__double_underscore__` event prefix marks failure-simulation side channels. Production events MUST NOT use it. |
| C5 | `_count` suffix marks observability counters (write-only telemetry). |
| C6 | `pending_` prefix marks composer-text preservation fields. |
| C7 | `intent_` prefix (post Tier-1 #2) marks **only** URL-level user wishes not yet confirmed/denied. |
| C8 | `_id` suffix for foreign-key references; bare `id` only for an aggregate's own id when nested. |
| C9 | `_tag` suffix for discriminated-union markers. |
| C10 | State names: noun-shape (adjective / past-participle) for settled; gerund for transient/invoke. |
| C11 | Dev-tooling vocabulary ("rig", "probe") acceptable in dev-tool / failure-simulation contexts only; audit found no product-vocabulary leaks from ui-state. |
| C12 | Machine-name leakage into projection field names is a smell; field names describe **data**, not **producer**. |

---

## 8. Recommended sequencing for follow-on MRs

| MR | What | Risk | Notes |
|---|---|---|---|
| MR-A | Rename `j001_ready` → `auth_ready` (cross-machine event, not logged) | low | Establishes renaming pattern; tiny blast radius. |
| MR-B | Rename `switching_project_intent` → `switch_project_clicked` | medium | Eliminates one of three "intent" usages. |
| MR-C | Bundle Tier-2 internal renames: `no_projects_empty_state` → `no_projects`, `creating_session_eagerly` → `creating_session`, `session_active_no_messages` → `session_welcome`, counter suffixes, `session_list_visible` → `session_list_loaded`, `user_first_name` nesting, `project_id`/`project_name` nesting | mixed (mostly low; `session_list_visible` is medium because state appears in projection.context.state) | One MR amortizes the test-surface churn. |
| MR-D | Split `intent_session_id` → `deeplink_session_id` + `pending_resume_session_id`; symmetric rename / removal of `intent_resource_*` from project-context (per Direction F) | high (wire) | The single-most-misleading vocabulary in ui-state. Focused MR. |
| MR-E | Resource/dataset convergence — pick option (a) or (b) from Tier-1 #4 | (a) high / (b) low | Locks in the right answer before MR-5. |
| MR-F | `j002_*` event renames (`j002_resolution_started`, `j002_recoverable_error` → `project_context_*`) | high (wire) | Biggest blast radius; land last among Tier-1. |
| MR-G | Optional: `_displayed` → `_settled` rename OR documentation-only acceptance of existing convention | (rename) high / (doc) trivial | Team decision. |
| MR-H | `session_chat_project_ready` event rename + optional field collapse | medium for event; high for collapse | Removes last machine-name leak. |
| MR-I | Write `ui-state/CONVENTIONS.md` (or ADR-XXX) documenting C1–C12 | zero | Final MR after renames land; prevents drift. |

---

## 9. Open questions / deferred decisions

1. **Resource vs. dataset:** does the team commit to "resource" as polymorphic supertype, or YAGNI-collapse to "dataset"? Blocks MR-E.
2. **`_displayed` family:** rename to `_settled` or document and keep? Blocks MR-G.
3. **`session_chat_project_id` / `_project_name` field collapse:** verify with a property test that project-context and session-chat agree on project state post MR-4 before collapsing.
4. **Lint rule for `intent_` prefix** (C7) — or rely on convention?
5. **"Session" vs. "chat session" distinction** — argued in §5 to be non-existent; team should confirm or surface a domain distinction if one exists.
6. **Lint rule banning machine-name prefixes on projection fields** (C12) — mechanical enforcement?
7. **Where to ratify Tier-3 conventions** — `ui-state/CONVENTIONS.md`, `ui-state/README.md`, or a new ADR? Recommend ADR.

---

## Files referenced

- `ui-state/lib/machines/project-context/machine.ts`
- `ui-state/lib/machines/session-chat/machine.ts`
- `ui-state/lib/machines/login-and-org-setup.ts`
- `ui-state/lib/machines/project-context/validation.ts`
- `ui-state/lib/orchestrator.ts`
- `ui-state/lib/projection.ts`
- `ui-state/lib/active-scope.ts`
- `docs/discussion/session-chat-context-architecture/directions.md`
- `docs/decisions/adr-028-xstate-v5-actor-model.md` (amendment 2026-05-15)
- `docs/decisions/adr-030-flow-state-topology-and-scaling.md` (amendment 2026-05-15)
- `docs/decisions/adr-029-active-scope-propagation-contract.md`
