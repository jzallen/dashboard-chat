# UI-state vocabulary convergence — Evolution

> **Finalized**: 2026-05-15 (10-MR chain + 5 follow-up MRs landed same day)
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

The audit dropped on 2026-05-15 morning; ADR-039 was ratified by mid-day; a 10-step refactor chain landed by mid-afternoon, and 5 follow-up MRs (LEAF-D rule, field collapse + property test, and three issues discovered during the follow-ups themselves) landed by end of day. All MRs went through the merge queue. One regression slipped past the refinery gate and was caught post-landing during pre-submit verification for a later MR; see "What landed clean — and what didn't" below.

## Why these changes converged in one day

Three things lined up:

- **The audit had already done the hard work.** 17 findings, 12 conventions, 3 tiers of risk, and a recommended 9-MR sequencing were on disk before any code changed. The chain commits effectively executed the audit.
- **ADR-039 first**. We ratified the conventions before any rename MR so each rename had a stable convention reference (`C3` for payload-centric broadcasts, `C5` for counter suffixes, `C8` for nested aggregate ids, `C10` for state-name verbs, `C12` for machine-name prefixes). Without that, every rename would have re-litigated its own micro-decision.
- **Mechanical separation**. Pure-vocabulary changes (rename event, narrow union) could ship parallel to behavioral changes (route reads through projection). The audit pre-classified each MR by risk, and the chain order — convention-rules first, then internal renames, then wire-protocol, then ADR-030 LEAFs — let earlier MRs reduce blast radius for later ones.

## Final shipped state — the 19-commit arc

**The 10-MR audit chain + README rewrite (mid-morning to mid-afternoon)**:

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

**Plus this recap doc**:

```
9d5443c  docs(evolution): recap ui-state vocabulary convergence (10-MR chain)
```

**Follow-up MRs (late afternoon to evening)**:

```
a3265c9  feat(ui-state): LEAF-D — ESLint rule preventing snapshot reads in orchestrator
56bd2c6  test(ui-state): property test asserting project-context / session-chat agree on project state
00c5891  refactor(ui-state): collapse session_chat_project_id/_name projection fields
ad18022  fix(ui-state): restore login emission carve-outs broken by LEAF-B
a21b927  fix(ui-state): C12 lint rule skips reducer-dispatch entries
eb656ea  refactor(ui-state): extract LEAF-B carve-outs into orchestrator-harvester
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
- **LEAF-B** (`5f4e635`) — remaining snapshot reads in `orchestrator.ts` (project-context emission paths + session-chat emission paths) all redirected to projection reads. After this MR, the orchestrator file is **snapshot-read-free**. *(Note: LEAF-B was found to have introduced a regression in two emission paths that needed snapshot reads to be correct; see "What landed clean — and what didn't" + the harvester refactor `eb656ea` for the resolution.)*
- **LEAF-C** (`130dc09`) — `loadSessionList` actor restructured to return `{ items, next_cursor, has_more, resume_target }`. The `onDone` guard now reads `event.output.resume_target` instead of `ctx.intent_session_id`. **First direct application of Direction F** from ADR-028's 2026-05-15 amendment.
- **LEAF-D** (`a3265c9`) — ESLint custom rule `no-orchestrator-snapshot-reads` at severity `error`, scoped to `ui-state/lib/orchestrator.ts` via the rule's `files:` glob. Activates on a clean tree (zero violations to clean up); regressions are caught at lint time. Probe file demonstrates the four violation patterns (member access, bracket notation, destructure, `getContext()` method call) and three non-violation patterns (projection reads, local aliases bound from projection, `event.output`).

### Documentation

- **`48cda97`** — `ui-state/lib/machines/{login-and-org-setup,project-context,session-chat}/README.md` rewritten as standalone educational docs. Stripped: journey IDs (`J-001`, `J-002`), user-story IDs (`US-203`..`US-210`), merge-request IDs (`MR-3`..`MR-6`), invariant tags (`IC-J002-3`, `OQ-J002-5`), migration sequencing (`LEAF-A..D`), audit finding numbers, test-budget refs, persona names. Inline ADR paraphrasing replaced with link-only references. Mermaid diagrams cleaned: removed the invalid `state any_state { [*] --> any_state }` pseudo-composite (which caused a parse error in the project-context chart), moved transition side-effects off labels into the States table (boxes stop truncating), introduced `%%` source-only comments for context that shouldn't render.

### Post-chain follow-ups

Three pieces of work the original 10-MR chain explicitly deferred or didn't anticipate:

- **`session_chat_project_id` / `session_chat_project_name` field collapse** (`56bd2c6` + `00c5891`) — the duplicate projection fields are retired into reads from `project: { id, name }`. The collapse is gated on a property test (`projection-property.test.ts`) that proves agreement between project-context and session-chat on project state across arbitrary FlowEvent sequences, including the cross-project switch path that audit §9 Q3 worried about. With the test green, the two C12 violations on `projection.ts` are gone.
- **C12 rule false-positive fix** (`a21b927`) — after MR-F + MR-H introduced `project_context_*` and (legitimately) `session_chat_*` event names as the audit's canonical wire vocabulary, the C12 rule fired on the reducer dispatch-table entries that key on those names. The rule now skips `Property` nodes whose value is a function expression — those are dispatch tags, not data-field declarations. With production code zero-violation, the rule's severity flips from `warn` to `error`. Lint-probe files (which contain deliberate violations the plugin's test suite asserts on) are excluded from the production lint pass via a new ignore glob.
- **LEAF-B carve-outs** (`ad18022` + `eb656ea`) — see "What landed clean — and what didn't" below for the regression-then-fix story. The bridge-to-harvester refactor (`eb656ea`) lands the structural answer: snapshot reads relocate to `ui-state/lib/orchestrator-harvester.ts` (outside the LEAF-D rule's `files:` glob by construction), and `orchestrator.ts` has zero `eslint-disable` comments.

## Direction F in practice

ADR-028's 2026-05-15 amendment introduced "Direction F" — branch-relevant data flows through `event.output` rather than through context fields read by `onDone`. The chain demonstrates the pattern at three layers:

1. **Actor output shape** — `loadSessionList` returns `{ items, next_cursor, has_more, resume_target }`. The `resume_target` field is what the consumer needs to branch on.
2. **Transition guard** — `onDone` reads `event.output.resume_target` directly. No context field is involved.
3. **Cross-machine event payload** — `auth_ready` (renamed from `j001_ready`) and `project_ready` follow the same shape: the orchestrator broadcasts a complete payload that the receiving machine treats as input, not a signal to consult some other source.

The pattern reduces the surface for "lying about nullability": context fields that exist only because some pre-invoke handler set them and some post-invoke handler reads them are a high-bug-density shape. Direction F eliminates the gap.

## Still-deferred follow-ups

The post-chain follow-up MRs (see above) closed the two top-of-list deferrals from the original recap (LEAF-D + the field collapse). What remains:

1. **Tier-2 audit findings still open** — Tier-2 #15 (`session_active_reached` one-off `_reached` suffix), Tier-2 #16 (`suggestion_chip_clicked_*` verb-order), Tier-2 #17 (`last_used_degraded_project_ids` → `last_used_resolution_degraded_ids`), Q2 resolution (the `_displayed` suffix family — audit recommends `_settled`). All scoped as discrete future MRs per [audit §8](../discussion/ui-state-vocabulary-audit/findings.md).

2. **Wire-protocol `open_deep_link` event payload keys** — MR-D renamed the *context* fields (`intent_*` → `deeplink_*`), but the `open_deep_link` event payload keys may still say `intent_project_id` etc. depending on what the worker found. If still present, that's a follow-up rename — semantically the event payload should match the context vocabulary.

3. **`begin()` mirrors the LEAF-B carve-outs that `send()` had** — the `begin()` function in `orchestrator.ts` reads `auth_callback_resolved` user fields and `auth_failed` cause-tag from the projection at a moment when those events haven't been written yet, so the projection returns the empty initial shape. No current test fails on this (because the tests for `begin()` assert on the AFTER-state which the event payload populates), but the emission carries placeholder values today. The harvester at `orchestrator-harvester.ts` is the natural place for the fix: extend `harvestSettledLoginState` callers to the `begin()` emission sites and the carry-through becomes consistent with the `send()` path.

4. **Future LEAF-style work to retire the harvester itself** — `orchestrator-harvester.ts` is the controlled boundary between machine-snapshot state and the FlowEvent log. A future refactor that adds upstream actor-output events (so the projection has the harvested fields on its own, before the emission read) can migrate harvester callers one at a time and retire the helper. Tracked as the "LEAF-C+ for login" work in ADR-030 §"Migration sequencing".

## What landed clean — and what didn't

**Clean** (8 MRs went refinery `gt mq submit` → land with zero rework): #63 lint rules, #64 `j001_ready` rename, #65 Tier-2 bundle, #66 ResourceType collapse, #67/68/69 the three LEAFs, #70 intent split, #71 `j002_*` renames, #72 `session_chat_project_ready` rename.

**Caught + recovered**:

- **#73 README rewrite vs. #66 ResourceType collapse merge collision**. Both MRs touched the same README sections — the dataset_collapser added a one-line `ResourceType is YAGNI-collapsed…` cross-reference to two field rows; the README rewrite replaced those entire sections wholesale. The refinery's `--auto` gate caught the conflict at rebase time (each MR was independently valid; they collided at integration). Resolution: rebased the README rewrite onto post-`83d2f8f` main, took the rewrite over the inline annotation (consistent with the directive to stop inlining ADR cross-references), force-pushed, resubmitted clean.

- **Dolt server config drift mid-chain**. The Dolt SQL server (the merge queue's bead store) was restarted manually during the chain and came back without `--data-dir`, so its served database set was empty. `gt mq submit` failed with "issue not found" until the server was killed and restarted via `gt dolt start`. The bundler worker (chain step #65) had written the commit but the queue submission never went through; the recovery was to re-run `gt mq submit` from the refinery rig after the Dolt fix. No code was lost — the commit was already on origin, only the queue entry needed re-creation.

- **LEAF-B regression — caught post-landing, fixed under an hour**. After LEAF-B (`5f4e635`) landed clean through the refinery gate, two existing `ui-state/index.test.ts` tests were silently failing on `main`. The regression was discovered during pre-submit verification of the C12 rule fix (a later MR) when its baseline vitest run reported `2 failed | 132 passed` instead of the expected all-green. Bisect across the chain isolated the failures to `5f4e635`.

  Root cause: LEAF-B's commit body explicitly flagged the regression as a known trade-off — *"until then `auth_callback_resolved` / `auth_failed` may carry placeholder values"* — and expected LEAF-C+ work to land the bridge events that would make the snapshot-purge correctness-preserving. The audit's LEAF-C only covered the session-chat `loadSessionList` path; the login emission paths needed analogous work that the chain didn't include.

  Why the refinery didn't catch it: the `gt mq submit --auto` gate is content-aware and routes code touches to `--backend` (ruff + pytest), but the ui-state JS vitest suite runs as a worker pre-submit gate, not in the refinery. The LEAF-B worker either skipped vitest or interpreted the failures as pre-existing; either way the regression slipped through. **This is a real gap in the automated gate** — flagged in the lessons below.

  Resolution path (3 follow-up MRs):
  - `ad18022` — surgical inline carve-outs at the two affected emission sites in `orchestrator.ts`, with explicit `eslint-disable-next-line` + TODO comments referencing the proper bridge-event work. Tests turn green: `133/133`.
  - `eb656ea` — structural cleanup: snapshot reads move to a dedicated harvester module (`ui-state/lib/orchestrator-harvester.ts`) outside the LEAF-D rule's `files:` glob. The two `eslint-disable` comments come off; `orchestrator.ts` returns to zero per-line carve-outs.
  - A new tracked follow-up (see "Still-deferred follow-ups" #3) calls out the same pattern in `begin()` — silently emitting placeholder values today but not test-covered. The harvester is ready for it.

## Lessons

- **Ratify conventions before renames.** ADR-039 first, then everything else. The chain would have been a series of micro-litigations without it.
- **Wire-protocol changes ARE feasible in a chain.** MR-D (the `intent_session_id` split) touched ui-state + orchestrator + projection + FE + acceptance harness across ~15 files. It landed on the first try because the audit had pre-mapped every reader.
- **`event.output` is a sharper tool than context.** The `loadSessionList` LEAF-C change (a ~50-line diff) is the kind of refactor that the team had previously deferred because it felt fiddly. With Direction F as a vocabulary, it became obviously the right move.
- **The refinery's `--auto` gate covers backend, NOT JS vitest.** Docs-only diffs skip the backend test suite; production-code diffs run `--backend` (ruff + pytest). The ui-state JS vitest suite is the worker's pre-submit responsibility — the refinery does not re-run it. LEAF-B's regression slipped through because the worker's pre-submit either skipped vitest or didn't reconcile its failures with main's baseline. **Action item**: extend the refinery gate to run `cd ui-state && npx vitest run` when the diff touches `ui-state/` (similar to the existing content-aware backend routing). This would have caught LEAF-B at submission time instead of an hour later.
- **A worker's self-flagged "may carry placeholder values" IS a regression.** LEAF-B's commit body documented exactly the failure mode that subsequently broke two tests. A worker that flags a known correctness gap in the commit body is communicating that the gate isn't strong enough to catch it — and the gate was not strengthened to compensate. Treat that signal as a soft-block on landing unless the gap is also captured as a tracked follow-up that lands BEFORE the broken state can ship to production.
- **The LEAF-D rule's `files:` glob is the cleanest carve-out boundary.** When LEAF-B's regression was patched, the natural fix was per-line `eslint-disable` comments at the affected emission sites. The structural fix (`eb656ea`) moves the snapshot reads to a separate file the rule's `files:` glob doesn't include. Result: zero per-line disables in production code, one well-named module that is the designated boundary. Pattern is reusable for any future rule with legitimate scope-bounded exceptions.
- **Headless agent + cron-driven check-in scales to 10 MRs.** The chain ran for ~3 hours of wall-time with a 10-minute cron heartbeat. Three failure modes appeared (Dolt config, README rebase, LEAF-B regression); the first two were single-step recoveries with clear diagnostics in the worker logs. The third was caught post-landing by a careful pre-submit verification of a later MR and surfaced cleanly via TaskList — a reminder that automation catches what its gates check, and the verification discipline at the human handoff still matters.

## Inputs preserved

The driving audit ([discussion/ui-state-vocabulary-audit/findings.md](../discussion/ui-state-vocabulary-audit/findings.md)) and ADR-039 itself are the durable record of what the chain executed. Worker prompts and per-step final logs live under `/home/node/gt/dashboard_chat/crew/<crew_name>/.logs/` in the gastown headless workspace for the duration of that workspace's life; they were not migrated into this repo because the prompt content is captured at the conceptual level by the audit + this evolution doc.
