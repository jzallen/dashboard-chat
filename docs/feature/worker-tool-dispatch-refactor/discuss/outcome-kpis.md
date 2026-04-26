# Outcome KPIs — worker-tool-dispatch-refactor

| # | KPI | Baseline | Target | Measurement |
|---|-----|----------|--------|-------------|
| K1 | Cross-cutting code-change cost for adding a new chat tool | Today: ≥ 2 modules edited (worker schema + FE dispatcher branch); often a third (backend) | After: 1 module edited if the new tool maps to an existing event type; 2 modules (worker + FE event handler) if it requires a new event type | Counted at PR review on the next chat-tool addition after this feature merges. Self-reported by the dev who ships the next tool. |
| K2 | Backend imports of chat / Groq / SSE concepts | Today: TBD (verify via `rg -i 'groq\|tool_call\|sse' backend/app/`) — likely 0 already, but not enforced | After: 0 (per AC1.4); enforced by a small CI grep guard | CI step: `! rg -i 'groq\|sse\|tool_call' backend/app/` returns non-zero on regression. |
| K3 | FE component test wall-clock per chat-event scenario | Today: writing one is impractical (real worker + Groq required); de-facto baseline is "test via Playwright" at 10–30s per scenario | After: < 100ms per synthesized-SSE component test (per AC3.1–3.3) | vitest run time on the chat-panel test suite. |
| K4 | Time to unblock `api-driven-user-flow-tests` after this feature merges | Today: indefinitely blocked | After: < 1 day to revise its DESIGN doc and continue to DISTILL (per AC4.3) | Self-reported on the api-driven-user-flow-tests feature's resumption commit. |
| K5 | SSE protocol contract changes per chat-tool addition | Today: N/A (no protocol contract — the contract is "raw Groq tool calls") | After steady state (after first 1–2 quarters): ≤ 1 new event type added per quarter; most new tools map to existing types | Track event-vocabulary churn in `agent/CHAT_PROTOCOL.md` (or wherever DESIGN puts the doc) commit history. Quarterly review. |

## Notes on Measurement

- **K1** is the headline KPI. The whole point of the refactor is to reduce coupling cost; if the next chat tool still needs three-module changes, the refactor failed regardless of test correctness.
- **K2** is the structural-fidelity KPI. It enforces "backend stays plug-n-play" mechanically. Cheap to add, cheap to enforce.
- **K3** validates Story 3 — FE component tests are now possible without a worker. The 100ms target is a sanity check, not a hard SLA; if it drifts above 1s for some legitimate reason, the KPI is "tests exist and pass," not the latency.
- **K4** is the downstream-unblock KPI. It measures whether the contract this refactor establishes is actually thin enough to do what we promised it would.
- **K5** is a long-tail KPI. If we keep adding event types every week, the vocabulary is a leaky abstraction and Story 1's "zero FE change for new tools" promise has eroded.

## Why these and not others

We considered, then rejected:

- **"Lines of frontend code removed"** — vanity metric. The FE may grow in some places (event handler tables) and shrink in others (raw tool-call dispatcher); net LOC is not a cleanliness signal.
- **"Worker test coverage %"** — coverage is a means, not an end. The AC-targeted tests are the actual value; coverage % follows.
- **"Reduction in chat-related Slack/incident messages"** — too vague to measure cleanly; not actionable.
- **"Number of chat tools"** — tool count is a feature-velocity metric, not a refactor-quality metric. Could stay flat or grow regardless of whether this refactor succeeded.
