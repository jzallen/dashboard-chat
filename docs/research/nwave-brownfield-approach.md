# Research: nWave-ai Approach to Brownfield Software Development

**Date**: 2026-04-24 | **Researcher**: nw-researcher (Nova) | **Confidence**: Medium-High | **Sources**: 15

## Executive Summary

nwave-ai treats brownfield work as a **wave-routing problem**, not as a separate track. The framework's canonical seven-wave sequence (DISCOVER → DIVERGE → DISCUSS → [SPIKE] → DESIGN → DEVOPS → DISTILL → DELIVER) is designed to be entered at whatever wave matches the state of the existing system: brownfield feature work starts at DIVERGE or DISCUSS, pure refactoring enters at DESIGN (or jumps straight into DELIVER on an existing green test suite), and bug fixes enter at DISTILL when the cause is known or DISCOVER when it is not. Beneath that routing layer, nwave ships a coherent stack of legacy-oriented skills — `nw-legacy-refactoring-ddd`, `nw-mikado-method`, `nw-progressive-refactoring` (the RPP L1–L6 ladder), `nw-hotspot`, and the `/nw-refactor` command driven by Crafty (nw-software-crafter). The invariant "every feature ends with DISTILL → DELIVER. No exceptions." guarantees brownfield changes still land behind an acceptance-test contract. Characterization tests (Feathers) appear inside the Legacy-DDD skill as the first step before touching legacy code; they are the brownfield analog to the greenfield walking skeleton.

## Research Methodology

**Search Strategy**: Primary sources first — the nwave GitHub repo (`nWave-ai/nWave`) including the wave-routing guide, the local skill library at `~/.claude/skills/nw-*/SKILL.md`, and the authors' public posts/events. Secondary: WebSearch for independent validation of claims like RPP origin, Mikado origin, characterization tests.
**Source Selection**: Official nwave repository (High — primary source for behavior), local installed skill bodies (High — ground truth of what ships), author event abstracts (Medium-High — authorial intent), Fowler/Feathers/Ellnestam (High — methodology origins).
**Quality Standards**: 2-3 sources per major claim; primary-source-first where possible; explicit flagging of any claim backed only by a single skill body or a single README line.

## Findings

### Finding 1: Brownfield entry points are defined by the wave-routing matrix, not a separate workflow

**Evidence**: The nwave README states: "Brownfield feature: Start at DIVERGE or DISCUSS, skip to DESIGN" and "Refactoring: Jump to DELIVER (green already, refactor inside existing tests)". The full matrix in `docs/guides/wave-routing-and-entry-points/README.md` formalizes this:

| Work Category | Starting Wave | Path | Context |
|---|---|---|---|
| Greenfield project | DISCOVER or DIVERGE | full sequence | all waves |
| Brownfield feature | DIVERGE | DIVERGE → DISCUSS → DESIGN → DEVOPS → DISTILL → DELIVER | multiple approaches exist |
| Refactoring | DESIGN | DESIGN → DISTILL → DELIVER | behavior preserved, structure changes |
| Technical story | DESIGN | DESIGN → DISTILL → DELIVER | scope clear |
| Bug fix (cause known) | DISTILL | DISTILL → DELIVER | fix obvious |
| Bug fix (cause unknown) | DISCOVER | DISCOVER → DISTILL → DELIVER | root cause TBD |
| Infrastructure | DEVOPS | DEVOPS → DISTILL → DELIVER | new infra |

**Invariant**: "Every feature ends with DISTILL → DELIVER. No exceptions."
**Source**: [nWave README](https://github.com/nWave-ai/nWave) + [Wave Routing Guide](https://github.com/nWave-ai/nWave/tree/main/docs/guides/wave-routing-and-entry-points/) — Accessed 2026-04-24
**Verification**: `~/.claude/skills/nw-buddy-wave-knowledge/SKILL.md` gives the canonical sequence and notes "Skipping waves is a smell; going back to revise an earlier wave is normal and expected."
**Confidence**: High
**Analysis**: There is no "brownfield mode" flag. The framework expects the invoker to choose an entry wave based on what artifacts already exist. DIVERGE is the default brownfield starting point when multiple solution paths are viable; DISCUSS is correct when the problem is already framed and only stories are missing; DESIGN is correct when the refactoring scope is clear.

### Finding 2: Refactoring Priority Premise (RPP) has six levels applied in mandatory cascade

**Evidence**: The local skill `nw-progressive-refactoring/SKILL.md` defines the full RPP ladder:

| Level | Focus | Primary smells | Transformations |
|---|---|---|---|
| L1 Readability | Eliminate clutter, naming, dead code | Dead Code, Comments, Speculative Generality, Lazy Class | Rename, Extract (variables/constants), Safe Delete |
| L2 Complexity | Method extraction, duplication | Long Method, Duplicate Code, Complex Conditionals | Extract (methods), Move |
| L3 Responsibilities | Class responsibilities, coupling | Large Class, Feature Envy, Data Class, Divergent Change, Shotgun Surgery | Move, Extract (classes) |
| L4 Abstractions | Parameter objects, value objects | Long Parameter List, Data Clumps, Primitive Obsession, Middle Man | Extract (objects), Inline |
| L5 Design Patterns | Strategy, State, Command | Switch Statements, state-dependent behavior | Extract (interfaces), Move |
| L6 SOLID++ | SOLID, architectural patterns | Refused Bequest, Parallel Inheritance Hierarchies | Extract (interfaces), Move, Safe Delete |

**Cascade rule** (quoted): "MANDATORY: complete each level fully before moving to the next. Do not skip levels. 80% of refactoring value comes from readability improvements (L1-L2)."

`/nw-refactor` accepts `--level`, `--from`, `--to`, `--scope`, `--method`, `--mikado_planning` flags and delegates to Crafty (`nw-software-crafter`). Example: `/nw-refactor src/billing/ --level=6 --scope=module --mikado_planning=true` uses Mikado for multi-class refactoring.

**Source**: `~/.claude/skills/nw-progressive-refactoring/SKILL.md` + `~/.claude/skills/nw-refactor/SKILL.md` — Accessed 2026-04-24
**Verification**: RPP is attributed to "the Alcor Academy curriculum" in the skill body. Independent verification of RPP's origin is left as an uncertainty (see below).
**Confidence**: High (for what nwave ships) / Medium (for origin attribution)
**Analysis**: Three important practical escape hatches: (a) **Fast-Path** — when the GREEN phase added < 30 LOC, a 2-3 min scan is enough; (b) **L4-L6 Timing** — architecture refactoring runs at orchestrator "Phase 2.25" (once after all delivery steps), not inside each TDD inner loop; (c) **Mikado planning** can be opted in per-invocation.

### Finding 3: Legacy-Refactoring-DDD is the strategic compass; Mikado and Progressive-Refactoring are the tactical executors

**Evidence**: Quote from `nw-legacy-refactoring-ddd/SKILL.md`: "DDD tells you WHERE and WHY to refactor; traditional techniques (progressive-refactoring, mikado-method) tell you HOW." The skill defines a four-phase migration methodology:

1. **Understand and Stabilize** — run EventStorming (Big Picture), assess with Cynefin, **write characterization tests for critical paths (Feathers technique)**, identify bounded contexts via language divergence.
2. **Modularize the Monolith** — module structure aligned to bounded contexts, mediator pattern for initial decoupling, fitness functions for coupling/cohesion/dependency direction.
3. **Introduce Events and CQRS** — replace mediator with events, introduce CQRS where beneficial, expand/contract DB splits.
4. **Extract Services** (if justified by six microservices readiness signals) — strangler fig per context.

The skill enumerates 14 patterns grouped as strategic (Strangler Fig, Bubble Context, Evolve Context Map, Split/Merge Bounded Context), tactical (VOs, Enrich Anemic Model, Domain Events, Domain Service, CQRS), and infrastructure (DB Split, Event Sync, Mediator→Events, Extract Microservice).

**Source**: `~/.claude/skills/nw-legacy-refactoring-ddd/SKILL.md` — Accessed 2026-04-24
**Verification**: Michael Feathers' characterization-test technique is independently documented ([Wikipedia: Characterization test](https://en.wikipedia.org/wiki/Characterization_test); [Feathers on Silvrback](https://michaelfeathers.silvrback.com/characterization-testing)). Strangler Fig originates with Fowler (martinfowler.com, 2004). Bubble Context comes from Eric Evans' DDD literature.
**Confidence**: High
**Analysis**: This is where nwave's brownfield doctrine is most explicit: **you characterize before you refactor**. Characterization tests pin down current behavior (even when "behavior seems wrong") before any structural change. The skill also provides a "When NOT to refactor" list including "system scheduled for replacement", "stable system with no new development", "domain is genuinely simple (CRUD-dominated)".

### Finding 4: Mikado Method is the nwave protocol for multi-class refactorings with unclear dependency graphs

**Evidence**: `nw-mikado-method/SKILL.md` describes the method as: "Set Goal > Experiment > Visualize prerequisites > Revert to working state." Core innovations in nwave's implementation:

- **Two modes**: Exploration (attempt naive impl → capture failures → add nodes → commit tree → revert code → repeat) and Execution (leaf-first, bottom-up, one leaf at a time, 10-min timebox).
- **Tree file**: `docs/mikado/<goal-name>.mikado.md` with strict indentation rules.
- **Commit discipline**: mandatory format, e.g., `Discovery: [Class.Method(params)] requires [Prerequisite] in [File:Line]`.
- **Integration with Legacy-DDD**: "Use Mikado exploration to discover dependencies before strangler fig extraction. Each Mikado leaf = one atomic DDD refactoring step."

**Source**: `~/.claude/skills/nw-mikado-method/SKILL.md` — Accessed 2026-04-24
**Verification**: Mikado Method was created by Daniel Brolund and Ola Ellnestam ("The Mikado Method", Manning, 2014). The core cycle (set goal → experiment → graph → revert) is faithful to the book. nwave adds structured commit formats and explicit integration points.
**Confidence**: High
**Analysis**: Mikado is the right tool when a naive change produces a cascade of failures. The skill description warns it is "experimental". Practical trigger from the `/nw-refactor` documentation: use `--mikado_planning=true` for multi-class refactoring (Example 2: `/nw-refactor src/billing/ --level=6 --scope=module --mikado_planning=true`).

### Finding 5: `/nw-hotspot` is a pure-git churn analyzer that feeds every brownfield workflow

**Evidence**: `nw-hotspot/SKILL.md` defines four modes — Analyze (default), Rank (post-filter an existing report), Detail (deep-dive one file), JSON export (pre-filter for other skills). Ranking is pure `git log --name-only` churn: **no complexity metrics**. Claimed inspirations: Adam Tornhill's "Your Code as a Crime Scene".

Documented compositions:
- **Pre-filter**: `/nw-hotspot --top=10 --json` then feed file list to code-smell-detector, cognitive-load-analyzer, or refactoring-expert.
- **Post-filter**: `/nw-hotspot --rank report.md` overlays churn on existing findings.
- **Before nwave workflows**: "Before `/nw-refactor` — identify which files to refactor first. Before `/nw-review` — focus review effort on high-churn areas. Before `/nw-root-why` — check if the problematic area is a known hotspot."

**Source**: `~/.claude/skills/nw-hotspot/SKILL.md` — Accessed 2026-04-24
**Verification**: Tornhill's "Your Code as a Crime Scene" (Pragmatic Bookshelf, 2015; 2nd ed. 2024) establishes the pattern of using VCS data for risk prioritization.
**Confidence**: High
**Analysis**: For a brownfield team, `/nw-hotspot` is the cheapest prioritization signal: no static analysis, no ASTs, just commit frequency as a proxy for risk. Outputs are inline (no persistent files), so it composes cleanly into any downstream skill.

### Finding 6: Characterization tests are nwave's brownfield analog to the walking skeleton

**Evidence**: `/nw-spike` can "promote to walking skeleton" (mentioned in buddy-wave-knowledge). In brownfield, `nw-legacy-refactoring-ddd/SKILL.md` explicitly specifies characterization tests in Phase 1: "Write characterization tests for critical paths (Feathers technique)" and later: "Characterization tests (Feathers): run legacy code, observe output, write tests that assert current behavior — even if behavior seems wrong. These tests protect against unintended changes during refactoring." The skill's testing-strategy table assigns characterization tests as the first line of defense "before touching legacy code".

**Source**: `~/.claude/skills/nw-legacy-refactoring-ddd/SKILL.md` + [Feathers, "Working Effectively with Legacy Code", Prentice Hall, 2004](https://michaelfeathers.silvrback.com/characterization-testing) — Accessed 2026-04-24
**Verification**: Feathers' technique is canonical in legacy-code literature. nwave does not ship a dedicated `nw-characterization-tests` skill — the technique is absorbed into Legacy-DDD.
**Confidence**: High
**Analysis**: The equivalence is: greenfield walking skeleton = first end-to-end thread with tests; brownfield characterization tests = pin down existing end-to-end behavior with tests that assert what *is*, not what *should be*. Both establish a testable baseline before structural work.

### Finding 7: The Iron Rule meets pre-existing theater tests through the test-refactoring-catalog, not silencing

**Evidence**: The SW Craftsmanship Dojo article on nwave states the crafter's hard-coded constraints: "The agent cannot skip the red phase. It cannot commit with failing tests. It cannot modify a test to make it pass. These constraints are not suggestions; they are hard coded into the agent's protocol." Also: "All tests green. No mocks inside the hexagon. Test count within budget."

In brownfield, these constraints meet pre-existing tests that are tautological, assertion-free, or mirror implementation. nwave ships `nw-test-refactoring-catalog` with the same L1-L3 taxonomy as production code:
- **L1 Readability**: Obscure Test (rename to `ProcessOrder_PremiumCustomer_AppliesCorrectDiscount()`); Hard-Coded Test Data (extract named constants); Assertion Roulette (descriptive messages per assertion).
- **L2 Complexity**: Eager Test (split by scenario); Test Code Duplication (extract helpers like `CreatePremiumCustomer()`); Conditional Test Logic (parameterize).
- **L3 Organization**: Mystery Guest (inline test data); Test Class Bloat (split by feature); General Fixture (per-test setup).

`nw-progressive-refactoring/SKILL.md` tracks the same test smells at each RPP level and points: "For test code smells (9 smells with detection patterns and before/after examples), load the test-refactoring-catalog skill."

**Source**: `~/.claude/skills/nw-progressive-refactoring/SKILL.md` + [nw-test-refactoring-catalog SKILL](https://github.com/nWave-ai/nWave/blob/main/nWave/skills/nw-test-refactoring-catalog/SKILL.md) + [SW Craftsmanship Dojo — Claude Code and nWave](https://swcraftsmanshipdojo.com/blog/claude-code-nwave/) — Accessed 2026-04-24
**Verification**: Test-smell taxonomy traces to Meszaros' "xUnit Test Patterns" (2007). The three crafter constraints are stated verbatim in the Dojo article.
**Confidence**: Medium-High — the Iron Rule constraint is explicit; a single decision-tree document for "delete vs. rewrite theater tests" was not located.
**Analysis**: The Iron Rule protects against *weakening* a currently-failing test. A theater test that asserts nothing is not failing — it is passing vacuously, so the Iron Rule does not bind. Refactoring or deleting such a test is a test-code RPP operation (L1-L3) and is allowed. Practically: rename + add real assertions (L1), split eager tests (L2), or delete if the test is an implementation mirror with zero behavioral value. When in doubt, write a characterization test first, then delete the theater test once the characterization covers the actual behavior.

### Finding 8: The `/nw-bugfix` workflow is a concrete example of brownfield routing

**Evidence**: `nw-bugfix/SKILL.md` defines a three-phase pipeline: (1) Root Cause Analysis via `nw-troubleshooter` running `/nw-root-why`, (2) user review (interactive stop), (3) regression test + fix via `/nw-deliver`. The regression test is always written RED first, against current buggy code, and must still pass after the minimal fix. The skill explicitly states: "Keep the fix minimal. Refactoring belongs in `/nw-refactor`, not here. If the RCA reveals a design flaw (not just a code bug), escalate to `/nw-design` before fixing."

**Source**: `~/.claude/skills/nw-bugfix/SKILL.md` — Accessed 2026-04-24
**Verification**: Matches the wave-routing guide's "Bug fix (cause known): DISTILL → DELIVER; Bug fix (cause unknown): DISCOVER → DISTILL → DELIVER."
**Confidence**: High
**Analysis**: The hard separation between bug fix and refactor is load-bearing: it prevents a fix from silently absorbing cleanup, keeping commits reviewable and the Iron Rule intact.

### Finding 9: Authors are publicly demonstrating brownfield with nwave

**Evidence**: Create With event "From Spaghetti to Ravioli: AI-Guided Refactoring with nWave" (Montreal, Mar 2026) features co-creators Alessandro Di Gioia and Michele Brissoni running a live AI-guided refactor of "a legacy React ticket-booking system." Quote: "See how nWave.ai guides an AI-coding orchestrator to add features live to a monolithic React system." Session framing: "practical, repeatable workflow for modernizing code with confidence."

**Source**: [Create With Montreal event page](https://www.createwith.com/event/montreal-from-spaghetti-to-ravioli-ai-guided-refactoring-with-nwave-mar-2026) — Accessed 2026-04-24
**Verification**: Authors confirmed via [BriX Consulting team page](https://brix.consulting/team/). Di Gioia is co-author of "Agile Technical Practices Distilled" (Packt). Brissoni founded the SW Craftsmanship Dojo.
**Confidence**: Medium-High — event description does not document specific commands or workflow, only that the live session will demonstrate them. A recording/write-up would upgrade to High.
**Analysis**: This confirms that brownfield is an intentional design target, not a side effect. The case study is a monolithic React app — highly relevant to Dashboard Chat's React + FastAPI + Hono stack.

## Recommendations for Dashboard Chat

Given: ADRs 001–012 already documented; existing test harnesses across frontend (Vitest), backend (pytest), worker (Hono tests); Bazel-driven CI; ad-hoc workflow migrating to nwave; CLAUDE.md already codifies tdd-first editing.

**Step 1 — Run `/nw-hotspot --top=20 --since=12m` as the first nwave command on the repo.**
Produce the ranked churn list and commit it as `docs/research/nwave-hotspot-2026-04-24.md` (or keep inline). Use the top-10 list to seed every subsequent refactoring and review effort. This is cheap, read-only, and immediately tells the team which files deserve the first characterization-test investment. Follow with `/nw-hotspot --detail <top-file>` on the top 2-3 to see co-change coupling.

**Step 2 — For the first brownfield feature, enter at DISCUSS (not DIVERGE, not DESIGN).**
ADRs 001-012 already give you validated architecture decisions; most near-term features will not need DIVERGE-level solution comparison. Start with `/nw-discuss` to produce Given-When-Then stories, then let DESIGN decide whether an ADR amendment is needed. If the feature clearly refactors an existing module, route `refactoring → DESIGN → DISTILL → DELIVER` per the wave-routing matrix. Preserve the invariant: every change lands through DISTILL → DELIVER.

**Step 3 — Before the first refactor in a high-churn file, write characterization tests and use `--mikado_planning=true` if the change crosses multiple modules.**
Concretely: pick the #1 hotspot. Pair it with the existing test file (per CLAUDE.md's tdd-first rule). Inventory the tests: label each as (a) valid acceptance, (b) theater (assertion-free / tautological / implementation-mirror), (c) characterization-worthy gap. For (b), delete or rewrite as RPP L1-L3 test refactoring — this does not violate the Iron Rule because those tests were not failing; they were not testing. For (c), add characterization tests that pin current observable behavior. Only then run `/nw-refactor <path> --level=2 --scope=module` (RPP L1-L2 gets 80% of the value). For cross-module work, opt in Mikado: `/nw-refactor ... --mikado_planning=true` creates `docs/mikado/<goal>.mikado.md` and explores before executing.

## Source Analysis

| Source | Domain | Reputation | Type | Access Date | Cross-verified |
|--------|--------|------------|------|-------------|----------------|
| nWave README | github.com/nWave-ai/nWave | High | Official | 2026-04-24 | Y |
| Wave Routing Guide | github.com/nWave-ai/nWave | High | Official | 2026-04-24 | Y |
| nw-legacy-refactoring-ddd SKILL.md | local install | High | Official | 2026-04-24 | Y (Fowler, Feathers) |
| nw-mikado-method SKILL.md | local install | High | Official | 2026-04-24 | Y (Ellnestam/Brolund) |
| nw-progressive-refactoring SKILL.md | local install | High | Official | 2026-04-24 | Y (Fowler) |
| nw-refactor SKILL.md | local install | High | Official | 2026-04-24 | Y |
| nw-hotspot SKILL.md | local install | High | Official | 2026-04-24 | Y (Tornhill) |
| nw-buddy-wave-knowledge SKILL.md | local install | High | Official | 2026-04-24 | Y |
| nw-bugfix SKILL.md | local install | High | Official | 2026-04-24 | Y |
| nw-test-refactoring-catalog SKILL.md | github.com/nWave-ai | High | Official | 2026-04-24 | Y |
| SW Craftsmanship Dojo — Claude Code and nWave | swcraftsmanshipdojo.com | High | Authorial | 2026-04-24 | Y |
| Feathers, Characterization Testing | michaelfeathers.silvrback.com | High | Primary author | 2026-04-24 | Y (Wikipedia) |
| Wikipedia: Characterization test | en.wikipedia.org | Medium-High | Secondary | 2026-04-24 | Y |
| Create With event page | createwith.com | Medium-High | Authorial | 2026-04-24 | Y (BriX team page) |
| BriX Consulting team | brix.consulting | High | Official | 2026-04-24 | Y |

Reputation: High: 12 (80%) | Medium-High: 3 (20%) | Avg: ~0.95

## Knowledge Gaps

### Gap 1: Explicit theater-test triage decision tree under the Iron Rule
**Issue**: nwave catalogs test smells at RPP L1-L3 in `nw-test-refactoring-catalog`, and the crafter's Iron Rule ("cannot modify a test to make it pass") is explicit. But I did not locate a single document giving a step-by-step decision tree: "pre-existing test X is theater — delete, rewrite, or characterize first?"
**Attempted**: Grepped nw-progressive-refactoring, nw-legacy-refactoring-ddd, nw-refactor, nw-bugfix. Fetched nw-test-refactoring-catalog. Read SW Craftsmanship Dojo article.
**Recommendation**: Read the `nw-software-crafter` agent body (likely contains the protocol); confirm with authors during the March 2026 Spaghetti→Ravioli session.

### Gap 2: Origin/canonical attribution of RPP (Refactoring Priority Premise)
**Issue**: The nwave skill attributes RPP to "the Alcor Academy curriculum" but I did not independently verify the canonical source or whether the L1-L6 structure is standard Alcor or an nwave extension.
**Attempted**: Single search run; non-authoritative results.
**Recommendation**: Ask the authors directly or inspect Alcor Academy / Agile Technical Practices Distilled (Di Gioia is co-author) for the canonical table.

### Gap 3: Live transcript of the Spaghetti→Ravioli session
**Issue**: The Create With event page describes the approach but does not document the specific nwave commands, order, or decisions the authors will make.
**Attempted**: WebFetch of event page.
**Recommendation**: After the session airs, retrieve the recording or write-up; pair with this research to validate Recommendations section.

### Gap 4: Bounded-context discovery workflow for existing codebases
**Issue**: `nw-ddd-architect` (Hera) does greenfield Event Modeling; the Legacy-DDD skill says "identify bounded contexts via language divergence" but the operational workflow (how to run EventStorming on an existing codebase, how Hera reverse-engineers contexts) is not fully spelled out in the files I read.
**Attempted**: Read of nw-legacy-refactoring-ddd.
**Recommendation**: Read `nw-ddd-architect` agent body and any `nw-event-storming` / `nw-event-modeling` skill files.

## Uncertainties

1. Whether `/nw-spike` has a documented "promote to characterization-test suite" equivalent to "promote to walking skeleton" for brownfield. Skill body references both concepts but I did not confirm a single command covers it.
2. Whether the "Iron Rule" is phrased exactly that way in nwave primary docs or is paraphrased in the task prompt. The behavior (never weaken a failing test) is universal to nwave's TDD cycle but the precise phrase is not cited here.
3. Whether `nw-software-crafter` enforces RPP cascade at runtime or only via documentation. The `/nw-refactor` command surfaces the levels as parameters, implying enforcement is parameter-driven, not auto-detected.

## Full Citations

[1] nWave-ai. "nWave: AI agents that guide you from idea to working code, with you in control at every step." GitHub. https://github.com/nWave-ai/nWave. Accessed 2026-04-24.
[2] nWave-ai. "Wave Routing and Entry Points Guide." GitHub. https://github.com/nWave-ai/nWave/tree/main/docs/guides/wave-routing-and-entry-points/. Accessed 2026-04-24.
[3] nWave-ai. "nw-legacy-refactoring-ddd SKILL." Local install `~/.claude/skills/nw-legacy-refactoring-ddd/SKILL.md`. Accessed 2026-04-24.
[4] nWave-ai. "nw-mikado-method SKILL." Local install `~/.claude/skills/nw-mikado-method/SKILL.md`. Accessed 2026-04-24.
[5] nWave-ai. "nw-progressive-refactoring SKILL." Local install `~/.claude/skills/nw-progressive-refactoring/SKILL.md`. Accessed 2026-04-24.
[6] nWave-ai. "nw-refactor SKILL." Local install `~/.claude/skills/nw-refactor/SKILL.md`. Accessed 2026-04-24.
[7] nWave-ai. "nw-hotspot SKILL." Local install `~/.claude/skills/nw-hotspot/SKILL.md`. Accessed 2026-04-24.
[8] nWave-ai. "nw-buddy-wave-knowledge SKILL." Local install `~/.claude/skills/nw-buddy-wave-knowledge/SKILL.md`. Accessed 2026-04-24.
[9] nWave-ai. "nw-bugfix SKILL." Local install `~/.claude/skills/nw-bugfix/SKILL.md`. Accessed 2026-04-24.
[10] nWave-ai. "nw-test-refactoring-catalog SKILL." GitHub. https://github.com/nWave-ai/nWave/blob/main/nWave/skills/nw-test-refactoring-catalog/SKILL.md. Accessed 2026-04-24.
[11] SW Craftsmanship Dojo. "Claude Code and nWave: Agentic AI That Crafts." https://swcraftsmanshipdojo.com/blog/claude-code-nwave/. Accessed 2026-04-24.
[12] Feathers, Michael. "Characterization Testing." Silvrback. https://michaelfeathers.silvrback.com/characterization-testing. Accessed 2026-04-24. [Published concept remains current; Feathers, M., "Working Effectively with Legacy Code", Prentice Hall, 2004].
[13] Wikipedia contributors. "Characterization test." Wikipedia. https://en.wikipedia.org/wiki/Characterization_test. Accessed 2026-04-24.
[14] Di Gioia, Alessandro and Brissoni, Michele. "From Spaghetti to Ravioli: AI-Guided Refactoring with nWave." Create With (Montreal). March 2026. https://www.createwith.com/event/montreal-from-spaghetti-to-ravioli-ai-guided-refactoring-with-nwave-mar-2026. Accessed 2026-04-24.
[15] BriX Consulting. "Team." https://brix.consulting/team/. Accessed 2026-04-24.

## Research Metadata

Duration: ~50 turns | Examined: 15 sources | Cited: 15 | Cross-refs: 9 of 9 major findings | Confidence: High 7 (78%), Medium-High 2 (22%), Low 0 | Output: /workspaces/dashboard-chat/docs/research/nwave-brownfield-approach.md
