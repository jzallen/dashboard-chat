# Wave Decisions — DELIVER — `project-and-chat-session-management` (J-002)

> **Wave**: DELIVER
> **Date**: 2026-05-13
> **Owner**: software-crafter (per-MR / per-sub-step entries)
> **Status**: living document — each MR / sub-step appends here when an
> upstream-deferred choice gets resolved.
>
> DISCUSS D1–D12, DESIGN DWD-1..DWD-12, and DISTILL DD-1..DD-7 are
> inherited verbatim. DELIVER does NOT relitigate any of them.

---

## DDD-1 (sub-step 01-02) — REC-2 resolution: inline ESM template (Option B)

**Decision**: The TS UserFlowHarness `harness.j002.*` namespace is invoked
from python tests via an **inline ESM script** passed to
`node --import tsx --input-type=module -e <script>`, NOT via a separate
`tests/acceptance/user-flow-state-machines/harness_runner.ts` accepting JSON
on stdin.

The crafter chose Option B per `distill/upstream-issues.md` REC-2.

### Why (Option B over Option A)

| Criterion | Option A — `harness_runner.ts` stdin/stdout JSON | Option B — Inline ESM template (CHOSEN) |
|---|---|---|
| Mechanical fit with `driver.py:run_ts_harness` (already accepts an inline script string) | Requires a new file + new invocation contract | Drop-in — `run_ts_harness(script_inline)` matches the existing shape |
| Test discoverability (test reads end-to-end without indirection) | Reader must open `harness_runner.ts` AND the JSON spec format AND the python test | Reader sees the harness ops inline in the python test |
| Type safety at the ops boundary | Spec format is freeform JSON; would need a discriminated-union schema | TS compiler checks the ops at script-construction time (literal call sites) |
| Coupling between python suite and TS test infra | Tighter — both sides own the JSON schema | Looser — python emits an ESM string; TS owns its own surface |
| Failure surface | Errors at runner runtime (less informative) | Errors at node CLI exit with full stack trace surfaced to pytest |
| File churn | +1 new file (`harness_runner.ts`) | 0 new files |

Both options pass the DD-1 contract (subprocess invocation through node).
The compositional simplicity of Option B is decisive: the inline string IS
the contract, and the python test bodies read as plain procedure.

### How to apply

Acceptance tests construct ESM scripts as plain python strings and pass
them via `driver.run_ts_harness(script)`. The `cwd` is set to
`tests/acceptance/user-flow-state-machines/` so `import './harness/...'`
resolves correctly. Invocation: `node --import tsx --input-type=module -e <script>`.

`tsx` is a devDependency of the user-flow-state-machines suite; the
acceptance test fixture `requires_node` skips when `node` is absent. A
future addition: a `requires_tsx` fixture if the local stack drops it.

Example (US-202 harness scenario):

```python
script = (
    "import { userFlowHarness } from './harness/user-flow-harness.ts';\n"
    "const h = userFlowHarness({\n"
    "  authProxyUrl: 'http://localhost:1042',\n"
    "  fakeWorkOSUrl: 'http://localhost:14299',\n"
    "  principalId: 'dev-user-001',\n"
    "});\n"
    "await h.j002.begin('Maya Chen');\n"
    "await h.j002.assert_initial_project('Q4 Analytics');\n"
    "console.log(JSON.stringify({ok: true}));\n"
)
result = subprocess.run(
    ["node", "--import", "tsx", "--input-type=module", "-e", script],
    cwd=str(driver.repo_root / "tests" / "acceptance" / "user-flow-state-machines"),
    ...,
)
```

### Reversibility

If a future MR finds inline strings unwieldy (e.g. multi-scenario
parameterization, complex assertion narratives), an `harness_runner.ts`
can be added at any time as a peer pattern — the two are not mutually
exclusive. The DELIVER MR that introduces it would simply use it for the
new ops while preserving the existing ops in inline form.

---

## DDD-2 (sub-step 01-02) — Resolver knob: per-process `forceListSessionsFailures` set

**Decision**: The US-202 degraded-path scenario forces a `list_sessions`
failure for a specific project by passing `X-Force-List-Sessions-Failure:
<project_id>` to the `/ui-state/flow/.../begin` endpoint. The ui-state
process maintains a single per-process `Set<string>` of project ids whose
`list_sessions` calls the resolver should treat as 5xx-failed.

The set is **cleared on every `/begin`** so test scenarios don't leak
state across runs. The knob is gated by the harness-knob pattern: in
AUTH_MODE=dev (default for local compose), the knob is honored
unconditionally; in production builds the header has no effect because
auth-proxy strips identity headers but forwards all other headers, and
the resolver's `shouldFailListSessions` callback is wired ONLY to this
test-only set.

### Why (this pattern over alternatives)

| Pattern | Pros | Cons |
|---|---|---|
| **Per-process set (CHOSEN)** | Simple; matches the existing `forceCreateProjectFailureNext` pattern; no per-request state plumbing into the actor | Single-tenant only — a parallel test run across principals would collide |
| Per-request thread-local | Fully isolated | TS doesn't have ergonomic thread-locals; AsyncLocalStorage adds complexity |
| Backend-side fault injection | More realistic (real 5xx from `/api/projects/.../sessions`) | Requires a backend test endpoint or middleware; backward-couples the FE test contract to a BE test fixture |

Multi-tenant parallel testing is OUT OF SCOPE for the J-002 acceptance
suite per DD-1 (sequential pytest invocation, single principal `dev-user-001`).
If a future MR needs parallel-by-principal, the set becomes a
`Map<principal_id, Set<project_id>>`.

### How to apply

Tests pass `extra_headers={"X-Force-List-Sessions-Failure": project_id}`
to `driver.post(...)`. The header is honored by `ui-state/index.ts`'s
`/begin` route for the J-002 machine only; other machines ignore it.

---

## References

- `distill/wave-decisions.md` DD-1..DD-7 (binding)
- `distill/upstream-issues.md` REC-2 (the question this DDD-1 resolves)
- `deliver/upstream-issues.md` D-01-01a..D-01-01d (sub-step 01-01 deviations)
- DESIGN handoff §"DEVOPS handoff" / §"Endpoints to assert against"
- `tests/acceptance/user-flow-state-machines/harness/user-flow-harness.ts` (the harness file extended by 01-02)
- `tests/acceptance/project-and-chat-session-management/driver.py` `run_ts_harness` (the invocation site)
