# Evolution

Post-mortem / lessons-learned summaries for completed nwave-ai features,
produced by `/nw-finalize`. Each entry archives the feature's wave
artifacts and surfaces lasting decisions, deferred items, and lessons.

Earlier entries are flat single-file summaries
(`YYYY-MM-DD-{feature-id}.md`). Starting with
`2026-05-12-user-flow-state-machines/` the layout is a directory with
`FINALIZE.md` plus a verbatim copy of the feature's `discuss/`,
`design/`, `distill/`, `deliver/` subtree.

## Index

- [2026-05-15-ui-state-vocabulary-convergence.md](2026-05-15-ui-state-vocabulary-convergence.md) — 10-MR refactor chain that executed the ui-state vocabulary audit: ratifies ADR-039 conventions, completes ADR-030 LEAF-A/B/C snapshot-read migration, splits `intent_session_id` into deeplink + pending_resume, renames remaining `j002_*` / `session_chat_*` events to `project_context_*`, and rewrites the three machine READMEs as standalone educational docs.
- [2026-05-13-frontend-coexistence/](2026-05-13-frontend-coexistence/FINALIZE.md) — strangler-fig SPA → RRv7 framework mode migration; new `web-ssr` Hono container behind nginx; `ui-presentation/` dissolved; ratifies ADR-033 + ADR-034 across four MRs (cornerstone / obsidian / flint / slate); operational invariants encoded (loader timeout ≤5s, byte-equivalence under `--scale=N`, auth-proxy fan-out ≤110%).
- [2026-05-12-ibis-as-only-sql-compiler/](2026-05-12-ibis-as-only-sql-compiler/FINALIZE.md) — ibis end-to-end across staging/view/report/intermediate tiers; closes Gap 1 (injection), Gap 2 (freeform SQL in report tools), Gap 3 (lake-repo `quote_ident`); ratifies ADR-026.
- [2026-05-12-user-flow-state-machines/](2026-05-12-user-flow-state-machines/FINALIZE.md) — server-owned flow state machines + scope chain; new `ui-state` Hono tier + `ui-presentation`; ratifies ADR-027..031.
- [2026-05-11-dbt-test-validation.md](2026-05-11-dbt-test-validation.md) — dbt test validation feature.
- [2026-05-07-agent-ai-sdk-v6-migration.md](2026-05-07-agent-ai-sdk-v6-migration.md) — agent migration to AI SDK v6.
- [2026-05-07-refactor-dataset-layer-harness.md](2026-05-07-refactor-dataset-layer-harness.md) — dataset-layer harness refactor.
- [2026-05-07-replace-stream-io-with-redis.md](2026-05-07-replace-stream-io-with-redis.md) — replace stream IO with Redis Streams.
- [2026-05-04-log-image-identity-on-startup.md](2026-05-04-log-image-identity-on-startup.md) — log image identity on startup.
- [2026-05-01-api-driven-user-flow-tests.md](2026-05-01-api-driven-user-flow-tests.md) — API-driven user flow tests.
- [2026-04-29-worker-tool-dispatch-refactor.md](2026-04-29-worker-tool-dispatch-refactor.md) — worker tool dispatch refactor.
- [hotspot-2026-04-24.md](hotspot-2026-04-24.md) — code-churn hotspot analysis (2026-04-24).
