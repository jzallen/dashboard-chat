# Job-to-be-Done Analysis — `dbt-test-validation`

**Feature**: dbt-test-validation
**Phase**: DIVERGE Phase 1 — JTBD
**Date**: 2026-05-08

> ⚠️ The slug `dbt-test-validation` anchors on a *proposed solution*. This phase deliberately treats it as a working name and elevates the underlying job. The slug does not bind the recommendation.

---

## 1. Raw Request (verbatim)

> "I wonder if we have the right testing strategy. The point of being able to have api-driven tests was to create a completely headless system that could easily plug into the frontend, while making user workflow tests easier to automate. I think we're close to that goal but the setup still feels messy. One of the features of this application is to ultimately eject a dbt project. So, I wonder if testing the api responses is what we want. Adding pandas to the mix helps shed some light on what we care about: the staged data after sql transform. So, maybe we should be should just fire-and-forget the chat interactions, then use dbt sql tests to validate the desired outcomes."

---

## 2. Job Extraction — 5 Whys (tactical → strategic/physical)

| Why # | Question | Answer | Implied Layer |
|---|---|---|---|
| Q0 | What was asked? | "Switch the test strategy to fire-and-forget chat + dbt SQL tests" | Tactical (a proposed solution) |
| Q1 | Why move to dbt SQL tests? | "Because what we care about is the *staged data after SQL transform*, not the API response shape" | Operational |
| Q2 | Why does staged-data correctness matter more than API-response correctness? | "Because the product *ejects to dbt*. The staged data IS the contract with downstream — anything we assert against API JSON is incidental to the real artifact" | Operational |
| Q3 | Why is API-shape assertion unsatisfying today? | "Because the harness keeps growing — pandas was added just to peek at staging — and the assertions are coupled to a chat protocol that may keep changing" | Strategic — *the test surface is leaking the chat protocol's volatility into the test code* |
| Q4 | Why does that coupling hurt? | "Because chat-driven workflows are interpretive (LLM jitter, retry-with-rephrase). The test should be insensitive to *how* the workflow was driven, and sensitive to *whether the resulting data is correct*" | Strategic — *separate workflow execution from outcome validation* |
| Q5 | Why does that matter for the long arc of this product? | "Because in production, customers will eject to their own dbt project and run their own tests. If our test suite already speaks dbt, our validation becomes their validation — durable across the ejection boundary" | **Physical / Strategic — durability of the validation contract across the ejection boundary** |

**Stop condition met**: Q5 produces a *product-level durability claim* tied to the eject-to-dbt feature (see `features/dbt-project-export.feature`, `features/dbt-model-layers.feature`). Further "why?" lands at "because that's the product strategy" — out of scope.

---

## 3. Reject the Activity as the Job (first-principles inversion)

| Step | Result |
|---|---|
| Visible activity | "Run integration tests against the chat-driven dataset/staging layer" |
| Does anyone wake up wanting to run integration tests? | No — engineers wake up wanting *confidence that a change is safe to ship*. |
| Strip to irreducible function | **Detect when a chat-driven workflow has produced incorrect staged data, and do so with assertions that survive the eject-to-dbt boundary.** |

This is the physical-level job. It is independent of:
- The runner (pytest vs vitest vs dbt CLI)
- The assertion location (API response vs DuckDB introspection vs dbt test SQL)
- The coupling shape (assert on `ChatEvent` shape vs fire-and-forget)

These are *implementation choices* the brainstorming phase will diverge on.

---

## 4. Job Statements

### Functional Job (primary)

> **When** a chat-driven user workflow modifies the staging layer of a dataset,
> **I want to** validate that the resulting staged data matches the intended outcome contract using assertions that remain valid after the project is ejected to dbt,
> **so I can** ship workflow changes (chat protocol, transforms, dispatcher logic) without inventing a parallel validation path inside and outside the application.

### Emotional Job

> **When** an integration test fails,
> **I want to** know within seconds whether the failure is a *workflow* problem (the chat path didn't do what was asked) or a *data* problem (the SQL produced the wrong shape),
> **so I can** triage without spelunking through SSE traces and pandas dataframes side-by-side.

### Social Job

> **When** I show this codebase to a data engineer or analytics-engineer hire,
> **I want** the test artifacts to look like *the kind of validation they already write at their day job* (dbt tests, schema contracts, expectations),
> **so** the engineering pitch is "we're already speaking your language" rather than "you'll need to learn our bespoke harness first."

---

## 5. Disruption Check

**Is there a higher-level job that would make this entire job unnecessary?**

Two candidates considered:

1. **"Make the chat layer deterministic enough that workflow-level tests are unnecessary."** — Out of reach today (LLM jitter is intrinsic; pinned model + temp=0 narrows but does not eliminate). Would fold into "validate workflows" as one mechanism, not replace it.
2. **"Eject to dbt before testing, and test the ejected dbt project as the SUT."** — Plausible. This is a *real* disruption because it could collapse the workflow-test problem into "is `dbt build && dbt test` green on the ejected project?" It is captured as a candidate option (Option 6) for Phase 3, *not* dismissed here.

**Conclusion**: the job stands at strategic/physical level. Disruption candidate (2) is preserved as a structural option for brainstorming.

---

## 6. ODI Outcome Statements

Using the format `[Direction] + [Metric] + [Object] + [Context]`. All six pass the forbidden-words audit (no "easy/reliable/effective/manage" etc.) and embed no solution.

| # | Outcome | Direction | Metric | Object | Context |
|---|---|---|---|---|---|
| O1 | **Minimize** the time it takes to discover that a chat-driven workflow produced incorrect staged data | Min | time | discovery of incorrect staged data | per CI run |
| O2 | **Minimize** the likelihood that an assertion holds against the API response but fails against the staged data | Min | likelihood | false-pass on API-shape assertion | per chat turn |
| O3 | **Minimize** the effort required to keep the test suite valid when the chat protocol changes | Min | effort | maintaining tests through chat-protocol churn | per chat-protocol change |
| O4 | **Maximize** the reuse of validation logic between in-application tests and the customer's ejected dbt project | Max | reuse | validation logic across the ejection boundary | per project export |
| O5 | **Minimize** the marginal cost of adding the next user-flow test | Min | effort | adding the (N+1)th flow | per new flow |
| O6 | **Minimize** the time it takes to triage a failing test as workflow-vs-data | Min | time | triage to root-cause class | per failure |

### Opportunity Scoring (proxy — no survey, scored from harness/codebase signals)

| Outcome | Importance (1-10) | Satisfaction (1-10) | Score | Status | Evidence |
|---|---|---|---|---|---|
| O1 — discover incorrect staged data | 9 | 6 | 12 | Marginal | Today: `assert_distinct_values`/`assert_no_leading_trailing_whitespace` *do* run on the staged data via `GET /api/datasets/{id}` preview. Working but indirect — pandas was added to peek at staging through the API response, which the user explicitly flagged as a code smell. |
| O2 — false-pass on API-shape | 8 | 5 | 11 | Marginal | The harness asserts both protocol-level (`ChatEvent` shape) AND data-level (table-state). False-pass on API-shape with bad data is *unlikely* today but the surface remains — `assert any(e.type == "transform_applied" ...)` in `test_dataset_staging_layer.py` is a protocol assertion, not a data assertion. |
| **O3 — chat-protocol churn cost** | **9** | **3** | **15** | **Under-served** | The harness grew from 695 LOC (2026-05-01) to 1104 LOC (2026-05-07) without adding test scenarios — the cost of *keeping the existing tests valid through chat-protocol stratification* (ADR-014 events). The user's "the setup still feels messy" lands here. |
| **O4 — reuse across ejection boundary** | **9** | **2** | **16** | **Under-served** | Zero reuse today. Staging SQL goes through Ibis (ADR-007); ejected dbt project ships sources.yml + stg_*.sql + schema.yml (`features/dbt-project-export.feature`). No `dbt test` integration in our suite. The customer who ejects writes their own tests from scratch. |
| **O5 — marginal cost of next flow** | **8** | **4** | **12** | **Marginal-to-under-served** | Demo doc has 10 cleanup ops + 2 count queries. Adding op 11 means: write prompt, write rephrase pair, write data assertion, hope retry budget absorbs jitter. Each op accumulates ~30-50 LOC of per-flow test code. |
| O6 — workflow-vs-data triage | 7 | 5 | 9 | Appropriately served | Today: SSE transcript is captured in `ChatEventTrace`, table-state diff is in `TableState`. Both surface at failure. Triage-cost is moderate but not crisis-level. |

**Three highest-opportunity outcomes** (drive the brainstorming brief):
- **O4 — reuse across ejection boundary** (16) — *the user's explicit hypothesis*
- **O3 — chat-protocol churn cost** (15) — *the user's "setup feels messy" signal*
- **O1 — discover incorrect staged data** (12) — *the load-bearing functional outcome*

O5 (marginal cost of next flow) is the secondary tier — a strong tie-breaker between options that score similarly on O3/O4.

---

## 7. Job Summary (handoff to brainstorming)

**Validated job at strategic/physical level**:

> Detect when a chat-driven workflow has produced incorrect staged data, using assertions that remain valid after the project is ejected to dbt and that do not pay the cost of chat-protocol churn.

**Three under-served outcomes** ground the HMW question:
1. Reuse validation logic across the in-app ↔ ejected-dbt boundary (O4)
2. Decouple test maintenance from chat-protocol changes (O3)
3. Keep discovery of incorrect staged data fast and unambiguous (O1)

**Gate G1**: ✓ Job at strategic/physical level. ✓ Six ODI outcome statements (≥3 required). ✓ No feature references in job statement. ✓ Disruption candidate identified and preserved for brainstorming.

**Bootstrapped to SSOT** as `JOB-001` in `docs/product/jobs.yaml` (created this phase — greenfield SSOT).
