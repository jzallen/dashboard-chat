# UI-state vocabulary convergence — Evolution

> **Finalized**: 2026-05-15
> **Inputs**:
>  - [Vocabulary audit](../discussion/ui-state-vocabulary-audit/findings.md) — 17 findings across 3 tiers + 12 conventions + 9-MR sequencing
>  - [ADR-039](../decisions/adr-039-ui-state-naming-conventions.md) — ratified the 12 conventions and resolved 4 of the audit's open questions
>  - [ADR-030 §"Migration sequencing"](../decisions/adr-030-flow-state-topology-and-scaling.md) — the LEAF-A → LEAF-B → LEAF-C → LEAF-D sequence
>  - [ADR-028 §"Amendment 2026-05-15"](../decisions/adr-028-xstate-v5-actor-model.md) — "machines own transitions, the log owns state" + Direction F (event.output for cross-state hand-off)
> **Ratifies**: ADR-039 (naming conventions) plus the LEAF migration sequence from ADR-030

## Summary

The `ui-state` package had three overlapping vocabulary problems:

1. **Stale journey-numbering identifiers** in event names — `j001_ready`, `j002_resolution_started`, `j002_recoverable_error` baked the deprecated journey-numbering scheme into wire-protocol events emitted by source-trees that had since been renamed.
2. **One field with two meanings** — `intent_session_id` simultaneously held URL-level deep-link intent AND click-captured resume-target intent, with no nomenclature to disambiguate.
3. **Snapshot-as-read-source** — the orchestrator's FlowEvent-emission paths read straight from `snapshot.getContext()`, undermining ADR-030's "projection is the single source of truth for read state" rule.

The audit dropped on 2026-05-15 morning; ADR-039 was ratified by mid-day; a 10-step refactor chain landed by mid-afternoon. All 10 MRs went through the merge queue cleanly. Zero test-suite regressions on `main`.

## Why these changes converged in one day

Three things lined up:

- **The audit had already done the hard work.** 17 findings, 12 conventions, 3 tiers of risk, and a recommended 9-MR sequencing were on disk before any code changed. The chain commits effectively executed the audit.
- **ADR-039 first**. We ratified the conventions before any rename MR so each rename had a stable convention reference (`C3` for payload-centric broadcasts, `C5` for counter suffixes, `C8` for nested aggregate ids, `C10` for state-name verbs, `C12` for machine-name prefixes). Without that, every rename would have re-litigated its own micro-decision.
- **Mechanical separation**. Pure-vocabulary changes (rename event, narrow union) could ship parallel to behavioral changes (route reads through projection). The audit pre-classified each MR by risk, and the chain order — convention-rules first, then internal renames, then wire-protocol, then ADR-030 LEAFs — let earlier MRs reduce blast radius for later ones.

## Final shipped state — the 12-commit arc

```
be274a1  docs(adr): ratify ADR-039 ui-state naming conventions
49f7f8e  feat(ui-state): ESLint custom rules (C4 + C7 + C12) + probe files
d3b2242  refactor(ui-state): rename j001_ready cross-machine event to auth_ready
5ea54b1  refactor(ui-state): MR-C — Tier-2 vocabulary canonicalization (7 renames bundle)
83d2f8f  refactor(ui-state): YAGNI-collapse ResourceType union to "dataset"
48cda97  docs(ui-state): rewrite state-machine READMEs as standalone educational docs
5826660  refactor(ui-state): LEAF-A — orchestrator session-list reads → projection
5f4e635  refactor(ui-state): LEAF-B — purge remaining orchestrator snapshot reads
130dc09  refactor(ui-state): LEAF-C — channel loadSessionList resume target via event.output
05a7ad0  refactor(ui-state): MR-D — split intent_session_id into deeplink + pending_resume
1418366  refactor(ui-state): MR-F — rename j002_* events to project_context_*
d7690cb  refactor(ui-state): MR-H — rename session_chat_project_ready → project_context_inherited
```

### Convention-rule infrastructure

- **`49f7f8e`** added three ESLint custom rules under `ui-state/lib/eslint-plugin-ui-state-conventions/` (one per convention C4, C7, C12) plus lint-probe files at `ui-state/lib/lint-probes/` that exercise each rule's positive + negative cases.
- The rules were authored to be turn-on-friendly: existing violations on `intent_*` / `session_chat_*` were left as warnings (not errors) so later rename MRs could clear them without the rule changing meaning.

### Vocabulary renames

| What | Before | After | Risk |
|---|---|---|---|
| Cross-machine broadcast | `j001_ready` | `auth_ready` | Low (internal) |
| FlowEvent log + FE-consumed | `j002_resolution_started` | `project_context_resolution_started` | High (wire) |
| FlowEvent log + FE-consumed | `j002_recoverable_error` | `project_context_recoverable_error` | High (wire) |
| FlowEvent log + FE-consumed | `session_chat_project_ready` | `project_context_inherited` | High (wire) |
| State name | `no_projects_empty_state` | `no_projects` | Low |
| State name | `creating_session_eagerly` | `creating_session` | Low |
| State name | `session_active_no_messages` | `session_welcome` | Low |
| State name | `session_list_visible` | `session_list_loaded` | Medium (surfaces in `projection.context.state`) |
| Counter field | `retries`, `reissue_attempts`, `retry_budget_used` | `*_count` | Low |
| Field shape | `user_first_name` (flat) | `user.first_name` (nested) | Low |
| Field shape | `project_id` / `project_name` (flat in session-chat context) | `project: { id, name }` (nested) | Low |
| Field split | `intent_session_id` | `deeplink_session_id` (URL) + `pending_resume_session_id` (click) | High (wire) |
| Field rename | `intent_project_id` | `deeplink_project_id` | Medium |
| Field removal | `intent_resource_id` + `intent_resource_type` on `ProjectContextMachineContext` | (removed — pure pass-through scope leak) | Medium |

### Type narrowing

- `ResourceType = "dataset" | "view" | "report"` → `ResourceType = "dataset"` (YAGNI per [ADR-039 §Q1](../decisions/adr-039-ui-state-naming-conventions.md)). The shape `resource: { type, id }` stays polymorphism-ready for option (a) revisit when a second resource type actually ships.

### ADR-030 LEAFs (snapshot-read migration)

- **LEAF-A** (`5826660`) — three `snapshot.context.session_list*` reads in `appendSessionChatTerminalEvents` redirected to `projection.context.session_list*`.
- **LEAF-B** (`5f4e635`) — remaining snapshot reads in `orchestrator.ts` (project-context emission paths + session-chat emission paths) all redirected to projection reads. After this MR, the orchestrator file is **snapshot-read-free**.
- **LEAF-C** (`130dc09`) — `loadSessionList` actor restructured to return `{ items, next_cursor, has_more, resume_target }`. The `onDone` guard now reads `event.output.resume_target` instead of `ctx.intent_session_id`. **First direct application of Direction F** from ADR-028's 2026-05-15 amendment.

### Documentation

- **`48cda97`** — `ui-state/lib/machines/{login-and-org-setup,project-context,session-chat}/README.md` rewritten as standalone educational docs. Stripped: journey IDs (`J-001`, `J-002`), user-story IDs (`US-203`..`US-210`), merge-request IDs (`MR-3`..`MR-6`), invariant tags (`IC-J002-3`, `OQ-J002-5`), migration sequencing (`LEAF-A..D`), audit finding numbers, test-budget refs, persona names. Inline ADR paraphrasing replaced with link-only references. Mermaid diagrams cleaned: removed the invalid `state any_state { [*] --> any_state }` pseudo-composite (which caused a parse error in the project-context chart), moved transition side-effects off labels into the States table (boxes stop truncating), introduced `%%` source-only comments for context that shouldn't render.

## Direction F in practice

ADR-028's 2026-05-15 amendment introduced "Direction F" — branch-relevant data flows through `event.output` rather than through context fields read by `onDone`. The chain demonstrates the pattern at three layers:

1. **Actor output shape** — `loadSessionList` returns `{ items, next_cursor, has_more, resume_target }`. The `resume_target` field is what the consumer needs to branch on.
2. **Transition guard** — `onDone` reads `event.output.resume_target` directly. No context field is involved.
3. **Cross-machine event payload** — `auth_ready` (renamed from `j001_ready`) and `project_ready` follow the same shape: the orchestrator broadcasts a complete payload that the receiving machine treats as input, not a signal to consult some other source.

The pattern reduces the surface for "lying about nullability": context fields that exist only because some pre-invoke handler set them and some post-invoke handler reads them are a high-bug-density shape. Direction F eliminates the gap.

## Deferred follow-ups

1. **`session_chat_project_id` / `session_chat_project_name` projection-field collapse** — gated on adding a property test (per [audit §9 Q3](../discussion/ui-state-vocabulary-audit/findings.md)) that verifies project-context and session-chat agree on project state post-switch. The ESLint rule `no-machine-name-prefix-on-projection-fields` currently warns on these fields; those warnings are the tracking signal. Field collapse is sized "large" by the audit because the FE projection reader has multiple call sites + the duplicate-field invariant is what the property test would prove safe to retire.

2. **LEAF-D** — the lint rule enforcing no `snapshot.context.*` / `snapshot.getContext()` reads in `orchestrator.ts`. Not in the original 10-MR chain but now unblocked: after LEAF-A + LEAF-B, the orchestrator file is snapshot-read-free, so the rule activates on a clean tree. A separate follow-up MR adds the rule + a regression test that confirms it would have caught the pre-LEAF state.

3. **Tier-2 audit findings still open** — Tier-2 #15 (`session_active_reached` one-off `_reached` suffix), Tier-2 #16 (`suggestion_chip_clicked_*` verb-order), Tier-2 #17 (`last_used_degraded_project_ids` → `last_used_resolution_degraded_ids`), Q2 resolution (the `_displayed` suffix family — audit recommends `_settled`). All scoped as discrete future MRs per [audit §8](../discussion/ui-state-vocabulary-audit/findings.md).

4. **Wire-protocol `open_deep_link` event payload keys** — MR-D renamed the *context* fields (`intent_*` → `deeplink_*`), but the `open_deep_link` event payload keys may still say `intent_project_id` etc. depending on what the worker found. If still present, that's a follow-up rename — semantically the event payload should match the context vocabulary.

## What landed clean — and what didn't

**Clean** (8 MRs went refinery `gt mq submit` → land with zero rework): #63 lint rules, #64 `j001_ready` rename, #65 Tier-2 bundle, #66 ResourceType collapse, #67/68/69 the three LEAFs, #70 intent split, #71 `j002_*` renames, #72 `session_chat_project_ready` rename.

**Caught + recovered**:

- **#73 README rewrite vs. #66 ResourceType collapse merge collision**. Both MRs touched the same README sections — the dataset_collapser added a one-line `ResourceType is YAGNI-collapsed…` cross-reference to two field rows; the README rewrite replaced those entire sections wholesale. The refinery's `--auto` gate caught the conflict at rebase time (each MR was independently valid; they collided at integration). Resolution: rebased the README rewrite onto post-`83d2f8f` main, took the rewrite over the inline annotation (consistent with the directive to stop inlining ADR cross-references), force-pushed, resubmitted clean.

- **Dolt server config drift mid-chain**. The Dolt SQL server (the merge queue's bead store) was restarted manually during the chain and came back without `--data-dir`, so its served database set was empty. `gt mq submit` failed with "issue not found" until the server was killed and restarted via `gt dolt start`. The bundler worker (chain step #65) had written the commit but the queue submission never went through; the recovery was to re-run `gt mq submit` from the refinery rig after the Dolt fix. No code was lost — the commit was already on origin, only the queue entry needed re-creation.

## Lessons

- **Ratify conventions before renames.** ADR-039 first, then everything else. The chain would have been a series of micro-litigations without it.
- **Wire-protocol changes ARE feasible in a chain.** MR-D (the `intent_session_id` split) touched ui-state + orchestrator + projection + FE + acceptance harness across ~15 files. It landed on the first try because the audit had pre-mapped every reader.
- **`event.output` is a sharper tool than context.** The `loadSessionList` LEAF-C change (a ~50-line diff) is the kind of refactor that the team had previously deferred because it felt fiddly. With Direction F as a vocabulary, it became obviously the right move.
- **The refinery's `--auto` gate is content-aware enough to be trusted.** Docs-only diffs skipped backend tests; production-code diffs ran the full Python suite. The `*.md` carve-out shipped without surprises across 4 MRs in the chain that touched only markdown.
- **Headless agent + cron-driven check-in scales to 10 MRs.** The chain ran for ~3 hours of wall-time with a 10-minute cron heartbeat. Two failure modes appeared (Dolt config, README rebase); both were single-step recoveries with clear diagnostics in the worker logs. No silent failures.

## Inputs preserved

The driving audit ([discussion/ui-state-vocabulary-audit/findings.md](../discussion/ui-state-vocabulary-audit/findings.md)) and ADR-039 itself are the durable record of what the chain executed. Worker prompts and per-step final logs live under `/home/node/gt/dashboard_chat/crew/<crew_name>/.logs/` in the gastown headless workspace for the duration of that workspace's life; they were not migrated into this repo because the prompt content is captured at the conceptual level by the audit + this evolution doc.
