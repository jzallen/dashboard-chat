# DELIVER — Upstream Issues (Phase 0)

**Status:** Phase 0 architecturally complete; walking-skeleton (WS) scenario *not yet green* — three concrete substrate gaps surfaced by running the WS end-to-end. Each is bounded, well-named, and ready for follow-up triage.

The Earned-Trust contract (ADR-018 §4) did its job: every gap below was discovered by a probe failing loudly with a named reason, not by a silent green or a confusing red.

---

## Gap 1 — dbt-duckdb S3 endpoint wiring (current WS blocker)

**Surfaced at:** commit `c040a6e` — env vars exported correctly, dbt parse succeeds, dbt build fails.

**Symptom:**

```
IO Error: SSL peer certificate or SSH remote key was not OK error for HTTP GET
to 'https://dashboard-chat.datalake.s3.amazonaws.com/?encoding-type=url&list-type=2&prefix=datasets%2F.../'
```

DuckDB's httpfs is contacting AWS S3 (`<bucket>.s3.amazonaws.com`, virtual-host style) instead of the local MinIO endpoint. The seeded `profiles.yml` already contains the correct values (`s3_endpoint: http://localhost:9000`, `s3_url_style: path`, `s3_use_ssl: false`) but `dbt-duckdb` 1.10.1 isn't wiring them through to the underlying DuckDB connection at model-build time.

**Likely root causes (in order of probability):**

1. **Profile-key naming mismatch.** `dbt-duckdb` 1.10.1 may expect different key names than what `backend/app/use_cases/project/_dbt/profiles_yml.py` generates. Compare against the official `dbt-duckdb` 1.10.x readme to confirm the canonical key names for `s3_endpoint`, `s3_url_style`, etc.
2. **`secrets:` block required.** Newer `dbt-duckdb` versions wire S3 via a `secrets:` block in the profile or via a DuckDB `CREATE SECRET` statement. The current profile uses the legacy `s3_*` flat keys which the adapter may treat as session-level only (not propagated to model executions).
3. **`on-run-start` hook needed.** Adding `on-run-start: ["INSTALL httpfs;", "LOAD httpfs;", "CREATE OR REPLACE SECRET (TYPE S3, ...)"]` to `dbt_project.yml` (or to the seeded `profiles.yml`) would explicitly register the secret before any model runs.

**Triage path:** focused investigation of `dbt-duckdb` 1.10.1's S3 config layer (~30-60 min). Pin the right approach with a tiny reproducer (one-model dbt project + DuckDB profile + httpfs read against MinIO) before patching the seeder/exporter.

**Workaround if needed:** seeder writes an `on-run-start` `CREATE SECRET` block alongside the connection config. Bypasses the wiring question by being explicit. Documented as a workaround, not a root-cause fix.

---

## Gap 2 — `localhost:1042/api/auth/callback` 500 (intermittent, in early WS run)

**Surfaced at:** the first WS run after the import-resolution hotfix (`68e4192`). Subsequent runs masked it because the test failed earlier at the step-glue `pytest.fail` scaffold.

**Symptom:**

```
httpx.HTTPStatusError: Server error '500 Internal Server Error' for url 'http://localhost:1042/api/auth/callback'
```

Port 1042 is a dynamically-allocated port — probably wiremock or similar, used by the harness's existing fixture infra (`backend/tests/integration/dataset_layer/conftest.py:dataset_layer_project` or related).

**Status:** unverified post-fix-#5 — the WS now gets past fixture setup so the 500 may have been a transient artifact of pytest fixture-discovery ordering, OR may still surface on a fresh session. Worth re-running the WS with verbose pytest setup logs to confirm whether this is reproducible.

**Triage path:** if reproducible, trace the call: who's calling `POST /api/auth/callback`? It's not on the harness's normal dev-JWT-mint path (which uses `/.well-known/jwks.json`). May be a stale path from a pre-`AUTH_MODE=dev` fixture flow.

---

## Gap 3 — 9 milestone step-glue scaffolds (M1-M5)

**Status:** intentionally unimplemented per Phase-0-only scope.

The 9 remaining `pytest.fail("DISTILL scaffold — DELIVER implements: ...")` bodies in `tests/acceptance/dbt-test-validation/steps/dbt_test_validation_steps.py` cover scenarios across milestones M1-M5 (eject coverage, validate-after, earned-trust probes, protocol invariants, failure modes). They are NOT blockers for the walking skeleton; subsequent DELIVER waves enable them per the distill roadmap (`docs/feature/dbt-test-validation/distill/roadmap.json`).

Concretely:
- **M1** (3 scenarios) — eject happy/drift-detector/customer-fidelity
- **M2** (3 scenarios) — validate-after happy/retry/triage-signal
- **M3** (5 scenarios) — earned-trust probe failure injections
- **M4** (2 scenarios) — AC1.4 retention + ADR-016 ingress
- **M5** (2 scenarios) — export breakage + retry exhaustion

Each milestone is an independent DELIVER step per the distill roadmap.

---

## Phase 0 commit trail (this DELIVER round)

| # | Commit | Purpose |
|---|---|---|
| 1 | `0b4bb4c` | feat(test): test extras (dbt-core/dbt-duckdb/pandera) + isolation guard |
| 2 | `437c6f4` | feat(test/eject): DuckDBProfileSeeder |
| 3 | `0b8dd68` | feat(test/eject): DbtRunner via dbt.cli.main.dbtRunner |
| 4 | `76e8d05` | feat(test/eject): RunResultsParser |
| 5 | `25c042d` | feat(test/eject): 5 probe happy paths |
| 6 | `8645a64` | feat(test/validation): PanderaValidator + OrdersStaging |
| 7 | `967ae59` | feat(test/eject): EjectAndTestOrchestrator |
| 8 | `6724f52` | feat(test/dataset-layer): harness eject_and_test + validate_after |
| 9 | `68e4192` | fix(test/dbt-test-validation): wire acceptance venv to backend test deps |
| 10 | `aa68e9f` | docs(dbt-test-validation): backfill DIVERGE/DESIGN/DISTILL artifacts |
| 11 | `b4ec191` | fix(test/eject): probes wire dev JWT auth + MinIO bootstrap |
| 12 | `fc32810` | fix(backend): map DomainException to structured HTTP response globally |
| 13 | `244e682` | fix(test/eject): probe accepts 200 OR 404 |
| 14 | `b77aca0` | feat(test/dbt-test-validation): WS step bindings |
| 15 | `d15546a` | fix(test/eject): pass exported dbt profile name through to seeder |
| 16 | `c040a6e` | fix(test/eject): export S3_* env vars before dbtRunner.invoke |

8 Phase-0-roadmap steps + 2 infrastructure commits + 6 hotfixes. Architecture is sound; gaps above are downstream engineering.
