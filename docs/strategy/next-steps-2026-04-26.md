# Strategy: Roadmap to All-Layers Buildable + Project Export in Chat UI

**Date:** 2026-04-26
**Author:** polecat/obsidian (dc-uq3)
**Status:** Recommendation — no implementation
**Goal under review:** Get dashboard_chat to a state where a user can build every dbt layer (dataset/staging, view/intermediate, report/mart) through chat and export the resulting dbt project.

---

## TL;DR

**The headline finding is good news.** All three model layers and the dbt export already work as of v1.7.0 (2026-04-22). The dataset-layer regression hinted at in the bead description was real but was fixed weeks ago (v1.3.1 on 2026-03-30). The report-layer chat tools — the last missing piece — shipped four days ago.

**What's actually missing is *proof*.** There is no executable test that walks the full prototyping loop (upload → transform → view → report → export) end-to-end. Confidence in "the goal is achieved" rests on unit tests of each layer in isolation plus the recency of the report-layer work. That gap is the right thing to close next.

**Recommended entry point:** `/nw-distill` to write the executable acceptance test for the full loop, then `/nw-bugfix` for whatever it surfaces. Wave is DISTILL because the architecture is settled and the requirement is clear; what's needed is the BDD scenario that proves the path works today.

**First concrete step:** Author `e2e/full-prototyping-loop/build-and-export.spec.ts` (Playwright), modeled on `e2e/dataset-upload/upload-flow.spec.ts`. Get it red, then green.

---

## 1. Current State Per Layer

| Layer | Status | Last meaningful change | Coverage |
|---|---|---|---|
| **Dataset** (sources / staging) | **Working** | 2026-04-25 (`3dae031` characterization tests) | 16 unit tests, dedicated e2e (`dataset-upload`, `data-cleaning`, `table-operations`) |
| **View** (intermediate) | **Working** | 2026-03 (`6301e65` view-layer chat-first UI) | 13 unit tests, no e2e |
| **Report** (marts) | **Working — new** | 2026-04-22 (v1.7.0, `e494fd8` + `312c8aa` + `059fba3`) | 9 unit + 1 chat-integration test, no e2e |
| **dbt project export** | **Working** | 4 months stable since `64e65c1` "add dbt model layers (Views + Reports) with 4-layer export" | Unit test on backend use case + frontend blob/filename test, no e2e |

### Layer-by-layer evidence

**Dataset layer** (`backend/app/use_cases/dataset/`, `agent/lib/chat/tools.ts`, `frontend/src/ui/DatasetDetailView`):
11 chat tools cover resolve, filter, sort, clean, transform, undo. Recent refactor (`dc-e65d`) extracted `DatasetController` from `http_controller.py`. Characterization tests added 2026-04-25.

**View layer** (`backend/app/use_cases/view/`, `agent/lib/chat/viewToolDefinitions.ts`, `frontend/src/ui/ViewDetailView`):
15 chat tools — `createView`, `addColumn`, `addJoin`, `setGrain`, `setMaterialization`, etc. Deterministic SQL generation in `sql_generator.py`. Migrations 005 and 007 establish structured columns and grain.

**Report layer** (`backend/app/use_cases/report/`, `agent/lib/chat/reportToolDefinitions.ts`, `frontend/src/ui/ReportDetailView`):
11 chat tools including the semantic primitives `addDimension`, `addMeasure`, plus `suggestStructure` for column-role inference. Frontend route `/report/:reportId` wired four days ago. The `vision.md` line "agent tools in progress — backend ready" is now **stale** — the tools shipped.

**dbt export** (`backend/app/use_cases/project/_dbt/`, route `GET /api/projects/{project_id}/export/dbt`, frontend `core/dataCatalog/client.ts:140-170`):
Loads all datasets+views+reports from metadata, renders sources.yml + schema.yml + per-layer SQL + profiles.yml, returns ZIP. Frontend triggers blob download with Content-Disposition filename parsing. Logic untouched for ~4 months.

---

## 2. The Dataset Regression — Postmortem in Brief

The bead description ("the dataset layer worked well at one point") matches a real Mar 20–30 regression, **already fixed**. Two compounding bugs:

1. **S3/httpfs lockdown** — `backend/app/utils/duckdb_factory.py:68` had `SET enable_external_access = false`, which silently blocked the parquet reads needed during schema inference in `create_dataset_from_upload._pipeline`. Failures were swallowed with no log line. **Fixed** in `61b7333` (v1.3.1, 2026-03-30) — also added explicit error logging in `Dataset._build_table`.
2. **Decorator order bug** — Use cases had `@with_repositories` outer, `@handle_returns` inner. DB rollback failures crashed instead of returning `Failure(e)`. **Fixed** in `58ca275` (v1.4.2, 2026-04-02) by swapping the order across all dataset and upload use cases.

**Why it went undetected:** No test covered the upload→preview path under realistic S3 conditions, and the `enable_external_access` flag was never exercised by unit tests (which use in-memory DuckDB without httpfs). Characterization tests for upload arrived only 2026-04-25 — three weeks after the fix. The brownfield methodology in `docs/research/nwave-brownfield-approach.md` calls for characterization tests *before* refactoring untested legacy code; that discipline would have caught this.

**Implication for the strategy:** The regression was caused by a missing *integration-level* test, not by an architectural flaw. The same gap exists today for view → report → export. We are one undetected refactor away from a similar regression in those layers.

---

## 3. Gap Analysis vs the Goal

The goal is "user can build every dbt layer through chat and export." Decomposing that into shippable proof:

| Capability | Code state | Test state | Gap |
|---|---|---|---|
| Upload + cleanse dataset via chat | Done | Unit + e2e | None |
| Build view via chat | Done | Unit only | No e2e for chat-driven view creation |
| Build report via chat | Done (4 days old) | Unit + 1 chat-integration | No e2e; freshness risk |
| Export dbt project | Done | Unit only | No e2e; no test that exported ZIP actually `dbt run`s cleanly |
| **Full loop** (upload → view → report → export) | Each piece works in isolation | **None** | **The loop has never been mechanically verified** |

**Other observations relevant to "next step" thinking:**

- **Tech debt under the layers** (per `docs/evolution/hotspot-2026-04-24.md`): `metadata/repository.py` is 999 LOC × 22 commits in 90 days, `http_controller.py` is 527 LOC × 21 commits, the `sql_access/` directory is 10+ near-duplicate use cases. The `dc-78r9` refactor stream is actively addressing this. None of it currently *blocks* the goal, but each refactor is a regression risk for layers that are not e2e-tested.
- **Stage 3 PREVIEW** (grid mockup → Vizro generation → hot reload → DuckDB-WASM interactivity) is not started. The vision diagram tags it `PLANNED`. This is the *next* product gap after the dbt-layer goal is locked in, but it's out of scope for this bead.
- **Vision doc is stale** — `docs/vision.md` still says "agent tools in progress — backend ready" for reports. It should be updated to reflect v1.7.0.

---

## 4. Candidate Paths (5 directions)

These are deliberately distinct in *shape*, not just in priority. Each is sized for one focused effort over the next 1–3 weeks.

### Path A — Acceptance-Test the Full Loop ("prove it works")

Write the executable acceptance test for the full prototyping loop as a Playwright e2e: upload a small CSV → ask the agent to clean it → ask the agent to build a view joining two datasets → ask the agent to build a report with a dimension and a measure → trigger dbt export → assert the ZIP contains expected files at all four layers → bonus: run `dbt parse` on the extracted project and assert it succeeds.

- **Wave:** `/nw-distill` (write the BDD scenario, then `/nw-execute` to drive any failures to green).
- **Pros:** Directly satisfies the bead's goal phrasing — "user can build every layer". Catches integration gaps. Small, well-scoped. Future refactors gain a safety net.
- **Cons:** Doesn't produce new product value; only certifies what we believe already works. Will likely surface 1–3 bugs that need separate fix work.
- **Risk if skipped:** Re-run of the dataset-layer regression — quietly broken paths between releases.
- **Taste call:** The cheapest path to a high-confidence demo.

### Path B — Harden the Report Layer ("the new code is the risky code")

Treat v1.7.0's report layer as the highest-risk surface: add unit tests for every report tool's edge cases (zero-dim, zero-measure, dimension shadowing a measure, joins crossing grain), wire structured logging at the agent-tool boundary, write the report-layer characterization tests that would prevent another silent regression.

- **Wave:** `/nw-distill` for missing scenarios; `/nw-refactor` if test-writing surfaces structural issues in `report/` use cases.
- **Pros:** Targets the genuine new-code risk surface. Stays in the area the team just shipped, while context is fresh.
- **Cons:** Narrower than the goal — proves the report layer alone but not the loop. Could be done as a subset of Path A.
- **Risk if skipped:** A user demo that hits a report-tool edge case that no test exercised.

### Path C — Pay Down Refactor Debt First ("clean before more features")

Resume the `dc-78r9` refactor stream and add a follow-on for `metadata/repository.py` (999 LOC) and `http_controller.py` (527 LOC) per the 2026-04-24 hotspot report. The argument: every layer touches the metadata repo, and the repo is the single largest hot file in the codebase. Refactoring it now reduces friction for the Stage 3 PREVIEW work that follows.

- **Wave:** `/nw-refactor` (RPP L3/L4) for the repository; possibly `/nw-mikado` for the `sql_access/` family.
- **Pros:** Sustains velocity. The hotspot doc already proposes this. Leaves the codebase in a much better state for the team's next feature wave.
- **Cons:** Goes wide before going deep on the *current* goal. Without the e2e net from Path A, every refactor is a regression risk on layers that aren't mechanically verified end-to-end. Doesn't directly advance the goal of "user can build all layers."
- **Risk if taken alone:** Same as the dataset regression — refactoring untested legacy code.

### Path D — Skip Forward to Stage 3 PREVIEW ("the layers work, build the next thing")

Treat the layer goal as satisfied. Start design on Stage 3 — grid-mockup chat tool (Groq), Vizro code generator, hot-reload preview tab, DuckDB-WASM interactivity. This is the next vision-stage and arguably the highest *user-perceived* lift.

- **Wave:** `/nw-discuss` for grid-mockup UX → `/nw-design` for Vizro generation architecture → `/nw-spike` for the DuckDB-WASM piece.
- **Pros:** Maximum forward product motion. Stage 3 is the "live preview with hot reload" feature that defines the prototyping experience.
- **Cons:** **Premature.** The bead asks for a *strategy to satisfy a specific goal*, not the next feature after it. Shipping Stage 3 on top of layers that have no e2e safety net is exactly the regression-amplifier pattern the dataset regression illustrated.
- **Recommendation:** Defer until at least Path A is done.

### Path E — Demo-First Validation ("watch it break")

Run a manual demo of the full loop today in a recorded session — a real human pretending to be a customer, talking to the chat. Watch where the agent struggles, where the UX confuses, where errors aren't surfaced. Capture the friction inventory as beads. Then prioritize.

- **Wave:** No wave — this is a discovery exercise that *informs* which wave comes next. After the demo, route to `/nw-bugfix`, `/nw-distill`, or `/nw-discuss` per finding.
- **Pros:** Zero implementation cost. Highest signal-to-noise on what *actually* matters from a user POV. Likely to surface UX issues that no test would catch (slow tool calls, confusing error messages, agent picking wrong tool).
- **Cons:** Subjective. Doesn't produce durable artifacts (test code, fixes) without follow-on work. Single-sample.
- **Synergy:** Pairs well as a *prelude* to Path A — let the demo inform what scenarios the e2e should cover.

---

## 5. Recommendation

**Adopt Path A (acceptance-test the full loop), preceded by a half-day of Path E (demo-first).**

### Why

1. **Directly satisfies the bead's goal phrasing.** The goal says "a user can build every layer ... and export". The right artifact to prove that is an executable test that walks a user through that path. Anything else proves it indirectly.
2. **The dataset-regression evidence is decisive.** The thing that broke last time was a path with no integration test. The same shape of gap exists today for view, report, and export. Closing that gap is the highest-leverage defensive move.
3. **Low cost, high re-use.** The Playwright harness already exists (`e2e/dataset-upload/upload-flow.spec.ts`, `e2e/global-setup.ts`, `e2e/run-e2e.sh`). Extending it to a full-loop scenario is days of work, not weeks.
4. **Unblocks Paths C and D safely.** Once the loop is mechanically verified, the refactor work in Path C and the Stage 3 work in Path D can proceed without fear of silent layer regressions.
5. **Path E first** because we don't know what scenarios the e2e should cover until we've seen a human try the loop. A 30-minute recorded session is the cheapest input to a good acceptance test.

### Wave to enter

**`/nw-distill`** for the BDD scenario authoring, scoped to the full prototyping loop. The architecture is settled (ADRs 1–13), the requirement is unambiguous, and what's missing is the executable specification. Per the brownfield routing matrix in `docs/research/nwave-brownfield-approach.md`: "Have stories, need tests → /nw-distill".

If Path E surfaces a clear bug (not a missing test, an actual broken path), follow on with **`/nw-bugfix`** for that specific issue with a regression test first.

---

## 6. First Concrete Step

**Run a 30-minute internal demo today.** One person plays the user. Open dashboard_chat in dev. Upload a small CSV (Synthea patients works). Ask the agent in chat to:

1. Trim whitespace and standardize case on `gender`.
2. Build a view that filters to patients born after 1980, grouped by `state`.
3. Build a report on that view with `state` as a dimension and `count(patient_id)` as a measure.
4. Export the dbt project. Extract the ZIP. Run `dbt parse`.

**Capture as you go**: every place the agent picked the wrong tool, every error you couldn't understand, every place you didn't know what to type next. File each as a bead with `bd create --type=bug` (or `--type=task` for UX issues).

**Then** open `/nw-distill` for `e2e/full-prototyping-loop/build-and-export.spec.ts`, using the demo's friction inventory as the source of test cases. Get the test red, then drive it to green.

Total expected effort to "goal achieved with proof": **3–5 working days**, including bug fixes from the demo.

---

## Appendix — Source evidence

- **Layer status:** parallel exploration of `backend/app/use_cases/{dataset,view,report,project}/`, `agent/lib/chat/{tools,viewToolDefinitions,reportToolDefinitions}.ts`, `frontend/src/ui/{Dataset,View,Report}DetailView`, `e2e/`.
- **Dataset regression:** `git show 61b7333 58ca275`, CHANGELOG.md v1.3.1 / v1.4.2 entries, commit `3dae031` (characterization tests added 2026-04-25).
- **Report layer freshness:** v1.7.0 release notes, commits `e494fd8` `312c8aa` `059fba3` (all 4 days old).
- **Tech debt:** `docs/evolution/hotspot-2026-04-24.md`.
- **Vision context:** `docs/vision.md` (note: claim "agent tools in progress" for reports is now stale).
- **Brownfield routing:** `docs/research/nwave-brownfield-approach.md`.
