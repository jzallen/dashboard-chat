# UserFlowHarness — TS Acceptance Harness for J-001

This harness is the **TS-side dual** of
`backend/tests/integration/dataset_layer/harness.py` (which owns
JOB-001 backend+agent contract). The TS harness owns **JOB-002 user-
flow integration** (per DISCUSS `wave-decisions.md` D3) and is a
first-class deliverable of US-004 — meaning its public surface is
itself an acceptance-test target (`harness-drives-every-sign-in-and-org-setup-transition.feature`).

## The wire contract (ADR-046 MR-6 — the single `/state` surface)

Post ADR-046, the three former per-machine mounts collapse into ONE document
surface. Every harness method drives the ui-state tier via these contracts
(reached through `auth-proxy:1042/ui-state/*`):

1. **Endpoints**:
   - `GET  /state` → the current `ChatAppStateDocument` (`.getSnapshot`)
   - `POST /state/events` → body `{ type, payload }`; the response IS the new
     document (`.send`). `begin` is the reserved `session_begin` event and
     `open-deep-link` is the `open_deep_link` event (ADR-046 Decision 3).
   - `GET  /state/stream` → SSE; the document on every change (`.subscribe`)
   - `POST /flow/session-chat/freeze` and `/thaw` — cross-machine FREEZE
     (US-005). These remain a separate gated test-wire substrate, NOT part of
     the `/state` triad.

2. **ActiveScope schema** (`{ org_id, project_id, resource_type?, resource_id? }`
   per ADR-029) — now a SINGLE authoritative top-level field on the document
   (deepest-resolved region wins); invariants I1-I5 enforced server-side.

3. **Identity** is header-derived (`X-User-Id`, injected by auth-proxy). There
   is no `flow_id` on the wire — the document carries no id (ADR-046 Dec. 1B).

4. **`ChatAppStateDocument` shape** — `{ phase, active_scope, sequence_id,
   last_event_at, request_id, regions: { onboarding, projectContext,
   sessionChat } }` where each region is a `{ state, context }` slice. The
   harness exposes a region slice (its `{state, context}` + the top-level
   `active_scope`/bookkeeping) to callers; `correlation_id` is sourced from the
   document's `request_id` (the reference-code handle of the last transition).

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

- Tests never `import` from `ui-state/lib/**` — they call HTTP only.
- The harness routes through `auth-proxy`, never directly at the
  ui-state tier port. This is the driving port (CM-A).
- The harness owns no domain logic — every call delegates to the
  ui-state tier. Business logic lives in production code (CM-B/CM-D).
