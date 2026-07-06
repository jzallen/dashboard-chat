# Journey Inventory — SSOT

This is the SSOT root for product-level user journeys. Each entry
points to the canonical YAML schema for the journey. Feature-level
DISCUSS artifacts may produce additional perspectives in
`docs/feature/{slug}/discuss/`; those promote to evolution on
`/nw-finalize`. The files here are the **journey contracts** all
waves reference.

Bootstrapped 2026-05-11 by feature `user-flow-state-machines`.

---

## Journeys

| id | name | yaml | feature origin | status |
|----|------|------|----------------|--------|
| J-001 | Login + Org Setup | [login-and-org-setup.yaml](./login-and-org-setup.yaml) | `user-flow-state-machines` (DISCUSS 2026-05-11) | active |
| J-002 | Project + Chat Session Management | [project-and-chat-session-management.yaml](./project-and-chat-session-management.yaml) | `project-and-chat-session-management` (DISCUSS 2026-05-13) | active |

## Catalog (not yet promoted to SSOT)

The following flows are catalogued in
`docs/feature/user-flow-state-machines/discuss/journey-inventory.md`
but have not yet been deep-dived to journey-yaml fidelity. Each gets
its own DISCUSS pass and lands here as a separate row.

| id (provisional) | name | feature origin | next step |
|---|---|---|---|
| J-003 | Dataset upload (chat-driven + direct) | future DISCUSS pass | dive after J-002 (per research §5 prioritization) |
| J-004 | Table / dataset preview | future DISCUSS pass | this one is closest to ADR-015 today; dive can probably re-use machinery |
| J-005 | Transform toggles (preview / apply / undo) | `transform-operations-ir` (DISCUSS 2026-06-18, **backend half only**) | backend operations-IR contract authored at `docs/feature/transform-operations-ir/discuss/journey-transform-operations-ir.yaml`; full SSOT promotion awaits the UI/state-machine dimension (JOB-002) |
| J-006 | View + report creation | future DISCUSS pass | weakest harness coverage; dive will add headless contracts |
| J-007 | dbt export | future DISCUSS pass | already mostly server-driven via ADR-019/024; dive will be thin |
| J-008 | Operator observability (diagnose a cross-service failure through the logs) | `log-coverage-and-quality` (DISCUSS 2026-06-20) | feature-level contract authored at `docs/feature/log-coverage-and-quality/discuss/journey-observability-sweep.yaml`; **not promoted to SSOT** — this is a cross-cutting operator/diagnosis loop (see Cross-cutting concerns below), not an end-user product flow |
| J-009 | LakeKeeper catalog-backend operator loop (provision an org's Iceberg catalog → represent a project → materialize a dataset via DuckDB → prove it's a derived cache → hand off / read back) | `lakekeeper-catalog-backend` (DISCUSS 2026-07-06) | feature-level contract authored at `docs/feature/lakekeeper-catalog-backend/discuss/journey-lakekeeper-catalog-backend.yaml`; **not promoted to SSOT** — this is an operator/data-engineer integration loop (see Cross-cutting concerns below), not an end-user product flow |

---

## Cross-cutting concerns (not separate journeys)

* **Token expiry / re-auth.** Modeled inside J-001 as the
  `expired_token` side-state. Every other journey's machine must
  declare a transition target for `expired_token`. The
  state-machine framework (DESIGN deliverable) provides a base
  contract for this.
* **Org switching.** Future feature. When it lands, every journey
  machine resets. The framework must expose a "reset all machines"
  signal.
* **Observability / log coverage (J-008).** Cross-cutting diagnosis
  loop spanning all five surfaces, owned by JOB-004
  (`log-coverage-and-quality`). Every journey's machine and every
  service should emit the shared ECS/OTel `LogRecord` envelope
  (`ui/app/lib/log.ts`) and carry the request-spanning
  `correlation_id`. Catalogued as provisional J-008 above but kept
  here because it is an operator concern observed *across* journeys,
  not a product flow of its own. Feature contract:
  `docs/feature/log-coverage-and-quality/discuss/journey-observability-sweep.yaml`.
* **LakeKeeper catalog-backend operator loop (J-009).** Cross-cutting
  operator/data-engineer integration loop: provision an org's Iceberg
  REST catalog (LakeKeeper) against WorkOS, represent a dc project as a
  LakeKeeper Project, materialize a chat-authored dataset as an Iceberg
  table via DuckDB (no dbt), prove the materialized table is a derived
  cache (re-derive == materialized; determinism probe passes with the
  catalog offline — the ADR-026 invariant), and hand a data engineer real
  Iceberg tables. Owned by JOB-005 (`lakekeeper-catalog-backend`).
  Catalogued as provisional J-009 above but kept here because it is an
  operator/data-engineer loop, not an end-user product flow. Feature
  contract:
  `docs/feature/lakekeeper-catalog-backend/discuss/journey-lakekeeper-catalog-backend.yaml`.

---

## Changelog

- 2026-05-11 — Bootstrapped by `user-flow-state-machines` DISCUSS;
  J-001 added.
- 2026-05-13 — J-002 promoted from catalog to active by the
  `project-and-chat-session-management` DISCUSS wave. J-002's
  journey contract lands at
  `docs/product/journeys/project-and-chat-session-management.yaml`.
- 2026-06-18 — `transform-operations-ir` DISCUSS authored the
  **backend half** of J-005 (the operations-IR source-of-truth
  contract) at
  `docs/feature/transform-operations-ir/discuss/journey-transform-operations-ir.yaml`.
  Not yet promoted to active SSOT — J-005 still needs its UI /
  state-machine dimension (JOB-002) before it lands here as a
  product journey contract.
- 2026-06-20 — `log-coverage-and-quality` DISCUSS catalogued J-008
  (operator observability) and recorded it as a cross-cutting
  concern (JOB-004). Feature-level journey contract at
  `docs/feature/log-coverage-and-quality/discuss/journey-observability-sweep.yaml`.
  Not promoted to SSOT — it is a cross-journey operator diagnosis
  loop, not an end-user product flow.
- 2026-07-06 — `lakekeeper-catalog-backend` DISCUSS catalogued J-009
  (LakeKeeper catalog-backend operator loop) and recorded it as a
  cross-cutting operator/data-engineer integration loop (JOB-005).
  Feature-level journey contract at
  `docs/feature/lakekeeper-catalog-backend/discuss/journey-lakekeeper-catalog-backend.yaml`.
  Not promoted to SSOT — it is an operator/data-engineer integration
  loop (provision an org's catalog → materialize → prove → hand off),
  not an end-user product flow.
