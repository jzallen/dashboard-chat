# Recommendation — `dbt-test-validation`

**Feature**: dbt-test-validation
**Wave**: DIVERGE → Handoff to DESIGN
**Date**: 2026-05-08
**Author**: Flux (nw-diverger)

---

## 1. Validated Job (carried forward — see `diverge/job-analysis.md`)

> **When** a chat-driven user workflow modifies the staging layer of a dataset,
> **I want to** validate that the resulting staged data matches the intended outcome contract using assertions that remain valid after the project is ejected to dbt,
> **so I can** ship workflow changes (chat protocol, transforms, dispatcher logic) without inventing a parallel validation path inside and outside the application.

Validated at **strategic/physical** abstraction level. Highest-opportunity outcome: **O4 — reuse validation logic across the in-app ↔ ejected-dbt boundary** (score 16). Bootstrapped to SSOT as **JOB-001** in `docs/product/jobs.yaml`.

---

## 2. Top 3 Options (ranked by weighted matrix)

> Full scoring matrix and weight justification: `diverge/taste-evaluation.md` §2–§4.

### Rank 1 — **Option C: Eject-then-test** — Score 4.04

**Core idea**: After driving the chat workflow, the harness calls the existing `dbt-project-export` endpoint, unzips the dbt project into a tmpdir, sets up a DuckDB profile against the same Parquet sources, and runs `dbt build && dbt test`. The customer's first run IS our last run.

**Why it scores well**: T5 (Durability across ejection) at 5/5 is the only 5/5 in that column. The validation logic IS the customer's. T1 (Subtraction) at 5/5 — the mechanism is irreducible.

**Core trade-off**: Wall-clock cost (T4=2/5). `dbt build && dbt test` adds 10–30s per scenario.

**Key risk**: load-bearing dependency on `dbt-project-export` correctness. The export feature has Gherkin specs (`features/dbt-project-export.feature`) but no green test gate today. C inverts the testing dependency — the export pipeline becomes the test mechanism for everything else, but does not have its own test mechanism.

**Hire criteria**: A user/team chooses C when "we'd rather find export bugs as test failures than as customer reports."

---

### Rank 2 — **Option B: Pandera + dbt-test export translator** — Score 3.83

**Core idea**: Pandera schemas at the staging boundary validate in-app per `chat_turn`. A translator emits equivalent dbt generic tests on `dbt-project-export`. Two test surfaces; one source of truth.

**Why it scores well**: balanced across all criteria — every score 4. No exceptional weakness. T2/T3 well-anchored to the existing pandas-using harness.

**Core trade-off**: Translator fidelity is a maintenance surface. Pandera-to-dbt mappings are not 1:1 for every check.

**Key risk**: Schema-to-test translation drift. If Pandera and dbt-export diverge on a corner case (regex semantics, custom checks), in-app green ≠ customer green.

**Hire criteria**: A user/team chooses B when "we don't yet trust `dbt-project-export` enough to load-bear our test suite on it" or when "AC1.6 wall-clock budget is tight."

---

### Rank 3 — **Option E: Fire-and-forget chat + Parquet golden-file diff** — Score 3.67

**Core idea**: Drive prompts asynchronously; on completion, capture staging DataFrame as Parquet; diff against committed golden Parquet. One assertion per flow.

**Why it scores well**: Maximally simple. T1, T3, T4 all 5/5. The user's "fire-and-forget" instinct in the raw request maps directly to E's mechanism.

**Core trade-off**: T5 (Durability) at 2/5. Snapshots don't ship to the customer's ejected dbt project — *unless* paired with a separate fixture-emission step (which is then closer to Option B's translator).

**Key risk**: re-blessing fatigue. Every intentional change re-blesses every affected snapshot. Customer eject begins from scratch.

**Hire criteria**: A user/team chooses E when "in-app speed of feedback is the dominant signal and the customer's dbt project is treated as their problem to test."

---

## 3. Recommendation

> **Proceed with Option C — Eject-then-test — assuming the team accepts a load-bearing dependency on `dbt-project-export` correctness and is prepared to address AC1.6 wall-clock pressure during DESIGN.**

Rationale grounded in the scoring matrix:
1. C is the only option that captures JOB-001 at its strategic level. T5=5/5 is decisive — the validation logic IS the customer's first run, by construction.
2. The "fire-and-forget" element of the user's raw request is preserved by C: the chat workflow is opaque to the assertion. E delivers fire-and-forget more literally but at the cost of the strategic-level job.
3. C composes naturally with B (B's Pandera layer can run per-turn for fast feedback while C runs per-flow as the durable gate). DESIGN can layer them.

### Open questions for DESIGN

These do not block DIVERGE handoff but must be resolved during DESIGN:

| OQ | Question | Default if unresolved |
|---|---|---|
| OQ1 | How does the harness invoke `dbt build && dbt test` against the same DuckDB instance Ibis materializes to? Or does it run dbt against a fresh DuckDB seeded with the same Parquet sources? | DESIGN ratifies — recommend fresh DuckDB seeded with same Parquet (cleaner isolation; production-fidelity equivalent to what the customer would do). |
| OQ2 | Does C run for every chat-driven scenario or only the demo/regression flows? | Default: only the regression flows; per-turn validation handled by Pandera (composition with B). |
| OQ3 | Sequencing: do we gate `dbt-project-export` with its own tests *first*, then build C on top? Or accept inversion? | DESIGN must answer. Recommendation: gate export first — it's a 1-week effort and removes the inversion risk. |
| OQ4 | What is the wall-clock budget for the eject-then-test loop? Does AC1.6 (5min) need revision? | Profile during DESIGN; if > 60s per scenario, revisit AC1.6 or adopt a sampled-eject strategy (eject once per N scenarios). |
| OQ5 | Does the in-app harness retain *any* per-turn assertions, or do all assertions move to the post-chat dbt-test phase? | Recommend: keep the AC1.4 raw-tool-call leak guard at the protocol level (it's not data-shaped); move all data assertions to dbt tests. |

---

## 4. Dissenting Case — Option B

**Score 3.83. Within 0.21 of recommended. Should be reconsidered if any of these hold during DESIGN:**

1. **`dbt-project-export` is found to have material correctness gaps not addressed in OQ3.** B does not load-bear on the export pipeline.
2. **Wall-clock profiling in OQ4 shows `dbt build && dbt test` consistently exceeds 30s per scenario.** B runs Pandera in <100ms.
3. **The team's pandas/Pandera familiarity dominates dbt-CLI familiarity.** B leverages existing harness skill.

If any of these surface, **flip the primary recommendation from C to B**, with C demoted to "future enhancement once export feature is gated."

---

## 5. Decision Statement (for the next wave)

> **Proceed with Option C (Eject-then-test) as the primary validation strategy for `dbt-test-validation`, with Option B (Pandera at the staging boundary) preserved as a layered fast-feedback option to be ratified during DESIGN. Assume a load-bearing dependency on `dbt-project-export`; resolve OQ3 (sequencing of export-feature gating vs. eject-then-test bootstrap) at DESIGN open.**

This is not "both options are viable" — C is recommended. B is the dissenting alternative *and* a layerable companion. DESIGN ratifies the architecture, including whether to layer them.

---

## 6. Next Wave

**Handoff to**: `/nw-design` — **NOT** `/nw-discuss`.

**Rationale** (per the brief): the user explicitly wants the chosen direction ratified as an ADR, which is a DESIGN-wave artifact. Story-decomposition (DISCUSS) is premature — there are architectural decisions (OQ1–OQ5) that must be ratified first.

**DESIGN deliverables expected**:
1. ADR ratifying eject-then-test as the validation strategy (or B if dissent triggers).
2. C4 / sequence diagram showing the harness ↔ export ↔ dbt-CLI ↔ DuckDB flow.
3. Resolution of OQ1–OQ5.
4. ADR for `dbt-project-export` test-gating sequencing (if OQ3 chooses gate-first).
5. Updated AC1.6 if wall-clock budget revisited (OQ4).

**Deliverables to hand off** (located at `docs/feature/dbt-test-validation/`):
- `recommendation.md` (this file)
- `wave-decisions.md` — DIVERGE summary
- `diverge/job-analysis.md`
- `diverge/competitive-research.md`
- `diverge/options-raw.md`
- `diverge/taste-evaluation.md`
- `diverge/review.yaml` (peer review result)
- `docs/product/jobs.yaml` — SSOT bootstrapped with JOB-001
