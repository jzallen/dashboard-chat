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

## Catalog (not yet promoted to SSOT)

The following flows are catalogued in
`docs/feature/user-flow-state-machines/discuss/journey-inventory.md`
but have not yet been deep-dived to journey-yaml fidelity. Each gets
its own DISCUSS pass and lands here as a separate row.

| id (provisional) | name | feature origin | next step |
|---|---|---|---|
| J-002 | Project + chat session management | future DISCUSS pass | dive after `user-flow-state-machines` DESIGN settles the machine framework |
| J-003 | Dataset upload (chat-driven + direct) | future DISCUSS pass | dive after J-002 |
| J-004 | Table / dataset preview | future DISCUSS pass | this one is closest to ADR-015 today; dive can probably re-use machinery |
| J-005 | Transform toggles (preview / apply / undo) | future DISCUSS pass | strongest existing server-side state (transforms API + replay); dive will mostly formalize the *preview* sub-state |
| J-006 | View + report creation | future DISCUSS pass | weakest harness coverage; dive will add headless contracts |
| J-007 | dbt export | future DISCUSS pass | already mostly server-driven via ADR-019/024; dive will be thin |

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

---

## Changelog

- 2026-05-11 — Bootstrapped by `user-flow-state-machines` DISCUSS;
  J-001 added.
