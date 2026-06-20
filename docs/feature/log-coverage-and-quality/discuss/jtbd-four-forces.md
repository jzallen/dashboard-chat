# JTBD Four Forces — log-coverage-and-quality (JOB-004)

**Wave:** DISCUSS · light JTBD bridge

Forces are extracted from the DC-103 per-service audit, not from new interviews.
The "current behavior" being displaced is **error-only, unstructured, un-correlated
logging** — ad-hoc `console.*` / `print()` on four of five surfaces, with the
happy path silent and failure paths often swallowed.

| Force | Direction | Content (evidence) |
|---|---|---|
| **Push** (frustration with today) | toward the sweep | A user-reported failure can't be traced — no correlation id spans the stack. `auth-proxy` rejects tokens/credentials with **no logged reason** (`lib/auth.ts:117-173`, `lib/m2m.ts`). `backend` denies access via silent HTTP mapping (`main.py:151-161`). `ui-state` Redis ops and best-effort catches are silent (`redis.ts`, `router.ts:904-905`). The happy path is invisible everywhere but `ui/`. |
| **Pull** (attraction of the new) | toward the sweep | One envelope already proven in `ui/app/lib/log.ts` (ECS/OTel `LogRecord`), generalized to every surface; one correlation id greps the whole stack; every auth and business decision carries a reason; `LOG_LEVEL` turns up detail mid-incident without redeploy; a redaction guard makes expansion safe. Logs become an audit trail, not debug debris. |
| **Anxiety** (concern about adopting) | against | Two language stacks (Node ×4 surfaces + Python) must converge on one envelope without drift. Touching a **security-critical** service (auth-proxy) first risks introducing a credential leak if redaction isn't in place before any header/debug logging. Correlation-id binding needs `AsyncLocalStorage` (Node) / `contextvars` (Python) plumbing that touches request entry on every service. Risk of swapping "silence" for "noise" if INFO is over-used. |
| **Habit** (inertia of current behavior) | against | `console.log`/`print()` is the path of least resistance and is everywhere; developers reach for it reflexively. Existing KPI-event JSON lines (`auth-proxy app.ts:838-848`) and startup image-identity lines must be preserved, so the new logger must coexist with established stdout conventions rather than replace them wholesale. |

## Force balance & implication for slicing

Push + Pull are strong and concrete (a security-critical service that can't explain
its own rejections; failures that vanish). The dominant restraining forces are
**Anxiety about a credential leak** and **two-stack drift**. That drives two slicing
decisions:

1. **The redaction guard is born inside the first slice** (auth-proxy), not added
   later — the riskiest service gets the safety net first, with a regression test,
   before any value-add logging expands. (Mirrors how the reference feature shipped
   its renderer-completeness probe *inside* the slice that needed it.)
2. **Slice 01 (auth-proxy) doubles as the envelope-establishing slice for Node** —
   the shared logger emitting the `LogRecord` envelope is lifted from `ui/` and
   first consumed by a real, high-value critical path, so there is **no pure
   `@infrastructure` slice** and the abstraction proves itself on contact.

No opportunity-scoring table is produced here (single job). Outcome scores live on
JOB-004 in `docs/product/jobs.yaml`; the under-served outcomes (O1 score 16, O2
score 17, O3 score 13) are the ones the earliest slices target.
