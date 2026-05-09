# Wave Decisions — `dbt-test-validation`

**Feature**: dbt-test-validation
**Slug note**: the slug anchors on a *candidate solution*. The actual job is broader: validate chat-driven workflows across the eject-to-dbt boundary. The slug stays as a directory name; do not infer a binding choice from it.

---

## DIVERGE Decisions — 2026-05-08

### Key Decisions

- **[D1] Treat the user's "fire-and-forget + dbt SQL tests" framing as one candidate option, not the foregone direction.** The DIVERGE process surfaced 6 structurally diverse options; the user's framing maps closest to Option E (fire-and-forget + Parquet golden-file diff), which scored #3 of 6 in the final matrix. (See: `diverge/options-raw.md`, `diverge/taste-evaluation.md`)

- **[D2] Job validated at strategic/physical level: durability across the eject-to-dbt boundary.** The 5-Whys terminated at "*the validation contract must survive ejection because customers will run their own dbt tests.*" Six ODI outcome statements; three under-served (O3, O4, O5). (See: `diverge/job-analysis.md` §2, §6)

- **[D3] SSOT bootstrapped — `docs/product/jobs.yaml` created with `JOB-001`.** Prior to this feature, no `docs/product/` directory existed. The migration guide referenced by the skill (`docs/guides/migrating-to-ssot-model/README.md`) is a dangling reference. Per skill direction for greenfield case, JOB-001 was authored directly. Future features extend `jobs.yaml` rather than re-bootstrapping. (See: `docs/product/jobs.yaml`)

- **[D4] Custom taste criterion T5 (Durability across ejection) added to the standard 4-criterion rubric, locked at 30%.** The standard rubric does not cover "will the validation logic survive a deliberate, specified, product feature?" T5 weight (30%) was locked before scoring to track O4's opportunity score (16, the highest-importance under-served outcome in the JTBD analysis). See `diverge/taste-evaluation.md` §2 for the full weights table.

- **[D5] Recommended primary strategy: Option C (Eject-then-test).** The harness drives the chat workflow → calls `POST /api/projects/{id}/export-dbt` → unzips → runs `dbt build && dbt test` against a DuckDB target seeded with the same Parquet sources. Trade-off: T4 (Speed-as-Trust) at 2/5 — wall-clock impact must be addressed at DESIGN. Risk: load-bearing dependency on `dbt-project-export` correctness. (See: `recommendation.md` §3)

- **[D6] Dissenting alternative: Option B (Pandera + dbt-test export translator), score 3.83.** Not picked, but explicitly flagged as a layerable companion to C. DESIGN ratifies whether C-only or C+B layered. (See: `recommendation.md` §4)

- **[D7] Next wave is `/nw-design`, not `/nw-discuss`.** Per user direction in the brief: the chosen direction needs ADR ratification, which is a DESIGN-wave artifact. Story-decomposition is premature with OQ1–OQ5 unresolved. (See: `recommendation.md` §6)

### Job Summary

- **Validated job**: When a chat-driven user workflow modifies the staging layer of a dataset, validate that the resulting staged data matches the intended outcome contract using assertions that remain valid after the project is ejected to dbt.
- **Abstraction layer**: strategic / physical
- **ODI outcomes**: 6 (3 under-served)
- **Highest opportunity outcome**: **O4 — reuse validation logic across the in-app ↔ ejected-dbt boundary** (importance 9, satisfaction 2, score 16)

### Options Evaluated

- **6 options generated** through SCAMPER + Crazy 8s, each passing 3-point diversity test (mechanism, assumption, cost).
- **6 options survived DVF filter** (no eliminations; all DVF totals ≥ 7).
- **6 options scored under pre-locked weights** (T5=30%, anchored to O4's opportunity score of 16 from the JTBD analysis).
- **Recommended: Option C — Eject-then-test** (score 4.04). Rationale: T5=5/5 is the only 5/5 in the durability column; the validation logic IS the customer's first dbt run.
- **Dissent: Option B — Pandera + dbt-test export translator** (score 3.83). Why it might be preferred under different assumptions: detailed in `recommendation.md` §4.
- **Notable rejected option: Option F — Worker-emitted `validation_plan` event + dbt unit tests** (score 2.61). Highest-concept-count option; introduces a new ChatEvent type, a worker-side plan generator, a fixture emitter, and a runner. Documented as "what too tight a coupling looks like."
- **The user's literal "fire-and-forget" hypothesis (Option E)** scored #3 (3.67). It wins on simplicity (T1=5, T3=5, T4=5) but loses decisively on T5 (2/5 — Parquet snapshots don't ship to the customer's ejected dbt project), which is the load-bearing criterion for JOB-001.

### SSOT Updates

- `docs/product/jobs.yaml`: **created** — schema_version 1; JOB-001 bootstrapped with the validated job + 6 ODI outcomes + references to `diverge/job-analysis.md`, `2026-05-01-api-driven-user-flow-tests.md`, `2026-05-07-refactor-dataset-layer-harness.md`, `features/dbt-project-export.feature`, `features/dbt-model-layers.feature`. Changelog entry recorded for 2026-05-08 with feature-id `dbt-test-validation`.

### Open Questions for DESIGN

| OQ | Topic | Default if unresolved |
|---|---|---|
| OQ1 | dbt-against-DuckDB topology | Fresh DuckDB seeded with same Parquet sources |
| OQ2 | C scope (every scenario or regression-only) | Regression-only; per-turn handled by Pandera if B is layered |
| OQ3 | Test-gating sequencing for `dbt-project-export` | Recommend gate-first (1 week effort, removes inversion risk) |
| OQ4 | AC1.6 wall-clock revision | Profile during DESIGN; revisit if > 60s per scenario |
| OQ5 | In-app per-turn assertions retained? | AC1.4 raw-tool-call guard stays; data assertions move to dbt tests |

### Constraints Carried Forward

- **ADR-016**: 5-service compose stack (auth-proxy + backend + worker + query-engine + MinIO). Cannot drop services to simplify.
- **ADR-007**: Ibis is the SQL generator. Any dbt-against-DuckDB strategy must reconcile with Ibis materialization.
- **ADR-014**: `ChatEventSchema` is the wire SSOT. Option F would have required amending it — declined.
- **ADR-015**: Headless presentation-state log exists. Available to any option that wants directive replay (none of top 3 use it directly).
- **AC1.6 (api-driven-user-flow-tests)**: 5-min wall-clock budget. Option C will press this; OQ4 owns the resolution.
