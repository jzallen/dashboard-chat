# ADR-029: `active_scope` Propagation Contract

**Status:** Accepted (ratified 2026-05-11)
**Date:** 2026-05-11
**Originating wave:** DESIGN — `user-flow-state-machines`
**Companion artifacts:**
- DISCUSS Round-2 D9 directive: `docs/feature/user-flow-state-machines/discuss/wave-decisions.md` §"Round-2 iteration / D9"
- Shared artifacts registry (`active_scope` entry, HIGH risk): `docs/feature/user-flow-state-machines/discuss/shared-artifacts-registry.md`
- DESIGN application-architecture: `docs/feature/user-flow-state-machines/design/application-architecture.md`
- Sibling ADRs: ADR-027 (ui-state tier + framework), ADR-028 (XState v5 actor model)

## Context

The DISCUSS Round-2 directive D9 surfaced an implicit but load-bearing requirement: every user flow except login operates inside a specific `active_scope = { org_id, project_id, resource_type?, resource_id? }`. The framework chosen in DESIGN MUST express this scope inheritance cleanly without manual per-component plumbing. The canonical drift case the directive names is the "ChatView project-context race" — `useParams("projectId")` racing a separate `/api/projects/{id}` fetch racing a TanStack Query cache, all re-deriving what should be a single source of truth.

ADR-027 picks the host (the ui-state Node tier) and the FE framework (Remix; or Option B's plain SPA as fallback). ADR-028 picks the engine (XState v5 actor model). This ADR specifies the **data-flow contract** that makes scope propagation a single-source-of-truth concern by construction.

## Decision drivers

- **Single source of truth.** `active_scope` resolves at exactly one place per request. No FE component reads it from anywhere else.
- **Server-resolved.** The resolution site is the ui-state tier, not the FE. The FE's role is consumption, not derivation.
- **Multi-tenant safety.** `active_scope.org_id` MUST equal the JWT's `org_id` claim. Cross-tenant inconsistency is a 403, not a silent state.
- **Stale-link safety.** If a URL says project A but the user's machine context says project B, the ScopeResolver wins; the FE receives the authoritative scope and renders accordingly, OR a transition to a named error state surfaces the mismatch.
- **Agent integration.** The chat agent receives `org_id` + `project_id` from the same `active_scope` on every turn (per Round-2 D8). The agent does not re-derive scope.
- **TS harness symmetry.** The harness reads `active_scope` from the same projection the FE reads. `assert_scope({...})` introspects this.

## Considered options

The propagation mechanism varies by framework choice (see ADR-027). This ADR specifies the **invariant contract** that all framework options must satisfy, then names the framework-specific propagation mechanism.

1. **Inertia `shared props`** — server-side middleware sets `active_scope` on the prop bag for every route render. (Cut at ADR-027 because the Hono Inertia adapter is unmaintained.)
2. **Remix `useRouteLoaderData("root")`** — root loader returns `active_scope`; nested loaders augment with route-param-derived intent; any leaf reads via `useScope()` helper. **(Selected for Option D.)**
3. **React Context + custom `useScope()` hook fed by TanStack Query subscribing to the projection endpoint** — single ScopeProvider at the AppShell boundary; consumers read via `useScope()`. **(Selected for Option B.)**
4. **Per-component fetch / `useParams` read** — the status quo. Rejected: this is the drift class the feature retires.

## Decision outcome

### 1. Invariant contract (framework-independent)

```ts
// Shared type — re-exported from a single location.
// Lives in shared/ui-state/scope.ts; imported by FE, ui-state tier, and TS harness.
export type ActiveScope = {
  org_id: string;                         // always present once authenticated
  project_id: string | null;              // null in login flow only
  resource_type: "dataset" | "view" | "report" | null;
  resource_id: string | null;             // non-null iff resource_type non-null
};
```

Invariants enforced by the ScopeResolver in the ui-state tier:

1. `active_scope.org_id` always equals the verified JWT's `org_id` claim. Mismatch is a 403 from the projection endpoint with diagnostic `scope mismatch: jwt.org_id != requested.org_id`.
2. `active_scope.project_id` is non-null whenever the requesting flow's machine state requires a project context.
3. `(resource_type === null) ↔ (resource_id === null)`. The pair is atomic. Schema-enforced.
4. Cross-tenant resource access (project_id belongs to org_id_B, request carries jwt.org_id_A) is rejected with 403 + `scope mismatch: project belongs to a different org`.
5. Stale-link reconciliation: when route params disagree with machine context, the ScopeResolver returns the AUTHORITATIVE scope (machine context wins for hot transitions; URL params are honored for cold deep-links if the user has access). The discrepancy is emitted as a `scope_reconciled` FlowEvent for observability.

### 2. Propagation mechanism — Option D (Remix, recommended)

```ts
// app/root.tsx — loader runs server-side on every navigation
export async function loader({ request }: LoaderFunctionArgs) {
  const projection = await uiStateClient(request).getProjection("login-and-org-setup");
  return json({
    active_scope: projection.active_scope,
    user: projection.context.user,
  });
}

// app/lib/useScope.ts — typed accessor
import { useRouteLoaderData } from "@remix-run/react";
import type { ActiveScope } from "@dashboard-chat/ui-state-client";

export function useScope(): ActiveScope {
  const data = useRouteLoaderData<{ active_scope: ActiveScope }>("root");
  if (!data) throw new Error("useScope() must be called within the root route — wrap your tree in <Outlet />");
  return data.active_scope;
}

// app/routes/org.$org.project.$project.tsx — nested loader augments + reconciles
export async function loader({ params, request }: LoaderFunctionArgs) {
  const projection = await uiStateClient(request).getProjection("project-session-mgmt", {
    intent_org_id: params.org,
    intent_project_id: params.project,
  });
  // If the ScopeResolver reconciled (URL disagreed with machine context), it emitted a
  // scope_reconciled FlowEvent; the FE simply renders the authoritative scope.
  return json({
    project: projection.context.project,
    active_scope: projection.active_scope,
  });
}

// Any component:
function ChatView() {
  const scope = useScope();          // authoritative, single-source, server-resolved
  // …
}
```

ESLint rule (`eslint-plugin-dashboard-chat-ui-state`, custom):
- Forbid `useParams<"orgId" | "projectId" | "datasetId" | "viewId" | "reportId">()` reads outside route-loader scope.
- Forbid direct `useAuth()`-style reads of identity fields once the migration is complete; suggest `useScope()` instead.

### 3. Propagation mechanism — Option B (BFF + SPA, fallback)

```tsx
// reverse-proxy/src/scope/ScopeProvider.tsx
export function ScopeProvider({ children }: { children: React.ReactNode }) {
  const flowId = useCurrentFlowId(); // derived from route via a thin adapter
  const { data, isLoading } = useFlowProjection(flowId); // TanStack Query under the hood
  if (isLoading) return <LoadingScopeSplash />;
  return <ScopeContext.Provider value={data.active_scope}>{children}</ScopeContext.Provider>;
}

export function useScope(): ActiveScope {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error("useScope() must be used inside ScopeProvider");
  return ctx;
}
```

The contract is identical — only the propagation primitive changes (Context vs loader data). Both versions read from the same projection endpoint.

### 4. Agent integration contract (resolves OQ-8 + ties to Round-2 D8)

Every chat agent invocation carries `active_scope.org_id` + `active_scope.project_id` (and optionally `active_scope.resource_id[]`) in the request envelope. The contract:

```ts
// agent/lib/chat/handleChat.ts — middleware (additive; no architectural change to the agent's chat-brain role)
const scope = extractScopeFromHeaders(c.req); // injected by auth-proxy; sourced from active_scope by the FE/harness
if (!scope?.org_id || !scope?.project_id) {
  return c.json({ error: "agent invocation missing scope: missing org_id or project_id" }, 400);
}
// The agent does not derive scope. It receives it. (D8.)
```

The auth-proxy is the injection site. The FE (Remix loader, Option D) or the TS harness (Option B + D) sets the scope header on the request to the agent; auth-proxy forwards it; the agent reads it from `c.req.header("X-Active-Scope")` (JSON-encoded). Header schema:

```
X-Active-Scope: {"org_id":"org-...","project_id":"proj-...","resource_type":null,"resource_id":null}
```

(Implementation detail: the header is set by Remix's loader on outgoing fetch calls via a shared `uiStateClient(request)` helper; it is NOT set by FE components individually.)

### 5. TS harness integration contract

```ts
// tests/acceptance/<feature>/harness/UserFlowHarness.ts
class UserFlowHarness {
  async assert_scope(expected: Partial<ActiveScope>): Promise<void> {
    const projection = await this.fetchProjection();
    const actual = projection.active_scope;
    const mismatches = diffScope(expected, actual);
    if (mismatches.length > 0) {
      throw new ScopeMismatchError(formatNamedColumnDiff(mismatches));
    }
  }
}
```

`diffScope` returns named-column diffs:

```
scope mismatch:
  org_id      expected: org-acme-data-abc123   actual: org-other-xyz789
  project_id  expected: proj-q4-analytics      actual: (null)
```

This formatter is the same shape as `DatasetLayerHarness.assert_exactly_once_via_replay`'s transform-log diff (per US-004 Technical Notes).

### 6. Multi-tenant invariant — enforced at three layers

Per principle 11, scope-related rules are enforced via three semantically orthogonal layers:

| Layer | Tool | Rule |
|---|---|---|
| Compile-time | TypeScript `strict` | `ActiveScope` is the only typed surface; any read of `org_id`/`project_id`/etc. from a different shape requires explicit narrowing. |
| Runtime contract | ScopeResolver invariants 1–5 above | Every projection request validates scope vs JWT; mismatches return 403 + structured diagnostic. |
| Behavioral | Acceptance test (`tests/acceptance/user-flow-state-machines/test_scope_invariants.py`) | Asserts cross-tenant write returns 403 + named diagnostic; asserts stale-link reconciliation emits `scope_reconciled` event. |

## Consequences

### Positive

- The ChatView project-context race is impossible by construction (Option D) or constrained to one provider (Option B). Drift is reduced from the previous "every component re-derives" model to "one resolver, one read site."
- Multi-tenant invariants are enforced uniformly (every request passes through the ScopeResolver).
- The TS harness has a first-class assertion surface (`assert_scope({...})`) that reads from the same SSOT as the FE.
- The agent integration is mechanical: the auth-proxy injects the scope header; the agent reads it; no derivation in the agent (honors D8).
- A new flow's scope handling is "implement ScopeResolver invariant for the new resource type" — one place, not N.

### Negative / accepted trade-offs

- Every component that previously read `useParams("projectId")` must migrate to `useScope().project_id`. Mitigation: ESLint rule + sequenced strangler-fig migration (covered in `handoff-design-to-distill.md`).
- The ScopeResolver becomes a hot-path concern: every projection request invokes it. Mitigation: the resolver is a pure function over already-loaded state; no DB round-trip; budget p95 ≤ 5ms.
- An additional header (`X-Active-Scope`) on every outgoing request to the agent grows request size by ~200 bytes. Negligible; in line with existing identity headers.

## Open questions

1. **Should `active_scope` allow multiple `resource_id`s simultaneously?** Today's user model has one active resource at a time. Future: chat might select multiple datasets. PR-0 ships single `resource_id`; multi-resource is a schema extension (`resource_ids?: string[]`) deferred until a consumer asks. Not load-bearing for US-001 through US-005.

2. **Should `active_scope.resource_type` include `transform`?** Transforms are scoped to a dataset (so `resource_type: "dataset"` covers it). The transform-level context is a function of `(dataset_id, transform_id)`, not a new resource type. Decision: NO new type.

3. **`scope_reconciled` event consumers**. The event is emitted whenever stale-link reconciliation kicks in. Today: observability only. Future: a UI toast ("we redirected you because the link pointed at a project you've since left"). Out of scope for PR-0.

## References

- DISCUSS Round-2 D9: `docs/feature/user-flow-state-machines/discuss/wave-decisions.md`
- Shared artifacts (`active_scope` HIGH-risk entry): `docs/feature/user-flow-state-machines/discuss/shared-artifacts-registry.md`
- ADR-027 (host + framework), ADR-028 (XState v5)
- Sibling pattern (ADR-014's stratification): `docs/decisions/adr-014-chatevent-vocabulary-stratification.md`
