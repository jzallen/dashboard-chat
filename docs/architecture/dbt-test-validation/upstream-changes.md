# Upstream Changes — `dbt-test-validation` — DESIGN

**Feature:** dbt-test-validation
**Wave:** DESIGN
**Date:** 2026-05-08
**Author:** Morgan (nw-solution-architect)

---

## Summary

**No upstream revisions required.**

DIVERGE assumptions were re-validated during DESIGN. All hold.

## Re-validation log

| DIVERGE assumption | DESIGN finding | Status |
|---|---|---|
| `dbt-project-export` endpoint exists at `POST /api/projects/{id}/export-dbt` | Endpoint is `GET /api/projects/{id}/export/dbt` (router file `backend/app/routers/projects.py:54`). DIVERGE used the prose form; the actual route is GET-shaped per RFC 7231 (idempotent representation). | **Cosmetic correction**, captured in ADR-019 §References. Not an upstream change to DIVERGE. |
| `dbt-project-export` has Gherkin specs but no green test gate today | Endpoint has 3 use-case unit tests in `backend/tests/use_cases/project/test_export_dbt_project.py` (`test_export_when_project_has_datasets_returns_zip`, `test_export_when_project_not_found_returns_failure`, `test_export_when_no_datasets_returns_skeleton_zip`). Tests cover happy-path zip generation, project-not-found, and empty-project skeleton. They do NOT exercise runtime substrate (MinIO httpfs readability with the seeded profile, `dbt deps`/`build`/`test` end-to-end, `run_results.json` schema). | DIVERGE's framing "no green test gate" is **partially true** — there is a use-case unit-test gate; there is no end-to-end gate. The substantive risk DIVERGE flagged (load-bearing on runtime correctness) is unchanged. ADR-019 addresses it via `probe()` rather than gate-first hardening. **No upstream revision required.** |
| AC1.6 (5-min wall-clock) is the load-bearing constraint | Held. DESIGN estimated ~85–105s/flow at M=1. Profile in DELIVER. | **Confirmed.** |
| ADR-016's 5-service compose stack is a hard constraint | Held. The orchestrator runs OUTSIDE the compose network. | **Confirmed.** |
| ADR-007 (Ibis) is unaffected by C | Held. Two DuckDBs, one source-of-truth (MinIO Parquet). The eject step exercises the dbt-compiled SQL (which the customer ships), not Ibis's runtime materialization. | **Confirmed.** |
| Option B is a layerable companion | DESIGN ratifies layering as Option β. Only B's per-turn layer is borrowed; B's full translator is deferred. | **Confirmed and refined.** |
| Option C's two weaknesses (T4 wall-clock, dependency on export correctness) are real | T4: addressed by AC1.6 headroom + γ contingency at M ≥ 3 flows. Dependency: addressed by `probe()`. | **Confirmed and addressed.** |

## Conclusion

DIVERGE's recommendation, dissent framing, and OQ list are accurate and
sufficient. DESIGN ratifies without amendment. This file is the formal
"no upstream changes" record per the DESIGN-wave protocol.
