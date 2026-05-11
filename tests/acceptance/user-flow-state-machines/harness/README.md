# UserFlowHarness — TS Acceptance Harness for J-001

This harness is the **TS-side dual** of
`backend/tests/integration/dataset_layer/harness.py` (which owns
JOB-001 backend+agent contract). The TS harness owns **JOB-002 user-
flow integration** (per DISCUSS `wave-decisions.md` D3) and is a
first-class deliverable of US-004 — meaning its public surface is
itself an acceptance-test target (`slice-2-harness-drives-transitions.feature`).

## The four-piece contract

Every harness method drives the flow-state tier via these four wire
contracts (from `docs/feature/user-flow-state-machines/design/handoff-design-to-distill.md`):

1. **Endpoints** — reached through `auth-proxy:1042/flow-state/*`:
   - `POST /flow/<machine>/begin` → starts a machine; returns `{ correlation_id, projection }`
   - `POST /flow/<machine>/event` → sends an event; returns `{ projection }`
   - `GET  /flow/<machine>/projection?flow_id=<machine>:<principal>` → reads current projection
   - `POST /flow/<machine>/freeze` and `/thaw` — cross-machine FREEZE (US-005)
   - `GET  /flow/<machine>/projection/stream` — SSE deltas (Slice 3)

2. **ActiveScope schema** (`{ org_id, project_id, resource_type?, resource_id? }`
   per ADR-029) — invariants I1-I5 enforced server-side by `ScopeResolver`.

3. **Flow events** — Redis Streams shape `{ ts, type, payload, correlation_id }`;
   `flow_id = <machine-name>:<principal_id>` per ADR-030 §SD3.

4. **Projection shape** — `{ flow_id, state, context, active_scope, sequence_id, last_event_at, correlation_id }`.

## Public surface

```ts
await harness.begin_auth("maya")
await harness.submit_org("Acme Data")
await harness.assert_state("ready")
await harness.force_transient_failure("jwks_not_warm")
await harness.assert_jwt_carries_org_claim()
await harness.expire_token()
await harness.assert_scope({ org_id: "...", project_id: "..." })
```

## Boundary rules

- Tests never `import` from `flow-state/lib/**` — they call HTTP only.
- The harness routes through `auth-proxy`, never directly at the
  flow-state tier port. This is the driving port (CM-A).
- The harness owns no domain logic — every call delegates to the
  flow-state tier. Business logic lives in production code (CM-B/CM-D).
