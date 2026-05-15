# ADR-039: ui-state Vocabulary and Bounded-Context Naming Conventions

**Status:** Accepted (ratified 2026-05-15)
**Date:** 2026-05-15
**Originating wave:** DESIGN — `ui-state-vocabulary-audit` follow-up
**Companion artifacts:**
- Source audit: `docs/discussion/ui-state-vocabulary-audit/findings.md` (Tier-3 §7 enumerates C1–C12; §8 sequences MR-A through MR-H; §9 lists the open questions resolved below)
- Sibling ADRs: ADR-027 (ui-state tier + framework), ADR-028 (XState v5 actor model; amended 2026-05-15 — "Machines own transitions; the log owns state"), ADR-029 (`active_scope` propagation contract), ADR-030 (flow-state topology + scaling; amended 2026-05-15 — projection as primary read model + async-invoke continuations via `event.output`)
- Divergence input: `docs/discussion/session-chat-context-architecture/directions.md` (Direction A + Direction F + Direction G, ratified into ADR-028 / ADR-030 amendments at commit `5d45951`)

## Context

The vocabulary audit landed on main at `446bdaa` as a static read of `ui-state/`'s event-name, state-name, context-field, and cross-machine-broadcast surfaces. It produced 17 findings across 3 tiers, and proposed 12 forward-looking conventions (audit §7 Tier 3 C1–C12) derived from de facto patterns already in the codebase plus a small set of corrections. The audit's MR-I (its own final follow-up) was to ratify those conventions in an ADR.

The team has resequenced: ratify the conventions **first**, execute rename MRs **after**. Rationale:

- Every rename MR (A–H per audit §8) makes vocabulary judgments. A binding reference document means each MR's reviewer applies a published rule, not a re-derived intuition.
- New feature MRs touching `ui-state/` continue landing throughout the rename journey. Those MRs need the rule today, not at the end of the rename sequence.
- The audit identified C1–C12 as **already-present de facto patterns** with a few corrections (audit §7 framing: "the conventions are derived from de facto patterns already in the codebase"). Ratifying them codifies existing knowledge rather than introducing a new style.

The audit also left 7 open questions (audit §9). Four of those affect canonicalization and are resolved inline below (Q1, Q2, Q4, Q6). Q3 (field-collapse property test) is a future verification task and out of scope; Q5 (session vs. chat session distinction) is resolved as a non-distinction by C12 below; Q7 (where to ratify) is resolved by this ADR existing.

`ui-state/` is **one bounded context** (audit §1 TL;DR): the project-context vs. session-chat machine split is a Single-Responsibility partition inside a shared ubiquitous language, not a context-map boundary. Both machines, the orchestrator, and the projection share one dictionary of terms (scope, intent, resource, session, project). This ADR governs the whole context.

## Decision drivers

- **De facto patterns already exist.** C1–C12 codify what most of the codebase already does; the work of this ADR is to mark the line so future code stops drifting.
- **Wire-protocol risk is asymmetric.** Some conventions (C1, C5, C8, C9) are essentially zero-risk to enforce going forward. Others (C2 state-entry suffix family, C12 machine-name leak) require coordinated rename MRs against FE consumers of `projection.context.*`. The conventions stand independent of when their backfill lands.
- **The amendments at `5d45951` already committed to lint-enforced architectural boundaries.** ADR-028 amendment + ADR-030 amendment together established that the discriminating test "is this internal handler state, or is it a contract between states?" is enforced by an ESLint custom rule (the snapshot-read prohibition). This ADR extends the same enforcement vehicle to two more boundaries (Q4, Q6 below). The infrastructure is shared; the rules are additive.
- **Earned Trust (principle 12).** Every convention this ADR commits to lint-enforcing names the rule's existence here; implementation lives in future code MRs. Each lint rule also commits to a probe (a synthetic violation file under the lint-probes directory pattern from ADR-030's amendment) so the rule's coverage is itself empirically demonstrated, not assumed.

## Decision outcome

### Part 1 — The C1–C12 conventions (normative)

Each convention is a binding rule for new code in `ui-state/lib/` and is the review criterion for MRs touching that tree. The audit's prose is preserved verbatim where stable; rationale and example clauses are expanded.

#### C1 — User-action event suffix

**Rule.** User-action events end in `_clicked`, `_submitted`, or `_sent`, depending on trigger shape. Past-tense imperative.

**Rationale.** The trigger shape is the audit's stable signal of "the user did a thing." Three suffixes cover the trigger families the FE produces: button clicks (`_clicked`), form submissions (`_submitted`), and message dispatches (`_sent`). Mixing tenses (`click_create_project` vs `create_project_clicked`) costs scanability for zero clarity gain.

**Example.** `sign_in_clicked`, `create_project_submitted`, `first_message_sent`. Anti-example: `open_deep_link` (bare verb, no trigger-shape suffix; audit Tier-2 #10).

#### C2 — Domain-event past-tense; one state-entry pattern

**Rule.** Domain events end in past-tense verb. State-entry events follow ONE pattern across the codebase. Q2 below resolves which pattern.

**Rationale.** Three competing state-entry suffixes (`_started`, `_displayed`, `_reached`, with a one-off `_settled` helper in `waitForSettledState`) currently coexist. Each suffix encodes a different mental model of "what state-entry means," and the orchestrator emits `_displayed` events **before any FE render happens** (audit §5), so the suffix is aspirational on a wire surface that does not own rendering. One pattern wins; the others rename.

**Resolution.** Q2 below selects `_settled`. State-entry events use `<state-name>_settled`.

**Example.** `session_list_settled` (post-rename of `session_list_displayed`), `no_projects_settled` (post-rename of `no_projects_displayed`). Anti-example: `session_active_reached` (one-off `_reached` suffix; audit Tier-2 #15).

#### C3 — Cross-machine broadcasts are payload-centric

**Rule.** Cross-machine broadcast events are named after the **payload shape** they deliver, not after the sender that produces them.

**Rationale.** A receiver should be able to handle a broadcast event without knowing which machine emitted it; that's the whole point of cross-machine event broadcast being mediated by the orchestrator (ADR-028's "no machine imports another machine"). Sender-centric names (`j001_ready`) re-introduce the sender into the receiver's vocabulary and quietly couple the receiver to the sender's identity.

**Example.** `project_ready` (payload-centric — carries `{ org_id, project_id, project_name, ... }`). Anti-example: `j001_ready` (sender-centric — encodes the journey-numbering vocabulary that was renamed in source long ago; audit Tier-1 #1). Audit MR-A renames `j001_ready` → `auth_ready` per this rule.

#### C4 — `__double_underscore__` prefix marks failure-simulation side channels

**Rule.** Events whose name begins and ends with `__` are reserved for failure-simulation probes. Production events MUST NOT use this prefix.

**Rationale.** ADR-038's failure-simulation naming-scheme decision retained `__force_failure__` and `__expire_token__` as event-transport renderings of canonical knob names. The `__double_underscore__` shape is a load-bearing visual marker that the event is a side channel, not a domain event. Production code that emits a `__name__` event is either (a) a probe site under `agent/` or `ui-state/` driven by the registry, or (b) a vocabulary leak that needs to be removed.

**Example.** `__force_failure__`, `__expire_token__`. Anti-example: a hypothetical `__user_signed_in__` production event would violate this rule.

#### C5 — `_count` suffix for observability counters

**Rule.** Write-only observability counters carried on machine context use the `_count` suffix.

**Rationale.** Three counter-naming conventions exist today (audit Tier-2 #6): `retries`, `reissue_attempts`, `retry_budget_used`, `scope_reconciled_count`, `stale_intents_dropped_count`. The `_count` suffix is the most explicit about "this number is a count of occurrences," is self-documenting, and is a tiny migration (audit MR-C bundles the renames).

**Example.** `scope_reconciled_count`, `stale_deeplinks_dropped_count`. Anti-example: `retries` (semantically a counter; renames to `retries_count` in MR-C).

#### C6 — `pending_` prefix for composer-text preservation

**Rule.** Machine-context fields that hold composer text the user has typed but not yet committed use the `pending_` prefix.

**Rationale.** This is canonical de facto: `pending_project_name` (project-context), `pending_first_message` (session-chat), `pending_org_name` (login). The fields all share the property "the user typed this into a composer; we hold it across a transition so the composer can be re-populated if the transition fails or returns to the prior state." `pending_` is the existing shape; this ADR ratifies it so new composer fields default to the convention.

**Example.** `pending_project_name`. Anti-example: a field named `unsaved_project_name` for the same concept would violate.

#### C7 — `intent_` prefix marks URL-level user wishes only

**Rule.** The `intent_` prefix on context fields marks **only** URL-level user wishes not yet confirmed or denied by the system. After audit Tier-1 #2's split (MR-D in audit §8), `intent_` does not name click-captured resume targets (those use `pending_resume_*`) or user-action commands (those become `_clicked` events per C1).

**Rationale.** The audit identified three meanings carried by the `intent_` prefix today (audit §5): deep-link intent (URL), transition intent (user-action), and resume intent (click-captured). The same field `intent_session_id` holds two of them with no nomenclature signal to disambiguate. The split into `deeplink_*` + `pending_resume_*` + `_clicked` events leaves `intent_` with one meaning. LEAF-1 of `refactor/session-chat-context-srp` (already on main as commit `c896bdb`) is consistent with C7 and was an early demonstration of the convention before formal ratification.

**Resolution.** Q4 below commits to lint enforcement of this rule.

**Example.** `intent_project_id` (URL-level deep-link). Anti-example: `intent_session_id` populated from a click in `capturePendingResumeIntent` (audit Tier-1 #2; renames to `pending_resume_session_id` in MR-D).

#### C8 — `_id` suffix for foreign-key references

**Rule.** Foreign-key references use the `_id` suffix. A bare `id` field name is reserved for the aggregate's own id when nested inside its own object (e.g., `project: { id, name }`).

**Rationale.** Pervasive de facto in the codebase. `project_id` (foreign-key reference from session-chat to a project), `session_id` (foreign-key reference to a session), `principal_id` (foreign-key reference to a principal). The nested-aggregate exception is the existing pattern at `user: { email, display_name }` and post-MR-C `project: { id, name }`.

**Example.** `project_id` (FK reference), `project: { id, name }` (aggregate-owned id, nested). Anti-example: `projectId` (camelCase; mixes JS convention into wire-protocol names that travel through Redis Streams as strings).

#### C9 — `_tag` suffix for discriminated-union markers

**Rule.** Discriminated-union markers — fields whose value selects which other fields are meaningful — use the `_tag` suffix.

**Rationale.** Canonical de facto: `underlying_cause_tag` on every recoverable-error projection (audit §4). The `_tag` suffix signals "this is the discriminator; read this first, then interpret the rest of the record." Without the suffix the marker reads as a regular field; with it, the reviewer (and the FE) knows to switch on it.

**Example.** `underlying_cause_tag` with values `dataset_not_found`, `dataset_access_denied`, `network_error`. Anti-example: `cause` for the same field (ambiguous between "cause string" and "cause discriminator").

#### C10 — State-name shape

**Rule.** State names are noun-shape (adjective or past-participle) for **settled** states, and gerund for **transient/invoke** states.

**Rationale.** The de facto rule already followed across most of the codebase (audit §3). Settled states describe a configuration the system is in (`ready`, `anonymous`, `project_selected`); transient states describe an activity the system is performing (`authenticating`, `loading_session_list`, `resuming_session`). Mixing the two within one machine reads as a tense slip; the reader can no longer tell from a state name whether the machine is doing something or waiting.

**Example.** Settled: `ready`, `project_selected`, `session_active`. Transient: `authenticating`, `loading_session_list`, `switching_project`. Anti-example: `session_list_visible` (audit Tier-2 #14 — FE-render vocab masquerading as a state shape; renames to `session_list_loaded`); `session_active_no_messages` (audit Tier-2 #7 — neither noun nor gerund, a shape; renames to `session_welcome`).

#### C11 — Dev-tooling vocabulary in dev-only contexts

**Rule.** Dev-tooling vocabulary ("harness", "rig", "probe", "fixture") is acceptable **only** in dev-tool and failure-simulation contexts: `shared/failure-simulation/`, harness directories under `tests/acceptance/`, and the agent's inspection probes. Production code under `ui-state/lib/`, `agent/lib/` (non-inspection), `backend/`, `frontend/`, and the wire surfaces between them MUST NOT use this vocabulary.

**Rationale.** Memory `feedback_no_harness_no_nwave_in_product_names.md` constrains: "harness" is overloaded; "nwave" is a dev tool. The audit found no product-vocabulary leaks from ui-state today (audit §7 C11), confirming the rule is already followed. The exception for the **named, grandfathered** `tests/acceptance/user-flow-state-machines/harness/` directory is preserved as a proper-noun survivor — the directory name is load-bearing in import paths and not worth renaming for purity.

**Example.** Acceptable: `shared/failure-simulation/manifest.ts` referencing the manifest as the dev-tool contract; `tests/acceptance/user-flow-state-machines/harness/` directory. Anti-example: an event named `harness_session_clicked` in `ui-state/`; a context field named `probe_attempts` on a production machine.

#### C12 — Machine-name leakage into projection fields is a smell

**Rule.** Field names in `FlowProjection.context` describe the **data**, not the **producer**. A field name that begins with a machine name (`session_chat_*`, `project_context_*`) is a smell and a violation.

**Rationale.** Audit Tier-1 #5 identified `session_chat_project_id` and `session_chat_project_name` as the only current violations: project-context and session-chat both maintain project state, and the projection holds both with prefixed field names instead of collapsing them. Consumers of the projection (the FE, the acceptance harness) do not care which machine wrote a field; they care what it represents. The prefix is a producer-leak that exists today because the field-collapse property test (audit §9 Q3) has not been written.

**Resolution.** Q6 below commits to lint enforcement of this rule.

**Example.** `project_id`, `project_name`, `project: { id, name }`. Anti-example: `session_chat_project_id` (audit Tier-1 #5; renames are part of MR-H, with the field-collapse step gated on the property test from Q3).

### Part 2 — Open-question resolutions

The audit deferred 7 questions to the team. The four that affect canonicalization are resolved below; the other three are resolved by closure or scope.

#### Q1 (resource vs. dataset) — RESOLVED: (b) YAGNI-collapse to `"dataset"`

**Question (audit §9 #1).** Commit to "resource" as polymorphic supertype (rename event names + cause tags to `resource_*`), OR YAGNI-collapse `ResourceType` to just `"dataset"`?

**Resolution.** **(b) YAGNI-collapse `ResourceType` to `"dataset"`**, restore polymorphism when a second resource type actually ships.

**Rationale.**
- `ResourceType = "dataset" | "view" | "report"` exists with no `view` or `report` actually instantiated anywhere in the codebase. The polymorphism is forward-compatible scaffolding that no consumer needs today.
- Option (a) is **high wire-protocol risk** (audit §8 MR-E (a): renames every dataset-named event + cause tag, breaks every FE consumer of `projection.context.underlying_cause_tag`, breaks every acceptance fixture that asserts on `dataset_*` cause-tag values).
- Option (b) is **trivially low risk** (audit §8 MR-E (b): the rename is `ResourceType = "dataset"` — internal type narrowing — and a follow-up audit pass when a second type ships restores the polymorphism with knowledge of what the second type actually looks like, instead of guessing.
- The user-action event names like `dataset_resolved_by_agent` and `dataset_picked_directly` stay either way; they describe user actions on dataset specifically (FE dataset chip; agent's dataset tool). Only the polymorphism scaffolding is collapsed.
- The discipline of "design for the polymorphism when the second case appears, not when the first case exists" is the same discipline ADR-038 followed for the `legacyAlias` field (transitional, scoped to one MR's lifetime). Speculation now costs renames later.

**Consequence for MR-5 of session-chat.** The state name `switching_dataset_context` is canonical under (b); no rename pressure from this ADR. When a second resource type ships, that work will include the rename pass back to `resource_*`. The convergence direction is recorded; the migration is YAGNI-deferred.

#### Q2 (`_displayed` family) — RESOLVED: rename to `_settled`

**Question (audit §9 #2).** Rename `no_projects_displayed` / `scope_mismatch_displayed` / `session_list_displayed` / `session_welcome_displayed` → `_settled` (matches `waitForSettledState` helper), OR document the existing convention?

**Resolution.** **Rename family to `_settled`.** Land via audit MR-G as a coordinated wire-protocol rename.

**Rationale.**
- The audit makes the semantic argument plainly (§5 `_displayed` suffix family): "the orchestrator emits these before any FE render happens; 'displayed' is aspirational." The wire surface where the events live does not own rendering; naming the event after rendering is a fact-of-the-matter slip.
- `_settled` accurately describes what the orchestrator can observe: the machine has reached a settled state and the projection is consistent with that state. The `waitForSettledState` helper already uses this vocabulary; the convention exists in one half of the codebase, and we're aligning the other half.
- The rename is **high risk** (audit Tier-2 #9: wire-protocol; FE + acceptance harness both consume the event names). MR-G is a focused coordinated rename, not bundled into the smaller MR-C.
- The defensible alternative — document and keep `_displayed` — fails the test that this ADR also applies the rule to **new** events. Without renaming, the next state-entry event has no canonical pattern; reviewers would face the choice every time. One pattern wins.
- C2 above bakes the `_settled` decision into the convention; the alternative would have weakened C2 to "either `_displayed` or `_settled`," which is exactly the proliferation problem this ADR exists to stop.

**Sequencing note.** MR-G is sequenced after MR-D and MR-F (audit §8) so the highest-risk Tier-1 wire renames land first; `_settled` is Tier-2 in audit terms and lower-priority. This ADR does not schedule it; it commits to the destination.

#### Q4 (`intent_` enforcement) — RESOLVED: lint rule

**Question (audit §9 #4).** Lint rule (ESLint custom or `eslint-plugin-boundaries`-style) for C7's `intent_` prefix discipline, OR convention via PR review?

**Resolution.** **Lint rule.** Commit to its existence; implementation is a future code MR (likely bundled with the snapshot-read prohibition probe from ADR-030's amendment, since the enforcement vehicle is the same).

**Rationale.**
- Convention-via-review degrades over time. The audit identified three meanings carried by `intent_` today **with no reviewer having caught the drift**, even though the codebase has had multiple PRs touching these fields. PR review is not sufficient evidence that the rule will hold.
- ESLint's `no-restricted-syntax` over `Identifier[name=/^intent_/]` filtered by file path (machine context type definitions only) is the lowest-ceremony fit. The rule's allow-list lives next to the ADR-030 snapshot-read rule's allow-list; the operational cost is shared.
- Per principle 12, the rule's own coverage is enforced by a probe. The probe is a synthetic file under `ui-state/lib/lint-probes/` (the directory pattern ADR-030's amendment established) that declares a fake context field named `intent_session_id` after MR-D removes the legitimate use, and asserts the rule flags it. Without the probe the rule is faith, not evidence.

**Sequencing note.** The rule cannot turn on until MR-D (audit §8) lands and removes the legitimate `intent_session_id` carrying click-captured resume target. The rule's installation is therefore post-MR-D. Until then, the convention is review-enforced; this ADR is the published reference for that review.

#### Q6 (machine-name-prefix enforcement) — RESOLVED: lint rule

**Question (audit §9 #6).** Lint rule banning machine-name prefixes on projection fields (C12), OR convention via review?

**Resolution.** **Lint rule.** Same enforcement vehicle as Q4.

**Rationale.**
- Same argument as Q4: convention degrades; lint does not.
- The specific violation set (`session_chat_*` fields on `FlowProjection.context`) is narrow and grep-able. ESLint `no-restricted-syntax` over `TSPropertySignature[key.name=/^(session_chat|project_context)_/]` filtered by file path (`ui-state/lib/projection.ts` and any file that types `FlowProjection.context`) is the fit.
- Per principle 12, a probe under `ui-state/lib/lint-probes/` declares a fake `session_chat_pending_message` field and asserts the rule flags it.

**Sequencing note.** The rule cannot turn on until MR-H (audit §8) completes the field collapse — the legitimate `session_chat_project_id` / `session_chat_project_name` are flagged today and would block the merge queue. Until then, review-enforced; this ADR is the reference.

#### Q3 (field collapse property test), Q5 (session vs. chat session), Q7 (where to ratify) — RESOLVED by scope

- **Q3** is a future verification task (write a property test asserting that project-context and session-chat agree on project state post MR-4 before collapsing the duplicate fields). It does not affect the canonicalization rules in C1–C12 and is out of this ADR's scope. The MR-H step that collapses the fields is gated on Q3 in the audit's MR sequence; nothing here changes that.
- **Q5** is closed as a non-distinction. C12 above states the rule that resolves it: "session" and "chat session" describe the same domain entity; the `session-chat` machine is named for its responsibility, not for a distinct domain concept. The only true leak (`session_chat_project_id` projection field) is named by C12 and migrated in MR-H. No glossary entry needed; the convention itself records the rule.
- **Q7** is resolved by this ADR existing under `docs/decisions/adr-039-ui-state-naming-conventions.md`. The conventions live in an ADR (not `ui-state/CONVENTIONS.md` or `ui-state/README.md`) because (a) ADRs are the project's canonical decision artifacts, (b) cross-ADR references already weave naming decisions through ADR-028, ADR-029, ADR-030, and ADR-038 — keeping conventions in the same series keeps the graph navigable, (c) `ui-state/CONVENTIONS.md` would be a parallel canonical reference, and parallel canonicals drift.

### Part 3 — Enforcement tiers

Conventions split into three enforcement tiers. The tier governs **how the rule is checked**, not whether it is binding (all C1–C12 are binding).

#### Tier E1 — Lint-enforced (mechanical, blocking)

Conventions checked by ESLint custom rules running in the pre-commit eslint pass (existing infrastructure; no new gate). Each rule has a probe under `ui-state/lib/lint-probes/`.

| Convention | Rule subject | Probe |
|---|---|---|
| **C4** — `__double_underscore__` reserved for failure-simulation | Event-name string literals in `ui-state/lib/**/*.ts` outside `ui-state/lib/**/*.test.ts` and outside files importing from `shared/failure-simulation/` | Synthetic production-source `__user_signed_in__` emission flagged |
| **C7** — `intent_` prefix marks URL-level wishes only | `TSPropertySignature[key.name=/^intent_/]` in machine-context type definitions outside the allow-list (`deeplink` allow-list TBD by MR-D) | Synthetic context type with `intent_session_id` declared after MR-D flagged |
| **C12** — Machine-name prefix on projection fields | `TSPropertySignature[key.name=/^(session_chat|project_context)_/]` in `ui-state/lib/projection.ts` and `FlowProjection.context` type definitions | Synthetic projection field `session_chat_pending_message` flagged |

The lint rule for the snapshot-read prohibition (ADR-030 amendment) shares this enforcement vehicle. Installation timing per the migration notes in Q4 and Q6 above.

#### Tier E2 — PR-review enforced (judgment, blocking)

Conventions that resist mechanical checking because the rule's subject is **semantic** rather than syntactic. Reviewers (human and agent) apply these rules explicitly against this ADR as the published reference.

| Convention | Why not lint |
|---|---|
| **C1** — User-action event suffix (`_clicked` / `_submitted` / `_sent`) | The rule's subject is "is this event a user-action?" — a semantic judgment from context, not a syntactic pattern. Grep-checking `Identifier[name=/^[a-z_]+_(clicked|submitted|sent)$/]` produces false positives (`org_form_submitted` is correct; `validation_failed` would be misclassified by a permissive rule). |
| **C2** — Domain-event past-tense + state-entry `_settled` | Same as C1: "is this a domain event vs a state-entry event vs a user action?" is a semantic judgment. The narrow lintable slice — "no `_started`, `_displayed`, `_reached` suffixes in new code" — is a candidate for follow-up after MR-G lands, but not committed here. |
| **C3** — Payload-centric naming for cross-machine broadcasts | The rule's subject is "does this name encode the sender?" — that requires the reviewer to know which machine is the sender. No mechanical proxy. |
| **C10** — State-name shape (noun for settled; gerund for transient) | The rule's subject is "is this state settled or transient?" — a semantic judgment about the machine's transition graph. Reviewers infer from `invoke` blocks, transition targets, etc. |
| **C11** — Dev-tooling vocabulary in dev-only contexts | The vocabulary list ("harness", "rig", "probe", "fixture") is small and grep-able, but the allow-list (`shared/failure-simulation/`, harness directories, agent inspection) is path-based and easy to mis-tune. Review is the right granularity. Memory `feedback_no_harness_no_nwave_in_product_names.md` is the published reference reviewers use. |

#### Tier E3 — Documentation-enforced (canonical knowledge, non-blocking)

Conventions that are essentially de facto and unlikely to be violated by accident. The rule is documented so contributors building new features have a canonical reference; no automation blocks new violations because there is no recent history of violation.

| Convention | Rationale for tier |
|---|---|
| **C5** — `_count` suffix for observability counters | Audit Tier-2 #6: small set of existing violations, all in MR-C. Once MR-C lands, the codebase passes this rule and new contributors writing counters will match the surrounding convention. |
| **C6** — `pending_` prefix for composer-text preservation | Already universally followed across login, project-context, session-chat. New composer fields default to the convention by surrounding-code mimicry. |
| **C8** — `_id` suffix for foreign-key references | Pervasive de facto. No recent violations. |
| **C9** — `_tag` suffix for discriminated-union markers | Canonical (`underlying_cause_tag` everywhere). No recent violations. |

If a new violation pattern emerges in Tier E3, the rule moves to E2 (review) or E1 (lint); the tiering is the **current** enforcement level, not a permanent assignment.

## Consequences

### Positive

- **New feature MRs touching `ui-state/` now have a binding reference.** Reviewers cite C-numbers; contributors read one document. The rename journey (MR-A through MR-H) lands against a stable target.
- **Three lint rules (C4, C7, C12) join the existing ADR-030-amendment snapshot-read rule** under a common probe + enforcement infrastructure. Marginal cost per rule is low.
- **The four open questions that block canonicalization (Q1, Q2, Q4, Q6) are resolved on the date this ADR is ratified**, with explicit rationale. Future contributors do not have to re-derive the answer.
- **The Q3, Q5, Q7 open questions are resolved by scope.** Q5 in particular — closed as a non-distinction — short-circuits the temptation to overspecify domain vocabulary.
- **LEAF-1 of `refactor/session-chat-context-srp`** (commit `c896bdb`) is retroactively documented as an early demonstration of C7. Its conformance with the convention before ratification is a small piece of evidence that C7 was already de facto.

### Negative / accepted trade-offs

- **Wire-protocol rename risk is preserved.** This ADR commits to destinations but does not execute them. Until MR-D, MR-F, MR-G, MR-H land, the codebase contains conventions-violating names. Reviewers must apply judgment to distinguish "grandfathered until rename MR lands" from "new violation introduced today."
- **Three new lint rules cannot install until their migration MRs land.** C7's lint rule waits for MR-D; C12's lint rule waits for MR-H. The interim is review-enforced and depends on reviewer discipline. The published rule in this ADR reduces but does not eliminate that exposure.
- **The defensible alternative on Q2 — document-and-keep `_displayed`** — is forgone. The cost is the coordinated wire-protocol rename in MR-G; the benefit is consistency for new state-entry events under C2. The ADR commits to the renames.
- **Q1 chose YAGNI.** When a second resource type (view or report) ships, a rename pass restores polymorphism. The audit logged this as `_resource_*` family destination if option (a) had been picked; option (b) defers that work until the polymorphism actually has a consumer. The trade is concretely: cheaper now, one-rename-pass later. The team has the option (a) destination on record if conditions change.

### Neutral

- **The "harness" exception for `tests/acceptance/user-flow-state-machines/harness/`** (C11) is grandfathered as a proper-noun directory name. If the directory is restructured for unrelated reasons, that rename can fold in C11 compliance. Until then, the directory's name is load-bearing on import paths and not worth churning.
- **The MR-A through MR-H sequence is the migration journey.** This ADR does not re-enumerate or schedule it; the audit §8 is the canonical sequence. Sequencing is owned by whichever wave commits delivery capacity (DISTILL → DELIVER).

## Migration path

The journey from current state (audit-identified violations) to fully-conformant state is owned by **audit §8's MR-A through MR-H sequence**. This ADR is the published destination for each MR; the sequence itself is not re-derived here.

A few sequencing dependencies worth surfacing:

- **MR-A → MR-G:** The lowest-risk renames (internal cross-machine events; tier-2 internal renames) land first to establish the rename pattern. MR-G's `_settled` rename is sequenced after the highest-risk Tier-1 renames have landed (MR-D, MR-F), to avoid bundling unrelated risk in one MR.
- **MR-D → C7 lint rule installation.** The lint rule (Tier E1) cannot turn on until MR-D has removed the legitimate `intent_session_id` carrying click-captured resume target.
- **MR-H field-collapse step → C12 lint rule installation.** The rule (Tier E1) cannot turn on until the legitimate `session_chat_project_id` / `session_chat_project_name` projection fields have been collapsed.
- **Q3 (field-collapse property test) gates the MR-H field-collapse step.** The audit's recommendation stands: write a property test asserting agreement between project-context and session-chat on project state before collapsing the duplicate fields.

LEAF-1 of `refactor/session-chat-context-srp` (commit `c896bdb`, already on main) is consistent with C7 and was an early demonstration of the convention. The remaining LEAFs of that branch interact with ADR-030's amendments (snapshot-read prohibition, async-invoke continuations); this ADR does not re-sequence them.

## References

- `docs/discussion/ui-state-vocabulary-audit/findings.md` — the source audit (commit `446bdaa`)
- `docs/discussion/session-chat-context-architecture/directions.md` — Direction A + Direction F + Direction G, ratified into ADR-028 / ADR-030 amendments at commit `5d45951`
- `docs/decisions/adr-027-flow-state-tier-and-framework.md` — ui-state tier and framework
- `docs/decisions/adr-028-xstate-v5-actor-model.md` — XState v5 actor model; amended 2026-05-15 (machines own transitions; the log owns state)
- `docs/decisions/adr-029-active-scope-propagation-contract.md` — `active_scope` propagation contract
- `docs/decisions/adr-030-flow-state-topology-and-scaling.md` — flow-state topology + scaling; amended 2026-05-15 (projection as primary read model; async-invoke continuations via `event.output`; migration sequencing)
- `docs/decisions/adr-038-failure-simulation-naming-phase-plan.md` — failure-simulation naming scheme (informs C4's `__double_underscore__` shape)
- Memory `feedback_no_harness_no_nwave_in_product_names.md` — vocabulary hygiene constraints reflected in C11
- LEAF-1 of `refactor/session-chat-context-srp` — commit `c896bdb`, early demonstration of C7
