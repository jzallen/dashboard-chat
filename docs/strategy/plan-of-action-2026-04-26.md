# Plan of Action: Paths A + B Combined

**Date:** 2026-04-26
**Author:** dave (dashboard_chat crew) · bead dc-9g9
**Source strategy:** [next-steps-2026-04-26.md](next-steps-2026-04-26.md) by polecat/obsidian (dc-uq3)
**Selected paths:** A (full-loop e2e acceptance test) + B (harden report layer)
**Status:** Ready to execute — file backlog beads, then begin

---

## TL;DR

Run Path E's 30-minute demo **first** (per Obsidian's recommendation — captured friction is the test inventory for Path A). Then execute B and A **in interleaved order**: B's missing report-layer unit/characterization tests come first because they're the cheapest, fastest signal on the freshest code; A's full-loop Playwright spec follows and reuses B's fixtures. Total estimate: **5–7 working days** including demo, bugfixes, and review.

**Deviation from Obsidian:** Obsidian recommended A alone (with E as prelude). The user chose A + B. I'm not reordering them — I'm sandwiching B between the demo and A so report-layer test work can absorb the demo's findings without blocking the e2e author.

---

## 1. nWave Toolkit

### Commands

| Command | Used when | Justification |
|---|---|---|
| `/nw-buddy` | Orientation if I get lost on wave routing | First-line concierge per CLAUDE.md brownfield matrix |
| `/nw-distill` | Author the full-loop BDD scenario (A) and missing report scenarios (B) | Brownfield matrix: "have stories, need tests → /nw-distill" |
| `/nw-roadmap` | Break the e2e + bugfixes into ordered TDD steps | Required input for `/nw-execute` |
| `/nw-execute` | Drive a single roadmap step to GREEN | One step per dispatch keeps Outside-In TDD honest |
| `/nw-deliver` | If the roadmap is short and stable, run it end-to-end | Saves dispatch overhead once spec is locked |
| `/nw-bugfix` | Each demo-surfaced bug with known cause | Brownfield matrix: cause known → DISTILL regression test, then fix |
| `/nw-root-why` | Demo-surfaced bug with unknown cause | 5-Whys before writing the regression test |
| `/nw-mutation-test` | After Path B unit tests land | Validates the report-layer suite catches real mutations (≥80% kill) |
| `/nw-refactor` | If B's test-writing surfaces structural smells in `report/` use cases | RPP L1–L3 only — keep scope to what tests reveal |
| `/nw-review` | Critique the e2e spec before it goes red | Catches BDD anti-patterns before the loop hardens |
| `/nw-finalize` | After A is green and B's gates pass | Migrates `docs/feature/dc-9g9/` artifacts to `docs/evolution/` |

### Agents

| Agent | Role on this work |
|---|---|
| `nw-acceptance-designer` | Author the Playwright spec for the full loop (A) and report scenarios (B) |
| `nw-acceptance-designer-reviewer` | Hard gate on BDD quality before any code moves |
| `nw-software-crafter` | Outside-In TDD on bugfixes; pair with `tdd` skill to map source → target |
| `nw-software-crafter-reviewer` | Review fixes for Iron Rule violations and decorator-order regressions |
| `nw-troubleshooter` | RCA for any demo-surfaced bug whose cause isn't obvious |
| `nw-bugfix` (workflow) | Bug → regression test → fix loop |
| `nw-product-owner` | Only if the demo surfaces a UX gap that needs a real story (escalate, don't write blind) |

### Skills

| Skill | Used for |
|---|---|
| `tdd` | Map each touched source file to the right Bazel/pytest/vitest target — avoids running `npm run test:all` for one fix |
| `backend-use-case` | Decorator stack discipline when patching report use cases (the dataset regression was a decorator-order bug) |
| `frontend-query-hook` | If a fix needs a TanStack Query hook tweak in `ReportDetailView` |
| `alembic-migration` | Only if a fix needs a schema change — unlikely for this scope but cheap to remember |
| `monorepo-tooling` | Turbo/uv/workspace navigation for cross-service fixes |
| `docker-and-ports` | If the e2e harness can't reach a service during local runs |
| `project-structure` | Locate where new test fixtures and helpers belong |
| `nw-buddy-wave-knowledge` | Confirm DISTILL inputs/outputs before dispatching the agent |
| `nw-distill` (skill) | Acceptance-test methodology: port-to-port, prior-wave reading, graceful degradation |

---

## 2. Sequenced Action Plan

Ten steps, sized in half-day units. Steps marked **[parallelizable]** can overlap if a second agent picks them up.

| # | Step | Path | Size | Output |
|---|---|---|---|---|
| 1 | **Path E demo** — 30-min recorded session walking the full loop. Capture every friction point as a draft bead. | E (prelude) | 0.5d | Friction inventory, raw bead drafts |
| 2 | **Triage demo findings** — split into (a) bugs with known cause → `/nw-bugfix` queue, (b) UX gaps → defer, (c) test-coverage gaps → fold into A or B. | E | 0.25d | Bead backlog refined |
| 3 | **Update vision.md** — kill the stale "agent tools in progress — backend ready" line for reports (per strategy §3). | housekeeping | 0.25d | Updated `docs/vision.md` |
| 4 | **Path B: report-layer scenario inventory** via `/nw-distill` — enumerate edge cases (zero-dim, zero-measure, dimension/measure name collision, joins crossing grain). | B | 0.5d | `docs/feature/dc-9g9/distill/report-edge-cases.md` |
| 5 | **Path B: write missing report unit + characterization tests** via `/nw-execute` per step. | B | 1.0d | New tests under `backend/app/use_cases/report/` |
| 6 | **Path B: mutation test report suite** via `/nw-mutation-test`. Iterate on tests until kill rate ≥ 80%. | B | 0.5d | Mutation report; suite hardened |
| 7 | **Path B: structured logging at agent-tool boundary** — wrap `reportToolDefinitions.ts` handlers with the same logging shape that landed for datasets in `61b7333`. | B | 0.5d | Log lines on every report-tool call |
| 8 | **Path A: author `e2e/full-prototyping-loop/build-and-export.spec.ts`** via `nw-acceptance-designer`. Mirror `e2e/dataset-upload/upload-flow.spec.ts` conventions; use `seededProjectId` fixture. | A | 1.0d | Failing (RED) e2e spec |
| 9 | **Path A: drive e2e to GREEN** — fix bugs with `/nw-bugfix`, add `dbt parse` assertion on extracted ZIP. **[parallelizable]** with step 7. | A | 1.5d | Green full-loop test in CI |
| 10 | **`/nw-finalize`** — archive `docs/feature/dc-9g9/`, update CHANGELOG, close bead. | wrap | 0.25d | Migrated artifacts |

**Total:** 6.25 days nominal; budget **5–7 days** with buffer.

**Why B before A:**
- Report layer is the freshest code (4 days old at strategy date) → highest decay risk if untouched.
- B's fixtures (sample report definitions) feed directly into A's spec.
- A will likely surface report bugs anyway; having unit-level guardrails first means each surfaced bug gets a focused unit regression *plus* the loop-level proof, not just the latter.
- Mutation testing in step 6 validates the unit suite *before* we trust it as a foundation for A.

---

## 3. Initial Bead Backlog

File these as children of dc-9g9 (or as siblings if mayor prefers flat):

1. **`Path E: 30-min full-loop demo + friction inventory`** — record one operator walking upload→view→report→export, capture every UX/agent failure as draft beads. Output: friction-inventory doc + child bug beads.
2. **`Path B-1: report-layer edge-case unit tests`** — cover zero-dim, zero-measure, name collision, grain-violating joins; gate with mutation testing (kill ≥ 80%).
3. **`Path B-2: structured logging on report agent tools`** — port the dataset-tool logging shape (`61b7333`) to `reportToolDefinitions.ts` so silent failures stop being silent.
4. **`Path A-1: author full-loop Playwright spec (RED)`** — write `e2e/full-prototyping-loop/build-and-export.spec.ts` end-to-end including `dbt parse` of extracted ZIP; expect RED on first run.
5. **`Path A-2: drive full-loop spec to GREEN`** — fix whatever the spec surfaces; one `/nw-bugfix` cycle per failure with regression test first.

Stretch (file only if the demo justifies them):

6. **`Update vision.md to reflect v1.7.0`** — remove the stale "agent tools in progress" line for reports (cited in strategy §3).

---

## 4. Demo Plan (Path E First)

**Yes — run the 30-min demo first.** Obsidian's reasoning is sound and I'm not deviating: a 30-minute recorded session is the cheapest input to a high-quality e2e scenario, and skipping it means the spec author guesses what the user actually does.

| Question | Answer |
|---|---|
| **Who runs it** | One human operator (proposing: the user / human collaborator on this rig). Dave (me) does **not** run it — I'm not a representative user. |
| **When** | Before step 4 of the action plan. Within 1 working day of this plan being approved. |
| **Setup** | `npm run dev` locally; small CSV (Synthea patients per strategy §6, or any 10–50 row CSV); fresh project. |
| **Script** | (1) Trim/standardize a column via chat. (2) Build a view filtered by year + grouped by category. (3) Build a report with one dimension + one count measure. (4) Export dbt project, extract ZIP, run `dbt parse`. |
| **What's captured** | Screen recording + per-step annotations. Every wrong tool call, every confusing error, every "I don't know what to type". Each becomes a draft bead via `bd create --type=bug` or `--type=task`. |
| **Output artifact** | `docs/strategy/demo-2026-04-XX-friction-inventory.md` listing each finding with severity (blocks-loop / annoys-user / nice-to-have). |
| **Decision gate** | After demo: triage. If a finding *blocks the loop entirely*, fix it before authoring the e2e (otherwise step 8 is impossible). If it merely annoys, file as a follow-on bead and keep moving. |

**Risk if skipped:** The e2e spec is written to a hypothetical user flow rather than a real one. Tests pass; demo to a real customer reveals the same friction the e2e never covered.

---

## 5. Open Questions

1. **Who runs the Path E demo?** I cannot run it myself (not a user). Need a human operator and a rough time slot. **Blocks step 1.**
2. **Where do friction findings live?** Sibling beads under dc-9g9, or a new epic? Strategy doc doesn't specify the bead hierarchy convention for crew-dispatched work.
3. **Mutation-test scope for step 6** — strategy §B implies "every report tool". Does the team accept the wall-clock cost (mutation testing is slow), or do we restrict to the highest-churn report files only?
4. **`dbt parse` runtime** — adding a real `dbt parse` to the e2e introduces a Python+dbt dependency in the e2e harness. Is that acceptable, or should we settle for ZIP-structure assertions and run `dbt parse` only in a separate nightly job? Strategy §A treats it as "bonus".
5. **Stage 3 PREVIEW deferral** — strategy §4 Path D recommends deferring Stage 3 until A is done. Confirm the user/mayor agrees before any Stage 3 work gets dispatched in parallel and undermines this plan's safety-net premise.
6. **CHANGELOG entry policy** — does dc-9g9 itself warrant a CHANGELOG line on `/nw-finalize`, or do we only changelog feature shipments and skip planning beads?

---

## Appendix — References

- Strategy doc: [next-steps-2026-04-26.md](next-steps-2026-04-26.md)
- Brownfield routing: `docs/research/nwave-brownfield-approach.md`
- Hotspot analysis: `docs/evolution/hotspot-2026-04-24.md`
- E2E harness conventions: `e2e/dataset-upload/upload-flow.spec.ts`, `e2e/global-setup.ts`, `e2e/run-e2e.sh`
- Dataset regression postmortem evidence: commits `61b7333` (S3/httpfs fix), `58ca275` (decorator order)
- Report layer ship: v1.7.0, commits `e494fd8` `312c8aa` `059fba3`
