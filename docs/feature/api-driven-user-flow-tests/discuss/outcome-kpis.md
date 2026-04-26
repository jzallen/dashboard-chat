# Outcome KPIs — api-driven-user-flow-tests

| # | KPI | Baseline | Target | Measurement |
|---|-----|----------|--------|-------------|
| K1 | Time to validate the dataset (staging) layer (operator wall-clock) | ~15 min recorded demo + setup + friction-CSV bookkeeping | ≤ 5 min headless test run with real Groq (Groq round-trips dominate); < 2 min stretch on local with warm caches | Test runner duration; recorded in CI artifacts and developer-reported on demand. |
| K2 | WorkOS calls in the test path | n/a (current path is browser-driven; WorkOS fires on every login) | 0 outbound requests to `*.workos.com` in any mode (local or CI) | Test fixture wraps outbound HTTP and asserts on the WorkOS netblock specifically; passing test that hit WorkOS is treated as a failure. Other production endpoints (Groq, MinIO) are unrestricted. |
| K3 | Test-suite green rate over 30 rolling days (flakiness budget) | n/a | ≥ 95% PASS rate on `main` over a rolling 30-day window | CI history grep; tracked on whatever dashboard the team already uses. Flake rate above 5% triggers a `nw-troubleshooter` investigation rooted in the AC1.5 reprompt budget + Q1 determinism dials, not a quarantine. |
| K4 | Effort to encode an additional user flow once harness primitives exist | n/a | < 1 day of crafter time to add a second flow (e.g., view-layer or report-layer demo) | Self-reported; logged in the bead created for the second flow. This is the "marginal effort" claim from the user's request — measured rather than asserted. |
| K5 | Reprompt count on a green dataset-layer run | n/a | ≤ 2 reprompts per cleanup operation (matches demo doc tolerance); 0 reprompts is the expected steady state once Q1 dials are tuned | Test reports per-operation reprompt count; thresholds enforced as soft warnings, not failures, per AC1.5. Trend tracked over time as an agent-quality drift signal. |

## Notes on Measurement

- **K1** is the headline KPI. If it does not move, the feature has failed regardless of test correctness. Note: real Groq is in the loop, so the budget is realistic, not aspirational.
- **K2** is the only network-traffic guarantee. WorkOS specifically is forbidden; Groq, MinIO, DuckDB and other production dependencies are real per the Guiding Principle. A passing test that hit WorkOS is treated as a failure.
- **K3** is the "is this useful pre-merge?" KPI. A flaky-but-correct test is a worse pre-merge gate than no test, because it teaches developers to override CI. Real-LLM jitter is the dominant flake source — Q1's determinism dials and AC1.5's retry budget exist to keep this metric green.
- **K4** is the "did the harness composability claim hold up?" KPI. We expect to validate it within ~30 days of merging Story 1 (when the next flow is encoded).
- **K5** lets us track agent quality drift over time using the dataset-layer cleanup workload as a reference. Sustained increase in reprompts = signal that prompts or tools need work, even before K3 dips.

## Why these and not others

We considered, then rejected:

- **"% reduction in browser E2E test runs"** — premature; Playwright suite is small today. The KPI presumes a switchover decision we are not making in this feature.
- **"Zero external network calls in CI"** — explicitly anti-goal per the Guiding Principle. Production fidelity requires real Groq, real MinIO, real backend, real worker.
- **"LLM tokens consumed per CI run"** — useful as a cost-control tripwire but a poor outcome KPI. If it becomes load-bearing for budget, file as a separate ops concern.
- **"# of bugs caught pre-merge by the dataset-layer test"** — only knowable in retrospect; revisit post-30-day if we want to build a case for expanding coverage.
