# Prioritization — log-coverage-and-quality

**Ordering principle:** highest-risk / highest-value slice first (so the safety net
and the hardest-blind surface are proven earliest), then the cross-cutting enabler,
then the per-surface gap closures by descending value.

## Recommended execution order

| Order | Slice | Why this position | Reference class / risk |
|---|---|---|---|
| 1 | **01 — auth-proxy + redaction guard** | The highest-value blind spot (a security-critical service that can't explain its own rejections, JOB-004 O2 score 17) **and** the highest-risk place to add logging (credential-leak danger). Ship it first so the redaction guard is born here and reused everywhere, and the riskiest surface is de-risked before expansion. Establishes the Node logger emitting the `LogRecord` envelope. | Medium/high — touches auth code paths. Redaction regression test is the gate. **Pre-slice SPIKE recommended:** Node logger choice (pino vs lifting `ui/`'s consola module) — see Q1. |
| 2 | **02 — end-to-end correlation id** | The enabler that turns five per-service logs into one trace (JOB-004 O1 score 16). Placed second because its mint point lives in the auth-proxy ingress hardened in Slice 01, and because Slices 03–06 deliver their *full* value only once the id spans the stack. | Medium — `AsyncLocalStorage` (Node) + `contextvars` (Python) request-context binding; header propagation on every hop. `ui-state` already has a `request_id` pattern (`flow-router.ts`) to align with. |
| 3 | **03 — backend request lifecycle + DomainException + LOG_LEVEL** | Largest silent surface by code volume (~1 log per 310 LOC) and the place access denials currently vanish (`main.py:151-161`). High value; independent of agent/ui-state once the id exists. | Medium — `dictConfig` + request middleware + `@handle_returns` enrichment. **May split** if middleware + DomainException logging exceeds 1 day: 3a = request middleware + `LOG_LEVEL`; 3b = DomainException-outcome logging + `@handle_returns` tenant context. |
| 4 | **04 — agent chat-path trace** | Makes the core product flow (a chat turn) visible (JOB-004 O4). Reuses the Node logger from 01 and the id from 02; must coordinate `event.action` keys with `ui` via `shared/chat`. | Low/medium — EXTEND of an existing Hono service; main care is key alignment with the consumer side. |
| 5 | **05 — ui-state Redis/SSE + kill silent catches** | Removes the swallowed-failure blind spots (JOB-004 O3). ui-state is already the best of the Node trio (has `request_id` + `logTransition`), so this is the smallest of the backend gaps. | Low — extends an existing structured pattern; care: keep best-effort catches non-throwing while adding logs. |
| 6 | **06 — ui SSR/BFF gap closure + server LOG_LEVEL** | Closes the remaining gaps on the surface that is otherwise best-in-class. Smallest slice; mostly wiring existing `createLogger` into the relays + fixing server-side level control. | Low — `ui/` already has the logger; this is gap-filling (`bff-chat.tsx`, `bff-health.tsx`, `entry.server.tsx:49`, `configuredLevel()`). |

## Dogfood cadence

- After **01**: trigger a rejected token and read the WARN reason in auth-proxy logs; grep the logs for a token and find none (same day).
- After **02**: grep one `correlation_id` across two services and watch the path light up.
- After **03**: hit a denied endpoint and read the logged denial + request-lifecycle line, scoped to `org_id`.
- After **04**: send a chat message and read `chat.turn.start` → `chat.turn.ok`.
- After **05**: induce a Redis failure and see a WARN instead of silence.
- After **06**: cause a `/bff/chat` 5xx and read the structured SSR failure line.

## Learning-leverage note

Slice 01 carries the most risk (credential safety on a security-critical service)
and Slice 02 the most architectural uncertainty (cross-stack id binding); both are
deliberately first and Slice 01 carries a pre-slice SPIKE on the Node logger
choice. Slices 03–06 are lower-variance EXTENDs of the now-proven envelope and
can proceed without a SPIKE, though Slice 03 may split if it exceeds a day.

## Note on coverage measurement (no silent caps)

Coverage is tracked against the **critical-path catalogue** seeded by the DC-103
audit (`jtbd-job-stories.md` §evidence), not by raw log-line counts — counting
lines would reward noise. If any slice descopes a catalogued path, that omission is
logged in the slice brief, not silently dropped.
