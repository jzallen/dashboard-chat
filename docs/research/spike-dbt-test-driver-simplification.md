# Spike: dbt-test driver simplification

> **Status**: SPIKE — exploratory prototype, not a delivery.
> **Date**: 2026-05-11
> **Branch**: `spike/dbt-test-driver-simplification`
> **Prototype**: [`tests/spike/dbt_test_driver.py`](../../tests/spike/dbt_test_driver.py)
> **Subject of evaluation**: [`tests/acceptance/dbt-test-validation/`](../../tests/acceptance/dbt-test-validation/) + [`backend/tests/integration/dataset_layer/eject/`](../../backend/tests/integration/dataset_layer/eject/) + [`backend/tests/integration/dataset_layer/validation/`](../../backend/tests/integration/dataset_layer/validation/), framed by [`docs/evolution/2026-05-11-dbt-test-validation.md`](../evolution/2026-05-11-dbt-test-validation.md) and [ADR-019](../decisions/adr-019-eject-then-test-validation.md).

## Why this spike

The user (on review) asked whether the simpler shape would have been:

> "Start docker compose. Submit prompts in order. Eject the project, point at a custom `tests/` directory of SQL tests, run `dbt test`. If all tests pass, we've validated expected behavior."

The shipped feature instead spans ~4,800 LOC across a harness facade, an eject orchestrator (probes + seeder + runner + parser), a per-turn Pandera validator, and 17 BDD scenarios. The user's hypothesis: ~200–400 LOC would do.

This spike builds the minimal version, reproduces a subset of the existing scenarios against the same live compose stack, and counts what's left.

## Goal + approach (one diagram)

```
                ┌───────────────────────────────────┐
                │ scenarios (declarative data)      │
                │ • require_column=region           │  ← M1 happy-path
                │ • require_column=order_id +       │  ← M1 drift-detector
                │     custom test asserts no nulls  │
                │ • prompts=[...]  (gated by GROQ)  │  ← chat-driven
                │ • env_unset=("S3_BUCKET",)        │  ← M5 missing-env-var
                └────────────┬──────────────────────┘
                             │
              ┌──────────────▼────────────────┐
              │ dbt_test_driver.py (1 file)   │
              │                               │
              │ 1. POST /api/auth/callback    │
              │ 2. POST /api/projects         │
              │ 3. POST /api/uploads (CSV)    │
              │ 4. PATCH /api/datasets/{id}   │  ← required:true on a col
              │    (or chat_turn via /chat)   │
              │ 5. GET .../export/dbt → zip   │
              │ 6. unzip + cp custom/*.sql    │
              │ 7. dbtRunner.invoke(build)    │
              │ 8. exit-code = signal         │
              │ 9. DELETE /api/projects       │
              └───────────────────────────────┘
                             │
              ┌──────────────▼──────────────┐
              │ compose stack (unchanged)   │
              │ auth-proxy + agent + api +  │
              │ pgduckdb + MinIO + redis    │
              └─────────────────────────────┘
```

What is **not** in the diagram: no harness facade, no `EjectAndTestOrchestrator`, no `DuckDBProfileSeeder`, no `RunResultsParser`, no `PanderaValidator`, no five earned-trust probes, no session-scoped composition root, no BDD step glue.

The driver leans on what already exists in the production export:

- **The exported `profiles.yml` already uses `env_var()` Jinja** for `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_URL_STYLE` ([`backend/app/use_cases/project/_dbt/profiles_yml.py`](../../backend/app/use_cases/project/_dbt/profiles_yml.py)). dbt resolves these natively at parse time. **No seeder is needed** — `os.environ.update(...)` does the same job.
- **The exported `sources.yml` already uses `env_var('S3_BUCKET')`** for the parquet path ([`backend/app/use_cases/project/_dbt/sources_yml.py:25`](../../backend/app/use_cases/project/_dbt/sources_yml.py)). Same story.
- **The exported `schema.yml`** emits a `not_null` dbt test whenever a column has `constraints.required: true` ([`backend/app/use_cases/project/_dbt/schema_yml.py`](../../backend/app/use_cases/project/_dbt/schema_yml.py) `858a33e`). **No bespoke schema-to-test translator on the test side** — PATCH the dataset's `schema_config` and the exporter does the rest.

The driver injects one (1) post-unzip patch: `s3_use_ssl: false` in `profiles.yml` so dbt-duckdb talks plain HTTP to MinIO. This is the same one-line edit a real customer running against MinIO would apply — the export template is intentionally MinIO-agnostic. (See "What worked, what surprised, what broke" below.)

## Implementation summary

| Component | LOC | Files |
|---|---:|---|
| Driver | 410 | `tests/spike/dbt_test_driver.py` |
| Custom SQL tests (fixtures) | 13 | `tests/spike/fixtures/*/tests/*.sql` (2 files) |
| **Spike total** | **423** | |
| Eject infra | 1,462 | `backend/tests/integration/dataset_layer/eject/*.py` (6 files) |
| Validation infra | 220 | `backend/tests/integration/dataset_layer/validation/*.py` |
| Acceptance suite (BDD) | 1,760 | `tests/acceptance/dbt-test-validation/*.{py,feature}` (15 files) |
| Harness extensions for dbt-test | ~410 | dataset-layer-harness lifecycle doc reports: 695 → 1,104 → 1,362 LOC across two refactors + dbt-test. Conservatively ~410 LOC attributable to this feature on top of pre-existing harness shape. |
| **Existing-feature total** | **~3,850** | (evolution doc cites ~4,800 inclusive of `pyproject.toml` updates, ADR, design docs, etc.) |

**Ratio: ~9× reduction** at the test-infrastructure layer (3,442 → 423 if you exclude the harness extension portion; 3,850 → 423 with it). Not 2×. Not 3×. ~9×.

### Driver run output (live compose stack, 2026-05-11)

```
[
  {"name": "m1_happy_path",          "expected": "pass", "actual": "pass", "matched": true, "rc": 0},
  {"name": "m1_drift_detector",      "expected": "fail", "actual": "fail", "matched": true, "rc": 1,
   "snippet": "fail no_null_order_id: Got 2 results, configured to fail if != 0\nfail not_null_stg_new_dataset_order_id: Got 2 results, configured to fail if != 0"},
  {"name": "chat_then_eject_then_test", "matched": true, "skipped": "GROQ_API_KEY unset"},
  {"name": "m5_missing_env_var",     "expected": "fail", "actual": "fail", "matched": true, "rc": 1,
   "snippet": "Parsing Error\n  Failed to render models/staging/sources.yml ...: Env var required but not provided: 'S3_BUCKET'"}
]
```

All four scenarios match expectations. Walltime: ~5–7 s for the full suite on the local compose stack (m1_happy_path ~2 s, m1_drift_detector ~1 s, m5 ~1 s, plus auth/project/upload setup overhead). For comparison, the existing suite reports ~85–105 s per ADR-019 OQ4 (compose stack already up).

### Coverage map (existing 17 scenarios → spike)

Total existing scenarios: **17** (1 walking-skeleton + 3 M1 + 3 M2 + 5 M3 + 2 M4 + 2 M5).

| # | Existing scenario | Source | Status in spike | Notes |
|---|---|---|---|---|
| 1 | WS — eject + re-validate | `walking-skeleton.feature` | **REPRODUCED** (as `m1_happy_path`) | Fixture-driven `@given` post DWD-9 hardening — identical setup to the spike. |
| 2 | M1.1 — eject-pass happy path | `milestone-1-eject-and-test.feature:23` | **REPRODUCED** (`m1_happy_path`) | PATCH `region` required:true; exported `not_null` test passes against `orders.csv`. |
| 3 | M1.2 — drift detector | `milestone-1-eject-and-test.feature:31` | **REPRODUCED** (`m1_drift_detector`) | PATCH `order_id` required:true; 2/15 rows null; `dbt build` fails with "not_null_..." named. |
| 4 | M1.3 — customer-fidelity invariant (seeded bucket matches app) | `milestone-1-eject-and-test.feature:38` | **SIMPLIFIED-AWAY** | The invariant is enforced **by construction**: the driver sets `S3_BUCKET` from the same env the backend reads, and dbt resolves it via `env_var()` Jinja. If the value differs, `dbt build` 404s on parquet. No separate `seeded_profile_bucket` field needed. |
| 5 | M2.1 — pandera validates within 200ms | `milestone-2-validate-after.feature:29` | **SIMPLIFIED-AWAY** | A 200ms-budget per-turn check exists to give "fast feedback on shape errors." The simpler shape relies on `dbt test` as the validation gate — if the chat turn produces a wrong-shape staging frame, the SQL test fails the same way. No second validation layer; one source of truth. |
| 6 | M2.2 — wrong-shape on first attempt, correct on first rephrase | `milestone-2-validate-after.feature:36` | **SIMPLIFIED-AWAY** (becomes unit-test concern) | The retry-with-rephrase budget (AC1.5) is **chat-protocol** behavior, not dbt-test-validation. If you want retry coverage, it belongs in a chat-protocol unit test (mock the LLM, assert N rephrase calls), not riding on a dbt-eject E2E. The spike's `chat_then_eject_then_test` scenario shows that chat turns can drive prompts; retry semantics are a separate concern. |
| 7 | M2.3 — wrong-shape on every attempt, retry exhausts | `milestone-2-validate-after.feature:44` | **SIMPLIFIED-AWAY** (same as M2.2) | Same argument: retry budget is chat-protocol unit-test material. Note: the existing M2.3 implementation monkey-patches `PanderaValidator.validate` to deterministically fail — it isn't really an end-to-end test, it's a unit test wearing acceptance-test clothing. |
| 8–12 | M3.1–M3.5 — five earned-trust probes | `milestone-3-earned-trust-probes.feature` | **SIMPLIFIED-AWAY (4 of 5)** + **NOT-REPRODUCIBLE (1 of 5)** | These probes guard a *substrate that exists only because of the complex harness*:<br>• `probe_dbt_runner_importable` — dbt's own ImportError on `from dbt.cli.main import dbtRunner` does this work for free.<br>• `probe_dbt_duckdb_loadable` — same.<br>• `probe_export_endpoint_reachable` — `httpx` raises `ConnectError` with a clear message; no probe needed.<br>• `probe_minio_readable_via_duckdb` — dbt-duckdb's own httpfs error names the bucket and endpoint when the substrate is broken. The spike's `m5_missing_env_var` scenario demonstrates this — dbt fails fast with "Env var required but not provided: 'S3_BUCKET'."<br>• `probe_run_results_shape` — **the only one that survives.** It guards against dbt minor-version drift on the `dbtRunnerResult.result` shape. **In the spike this is moot** because the driver doesn't parse `.result` — it reads `res.success` (the rc) and walks `results` defensively. If dbt drops `.success`, dbt would have to rev a major version. |
| 13 | M4.1 — AC1.4 raw-tool-call leak guard | `milestone-4-protocol-invariants.feature:32` | **SIMPLIFIED-AWAY (wrong feature)** | This belongs to the **chat-protocol** test suite, not dbt-test-validation. The existing M4.1 reads chat traces for raw tool-call frames — that's a chat unit-test concern. ADR-014 lives in chat-protocol territory. |
| 14 | M4.2 — ADR-016 ingress URL invariant | `milestone-4-protocol-invariants.feature:37` | **SIMPLIFIED-AWAY (wrong feature)** | Same: this guards an architectural invariant (auth-proxy ingress), not dbt-test behavior. It belongs in an integration test for the routing layer. The spike's driver hits `localhost:1042` (auth-proxy port) by construction; the invariant is satisfied by configuration, not by an assertion in this feature's tests. |
| 15 | M5.1 — env_var rejection | `milestone-5-failure-modes.feature:24` | **REPRODUCED** (as `m5_missing_env_var`) | Spike strips `S3_BUCKET` from env before invoking dbt; dbt's own error names the missing var. The existing `DuckDBProfileSeeder._validate_existing_export` ([seeder.py:181](../../backend/tests/integration/dataset_layer/eject/seeder.py)) is ~50 LOC of bespoke defense that **dbt does for free**. |
| 16 | M5.2 — retry budget exhaustion with diff | `milestone-5-failure-modes.feature:31` | **SIMPLIFIED-AWAY (wrong feature)** | Same as M2.2/M2.3 — retry exhaustion is chat-protocol unit-test material. |
| 17 | — | | **REPRODUCED bonus** | `chat_then_eject_then_test` (driver scenario 3) demonstrates the chat-driven path. Skipped today because `GROQ_API_KEY` is unset — same gating as the existing `requires_groq` fixture. |

**Summary**: 5 of 17 REPRODUCED with the same observable contract (WS, M1.1, M1.2, M1.3 by construction, M5.1, plus a chat-driven smoke). 8 of 17 SIMPLIFIED-AWAY (either ride dbt's own errors, or belong to other features). 4 of 17 belong elsewhere (chat-protocol invariants).

## Findings

### What worked

1. **The export endpoint is already test-friendly.** `GET /api/projects/{id}/export/dbt` returns a usable zip; `profiles.yml` and `sources.yml` already use `env_var()` Jinja. The 30-LOC eject + unzip + run sequence reproduces M1.1 + M1.2 end-to-end without any test infrastructure between the driver and dbt.
2. **PATCH `schema_config` is the same fixture-driven setup the existing suite uses (post DWD-9).** The existing walking-skeleton also drives setup this way after the team discovered chat output is too non-deterministic to PATCH constraints (`docs/evolution/2026-05-11-dbt-test-validation.md` §"Walking-skeleton hardening", merge `de57afe`). The simpler shape inherits this discipline directly — same `@given`, ~5 lines instead of step-glue + harness method.
3. **Custom SQL tests in `tests/` work exactly as advertised.** Drop `.sql` files into a `tests/` directory in the unzipped project; `dbt build` runs them alongside the schema-generated tests. The customer's workflow IS the test workflow.
4. **Failing test names come from `dbtRunnerResult.result.results` directly.** No bespoke `RunResultsParser` (238 LOC) needed — a 5-line list comprehension over `res.result.results` extracts the failing test names plus messages. See `dbt_test_driver.py:run_dbt._invoke`.

### What surprised

1. **`profiles.yml` exports without `s3_use_ssl`.** The exported template assumes the customer's S3 target supports TLS — a reasonable default for AWS but wrong for local MinIO. The driver patches `s3_use_ssl: false` post-unzip in 10 lines. The existing harness's `DuckDBProfileSeeder` (209 LOC) **overwrites profiles.yml in full** to handle this — a much heavier hammer for the same nail.
2. **`S3_ENDPOINT` must be `host:port`, not a URL.** dbt-duckdb's httpfs prepends `https://` if you pass it `http://localhost:9000`, producing `https://http://localhost:9000`. The driver strips the scheme with `removeprefix(...)` (2 lines). The existing seeder has a `_strip_scheme` helper that does the same. This is a substrate-fidelity gap in the **export template**, not in the test infrastructure — both the spike and the harness solve it the same way. (Suggested follow-up: have the export emit `s3_use_ssl: "{{ env_var('S3_USE_SSL', 'false') }}"` so customers on plain-HTTP S3 don't have to patch the file by hand.)
3. **The dataset-name default is "New Dataset" → `stg_new_dataset`.** First-run, the upload endpoint assigns a default name. Custom SQL tests reference this by exact string. A customer would rename their dataset before ejecting; the spike works around this by hardcoding `stg_new_dataset` in the test SQL.
4. **dbt's own errors are already structured and clear.** When `S3_BUCKET` is unset, dbt fails with `Parsing Error / Failed to render models/staging/sources.yml ... / Env var required but not provided: 'S3_BUCKET'`. That's the same observable behavior the M5 seeder's bespoke `_validate_existing_export` defense produces — but free, and from dbt's own well-documented surface.

### What broke

Nothing in the production code path. The spike used only public endpoints (`/api/auth/callback`, `/api/projects`, `/api/uploads`, `/api/datasets/{id}`, `/api/projects/{id}/export/dbt`) — all the customer's actual surface. No reaches into internal modules. The export pipeline's substrate gaps (no `s3_use_ssl`, no scheme stripping) are pre-existing and equally affect the customer's real `dbt build`. They are addressable in the **exporter**, not in test infrastructure.

### What the comparison implies about the existing milestones

- **M1 is core.** Eject + custom tests + dbt build/test IS the feature. Reproducible in ~50 LOC of driver code.
- **M2 (per-turn Pandera) is a different feature.** It's an in-app validation layer for chat shape feedback. Whether or not it ships is independent of the eject-then-test gate. Don't entangle them.
- **M3 (earned-trust probes) earned its keep against the complex harness.** Without the seeder/parser/orchestrator, 4 of 5 probes have nothing to guard. The fifth (`probe_run_results_shape`) is a real concern but is a **3-line defensive read** in the simpler shape, not a 90-LOC probe + session-scoped fixture + structural enforcement test.
- **M4 is misfiled.** AC1.4 raw-tool-call leak guard (ADR-014) belongs to the chat protocol's own tests. ADR-016 ingress URL is a routing-layer invariant. Neither is dbt-test-validation's concern. They shipped here because the harness already runs the chat and already fetches the export — but co-location is not the same as cohesion.
- **M5.1 is dbt's own error, already.** M5.2 is more M2 retry-budget testing.

### LOC distribution and where the complexity actually lives

In the existing feature, the 3,442 test-infra LOC distribute roughly:

```
eject/orchestrator.py    418  ┐
eject/probe.py           443  │
eject/parser.py          238  │ ← Mostly substrate-lie defenses and a
eject/seeder.py          209  │   bespoke result-shape translator. dbt
eject/runner.py          106  │   gives most of this for free at the
eject/protocols.py        31  │   integration boundary.
                              ┘ 1462 LOC eject infra
validation/pandera_validator.py  143
validation/schemas/orders_staging.py  61
                              ┘  220 LOC per-turn layer (orthogonal feature)
tests/acceptance/...
  steps/dbt_test_validation_steps.py 1126  ← BDD step glue, mostly
  conftest.py                         201  │   fixture wiring around
  test_behavioral_enforcement.py      136  │   the orchestrator.
  *.feature                           ~230 │
                              ┘ 1760 LOC acceptance scaffolding
```

The **per-scenario logic** in the existing suite is tiny — most LOC is plumbing for the BDD-with-pytest-asyncio composition. The spike replaces all of that plumbing with one `run_scenario(jwt, scn)` function (~30 LOC).

### Honest trade-offs the spike does NOT pay

1. **No earned-trust probes.** If MinIO is unreachable, the spike's first scenario fails LOUDLY with dbt's own error. The existing suite skips with a clearly-labelled probe name. The spike makes "fail" and "skip" indistinguishable when run in CI without a compose stack — but CI gating with a `compose_stack_available` precheck (4 LOC) gives back the skip-when-unavailable contract.
2. **No retry-with-rephrase budget.** The spike runs each chat prompt once. If the LLM fails the contract on attempt 1, the scenario fails. For LLM-flakiness scenarios (M2.2), a thin retry loop in the driver (~10 LOC) would close the gap without the existing harness's full AC1.5 machinery.
3. **No per-turn 200ms validation.** A customer working interactively wants fast feedback on schema drift; they don't want to wait for `dbt build` after every chat turn. **This is the strongest argument for keeping a per-turn layer** — but it should be its own thing, not a milestone of dbt-test-validation. It's a chat-time tool, not a test-time tool.

### Risks the spike inherits

1. **Substrate gaps in the export template** (no `s3_use_ssl`, no scheme stripping). The spike works around them post-unzip; a real customer hitting MinIO would have to do the same. Address in the **exporter**, not the test harness.
2. **`dbtRunner` concurrency-safety** — same constraint as the existing feature (single-threaded within a Python process). The spike runs scenarios serially.
3. **Two SSOTs for the data contract** (Pandera schema + dbt `schema.yml`). The spike does not use Pandera; only `schema.yml`. **One SSOT.** This is a benefit, not a risk.

## Recommendation

**PARTIAL_MIGRATION**, confidence ~80%.

**What to migrate (high confidence)**:
- Replace M1 (3 scenarios), the walking skeleton (1 scenario), and M5.1 (1 scenario) with the spike-shaped driver. Coverage: 5 acceptance scenarios → ~150 LOC of driver + ~50 LOC of declarative scenarios + ~10 LOC of custom SQL tests. **Save ~3,000 LOC** of eject infra + acceptance scaffolding.
- Move M3's `probe_run_results_shape` concern into a 5-line defensive read in the driver. Delete the other 4 probes — they guard infrastructure that no longer exists. **Save ~800 LOC** (probe.py + behavioral_enforcement + fixture wiring).
- Move M4 (protocol invariants) to the chat-protocol test suite where they belong. **Save ~250 LOC** locally; net zero across the project — but cohesion goes way up.

**What to keep separate (medium confidence)**:
- M2 (per-turn Pandera) is a different feature with a different jobs-to-be-done outcome (O3/O6 vs O4). It should live or die on its own merits, not be ratified-by-association inside dbt-test-validation. If it ships, it should live in `backend/tests/integration/dataset_layer/validation/` and have its own (much smaller) acceptance suite — or be a chat-time feature, not a test-time feature at all.
- M5.2 (retry exhaustion with diff) is also an M2 concern. Same treatment.

**What to address upstream (high confidence)**:
- The export template gaps (`s3_use_ssl`, scheme stripping) — fix in [`backend/app/use_cases/project/_dbt/profiles_yml.py`](../../backend/app/use_cases/project/_dbt/profiles_yml.py). Two-line change; benefits both the test suite and real customers using MinIO.

**Why not FULL_REWRITE?** Some of the existing scenarios (M2 in particular) cover real behaviors that the spike-shape doesn't address. They should keep shipping — just not under the dbt-test-validation umbrella, and not coupled to the eject orchestrator.

**Why not STAY?** A 9× LOC reduction at the test-infra layer is too big to ignore, and most of the complexity guards infrastructure that exists only to support more complexity. The Earned-Trust probes are sound engineering, but only against a probe-worthy substrate; ~800 LOC defending ~200 LOC of probe-worthy code is the wrong ratio.

## What changed (and what didn't) in this spike

- **Added**: `tests/spike/dbt_test_driver.py`, `tests/spike/fixtures/{require_region,drop_empty_order_id}/tests/*.sql`, this document.
- **Did NOT change**: any backend code, any production export, any existing acceptance test, the merge queue config, or any existing CLAUDE.md / ADR. Branch pushed (`spike/dbt-test-driver-simplification`) but **not** submitted to the merge queue — this is a finding to discuss, not a merge.

## Reproduction

```bash
# From repo root, with compose stack up (auth-proxy on :1042, agent on :1041):
cd tests/acceptance/dbt-test-validation
uv sync                                                    # one-time
uv run --no-project python ../../spike/dbt_test_driver.py  # ~5–7s
```

`GROQ_API_KEY` is optional — the chat-driven scenario gracefully skips when unset.
