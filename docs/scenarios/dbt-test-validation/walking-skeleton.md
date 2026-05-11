# Walking-Skeleton Notes — dbt-test-validation

**Feature:** dbt-test-validation
**Wave:** DISTILL
**Date:** 2026-05-09
**Author:** Quinn (nw-acceptance-designer)

The `.feature` file at `tests/acceptance/dbt-test-validation/walking-skeleton.feature`
is the SSOT for the walking-skeleton scenario. This file holds notes on
*why* that scenario was chosen and how the e2e path threads through the
real adapters.

## The chosen e2e path

```
                                                  ┌─ MinIO (real Parquet datalake)
                                                  │
   pytest                                         │
     │                                            │
     │   harness.chat_turn("drop nulls...")       │
     ▼                                            │
   DatasetLayerHarness ──HTTP──> auth-proxy ──> backend ──> Ibis ──> DuckDB ──> MinIO
     │                                ▲                                          ▲
     │                                │                                          │
     │   harness.eject_and_test()     │                                          │
     ▼                                │                                          │
   EjectAndTestOrchestrator ────HTTP──┘                                          │
     │  (fetch zip)                                                              │
     │                                                                           │
     ▼                                                                           │
   tmpdir (real filesystem)                                                      │
     │                                                                           │
     │  unzip + seed profiles.yml                                                │
     ▼                                                                           │
   DuckDBProfileSeeder                                                           │
     │                                                                           │
     ▼                                                                           │
   dbtRunner.invoke(deps/build/test) ───────────real httpfs read─────────────────┘
     │
     ▼
   RunResultsParser ──> EjectTestReport(status="pass", ...)
```

Every box in that diagram is real (Strategy C — DWD-1). The only skip
points are:
1. The compose stack itself — `requires_compose_stack` skips the suite
   if auth-proxy or agent isn't reachable.
2. Groq — `requires_groq` skips chat-driven scenarios if `GROQ_API_KEY`
   is unset.
3. Per-probe — the session-scoped `eject_orchestrator` fixture invokes
   `probe()` once and `pytest.skip(reason)`s with the failing probe
   named if any probe fails.

## Why this scenario

The walking skeleton answers ONE question: **"Can a customer who
finished a chat-driven cleaning workflow re-validate the resulting
project as ejected dbt and see that it still works?"** That is exactly
JOB-001's strategic-level outcome (durability across ejection) and
exactly what an Option β realization promises.

The scenario does NOT:
- Test individual driven adapters (those have their own
  `@adapter-integration` scenarios in milestone-1, milestone-2, milestone-3)
- Test the retry budget interaction (milestone-2 owns that)
- Test the protocol invariants (milestone-4 owns that)
- Test failure modes (milestone-3 + milestone-5 own those)

It IS the smallest end-to-end demonstration of the customer-fidelity
contract. If this skeleton goes GREEN, every component on the path is
wired correctly and every protocol is honored — that is the
walking-skeleton litmus test.

## Driving adapter discipline

Per ADR-019 §4 ("wire then probe then use") and the nw-distill skill's
"Driving Adapter Verification" mandate, the WS scenario MUST exercise
the user's actual entry point. For this feature the entry point is the
`DatasetLayerHarness` Python facade — the canonical test-time driver
per `architecture/brief.md` §"Test architecture".

The `@when` step bindings in
`steps/dbt_test_validation_steps.py` invoke:
1. `harness.chat_turn("drop rows where order_id is missing")`
2. `harness.eject_and_test(project_id)`

Both are public methods on the facade. The orchestrator + seeder +
runner + parser are NEVER constructed or imported in step glue — they
are only constructed by the session-scoped `eject_orchestrator`
fixture (composition-root invariant).

## What the skeleton observes

The skeleton's `@then` steps assert:
1. `EjectTestReport.status == "pass"` (the customer-fidelity contract)
2. `len(EjectTestReport.models_built) >= 1` (something was actually built)
3. `len(EjectTestReport.tests_run) >= 1` (something was actually validated)

Three assertions, all on the return value of the driving port — Dim 7
mechanical checklist passes for every Then step (no internal state, no
file existence checks, no mock call assertions).

## Walking-skeleton litmus test (skill `nw-test-design-mandates`)

1. **Title describes user goal?** YES: "Customer cleans a dataset via
   chat and re-validates it as ejected dbt"
2. **Given/When describe user actions/context?** YES: "a fresh project
   with a small orders dataset uploaded", "the customer asks the chat
   to drop rows where order_id is missing", "the customer ejects the
   project and re-runs the validations"
3. **Then describe user observations?** YES: "the ejected project
   re-validates successfully", "every staging model the chat produced
   was built and tested" — both observable through the EjectTestReport
   the customer would inspect themselves
4. **Demo-able to non-technical stakeholder?** YES — the JOB-001
   narrative: "I cleaned my data via chat, and when I outgrew chat I
   ran my workflow as dbt and it still worked"

All four pass.

## Why this is the only walking skeleton

Milestone-2 (validate-after) is conceptually orthogonal to the eject
path — it is the per-turn fast-feedback layer (β only, design.md §2).
A user-facing walking-skeleton for it would need a separate "user
runs a chat workflow and the per-turn validation engages" framing,
which is fundamentally a focused boundary scenario rather than an
end-to-end user goal. We treat it as a focused milestone instead.

The walking-skeleton + 15 focused scenarios = 16 total. Slightly under
the skill's recommended 20 because β has two binding points sharing one
user-facing journey, so additional WS scenarios would be redundant. The
focused-to-WS ratio (15:1) lands at the lower end of the recommended
17-18 focused per WS, which is appropriate given the milestone files
already over-cover error paths (9 error / 16 = 56% error path ratio).
