# User Stories — log-coverage-and-quality

**Wave:** DISCUSS · **Area:** cross-cutting (infra/observability) · **Job:** JOB-004 (`docs/product/jobs.yaml`)
**Source:** DC-103 · **Anchor:** `ui/app/lib/log.ts` (ECS/OTel `LogRecord` envelope to standardize on)

Each story is a LeanUX story tracing to one sub-job (`jtbd-job-stories.md`) and
one primary surface. The "users" are operators, developers, and security
reviewers; Elevator-Pitch "After" lines reference a real operator-invocable action
(an HTTP response field, a `grep`, an env var, a service log) rather than an
internal function. Requirements completeness and DoR are tracked in
`dor-validation.md`.

---

## US-1 — Trace one request end-to-end

**As** an on-call engineer diagnosing a user-reported failure,
**I want** to follow a single correlation id across every service the request touched,
**so that** I can localize the failing hop in minutes instead of reconstructing the path by hand.

Traces to: **SJ-1** · JOB-004 **O1** · Slice **02**

### Elevator Pitch
Before: a failed request leaves no shared id; the operator greps four services' stdout separately and the trail breaks at the first hop that didn't propagate `x-request-id`.
After: copy `correlation_id` from the error response, then run `grep <id>` across each service's logs → sees every line for that request — auth-proxy, backend/agent, ui-state — carrying the same `correlation_id`.
Decision enabled: the operator decides which hop to open first, because the trace points straight at the failing service.

### Acceptance criteria
- AC1.1: A correlation id is minted at the auth-proxy ingress when absent (from `x-request-id`/`x-correlation-id`), and reused when present (never re-minted downstream).
- AC1.2: The id is propagated on every upstream hop and bound per-request (`AsyncLocalStorage` in Node, `contextvars` in Python) so it appears on log lines emitted deep in a use case without being threaded through signatures.
- AC1.3: Every error HTTP response carries the `correlation_id` (header and/or body).
- AC1.4: For a request that traverses ≥2 services, all emitted log lines for that request share one `correlation_id` (proven by an integration assertion).

---

## US-2 — Audit every auth decision

**As** a security reviewer (and an on-call engineer),
**I want** every authentication/authorization decision in auth-proxy logged with its outcome, reason, and principal — never the credential,
**so that** I can audit access and diagnose rejections without the token ever touching a log.

Traces to: **SJ-2** · JOB-004 **O2** · Slice **01**

### Elevator Pitch
Before: auth-proxy rejects a JWT/PAT/bad client credential silently — it throws and maps to an HTTP status with no logged reason (`lib/auth.ts:117-173`, `lib/m2m.ts`), so a rejection is undiagnosable.
After: trigger a rejected token, then read the auth-proxy logs → sees a WARN `auth.<kind>.rejected` line naming the reason and the `principal_id`/`client_id`, with no token/secret in the line; a successful verify logs INFO, and PAT/M2M issue+revoke log audit lines.
Decision enabled: the reviewer decides whether a rejection was a misconfigured client, an expired token, or an attack — and confirms no credential leaked.

### Acceptance criteria
- AC2.1: JWT/PAT/M2M verification logs INFO on success and WARN-with-reason on every rejection, including `principal_id`/`client_id`.
- AC2.2: M2M token mint and PAT issue + revoke each emit an audit log line (who/what/when).
- AC2.3: No log line emitted by auth-proxy contains a token, cookie, client secret, or `Authorization`/`X-New-Access-Token` value (asserted by the redaction regression test, US-7).
- AC2.4: Existing KPI-event JSON lines (`app.ts:838-848`) and the startup image-identity line remain unchanged.

---

## US-3 — Confirm the chat happy path

**As** a developer (or on-call engineer) verifying the agent,
**I want** INFO markers at chat-turn boundaries plus DEBUG for tool/model detail,
**so that** I can confirm a turn executed correctly without attaching a debugger.

Traces to: **SJ-3** · JOB-004 **O4** · Slice **04**

### Elevator Pitch
Before: the agent logs only on error; `POST /chat` entry/exit, SSE turn boundaries, the Groq call, and tool dispatch are silent (`handleChat.ts`, `pipeChatStream.ts`), so a "successful but wrong" turn is invisible.
After: send a chat message and read the agent logs → sees an INFO `chat.turn.start` and an INFO `chat.turn.ok` (with scope/`session_id`/`thread_id`), and at DEBUG the tool-dispatch names and the model finish reason.
Decision enabled: the developer decides the turn behaved correctly (right tools, clean finish) — or sees exactly which sub-step diverged.

### Acceptance criteria
- AC3.1: `POST /chat` logs an INFO entry (scope, context type, identifiers) and an INFO completion marker with the finish reason.
- AC3.2: Tool dispatch logs each tool name/outcome at DEBUG; failures log WARN/ERROR with context (not just an emitted ChatEvent).
- AC3.3: Every agent log line carries the request correlation id (US-1) and tenant context where in scope (`org_id`/`project_id`).
- AC3.4: Chat `event.action` keys align with the consumer side (`ui`) via `shared/chat` so a turn reads coherently across both.

---

## US-4 — See denied access and the request lifecycle (backend)

**As** an on-call engineer or developer,
**I want** the backend request lifecycle and every access-denying domain decision logged with tenant context,
**so that** access denials are auditable instead of disappearing into a silent HTTP mapping.

Traces to: **SJ-4** · JOB-004 **O1, O3** · Slice **03**

### Elevator Pitch
Before: the backend maps DomainExceptions (ProjectNotFound, AuthorizationError, …) straight to HTTP with no log (`main.py:151-161`), sets the auth user silently (`auth/middleware.py`), and has no request middleware — so a denied request leaves no trace and `@handle_returns` logs exceptions without `org_id`/`user_id` (`use_cases/__init__.py:19`).
After: make a request that is denied, then read the backend logs → sees a request-lifecycle line (method, path, status, latency, `org_id`, `user_id`, `correlation_id`) and a WARN/INFO line recording the DomainException outcome and which resource was denied.
Decision enabled: the engineer decides whether the denial was correct authz or a bug, scoped to the right tenant.

### Acceptance criteria
- AC4.1: A request middleware logs method, path, status, latency, and tenant context (`org_id`/`user_id`/`correlation_id`) for each request.
- AC4.2: DomainException outcomes are logged (INFO for normal business outcomes, WARN for authorization denials) instead of silently mapped to HTTP.
- AC4.3: `@handle_returns` exception logs include tenant context, not just `func.__name__`.
- AC4.4: `LOG_LEVEL` controls verbosity via `logging.config.dictConfig`; default INFO; stray `print()` (e.g. `repositories/lake/bucket_cors.py:72`) is converted to logging.

---

## US-5 — No silent failures (ui-state + ui)

**As** a developer,
**I want** every best-effort/swallowed failure on a critical path logged at WARN/ERROR with context,
**so that** degraded behavior is never invisible.

Traces to: **SJ-5** · JOB-004 **O3** · Slice **05**

### Elevator Pitch
Before: ui-state Redis ops are silent (`lib/persistence/redis.ts`), best-effort `catch` blocks swallow errors (state bookkeeping ~line 648, persist ~line 221), and SSE errors are sent to the client but not logged server-side (`router.ts:904-905`); on the ui side `Chat.tsx` (~line 152) and `chat-stream.ts` swallow fetch/stream errors.
After: induce a Redis append failure (or an SSE error), then read the ui-state logs → sees a WARN/ERROR line naming the operation, the `flow_id`/`principal_id`, and the error — and a grep for empty `catch {}` on catalogued paths returns nothing.
Decision enabled: the developer decides whether a flow degraded because of Redis, persistence, or the stream — instead of guessing at a silent failure.

### Acceptance criteria
- AC5.1: Redis append/read/subscribe/touch log at DEBUG (success) and WARN/ERROR (failure) with `flow_id` and the request correlation id.
- AC5.2: Every best-effort `catch` on a catalogued critical path logs the error with context; zero empty `catch {}` remain on those paths.
- AC5.3: SSE errors are logged server-side (in addition to the client-facing error event), with the correlation id.
- AC5.4: ui-state honours `LOG_LEVEL`; the existing `request_id`/`principal_id` transition-log pattern (`flow-router.ts`) is preserved and extended, not replaced.

---

## US-6 — Surface SSR/BFF gateway failures (ui)

**As** an on-call engineer,
**I want** SSR loader/action and `/bff/*` relay failures logged server-side through the structured logger,
**so that** a failed gateway hop leaves a trace instead of vanishing.

Traces to: **SJ-6** · JOB-004 **O3** · Slice **06**

### Elevator Pitch
Before: the ui `/bff/chat` and `/bff/health` relays log nothing (`routes/bff-chat.tsx`, `routes/bff-health.tsx`), SSR loader catches are silent, and `entry.server.tsx:49` uses a bare `console.error` outside the structured logger.
After: cause a `/bff/chat` upstream 5xx, then read the SSR server logs → sees a structured `bff.chat.failed` line with the request path, upstream status, and `correlation_id`; the SSR render-error path logs through `createLogger`, not raw console.
Decision enabled: the engineer decides whether the failure was the gateway, the upstream agent, or the render — from one consistent server-side log.

### Acceptance criteria
- AC6.1: `/bff/*` relays log upstream status and failures server-side with the request path and correlation id.
- AC6.2: SSR loader/action failures log path/method/status through the structured logger.
- AC6.3: `entry.server.tsx` render errors use `createLogger(...).error(...)` instead of bare `console.error`.
- AC6.4: The ui server context honours `LOG_LEVEL` (fixing `configuredLevel()` reading only `localStorage`); no new logs reach the browser console in production.

---

## US-7 — Never leak secrets/PII, and tune verbosity at runtime

**As** a security reviewer and an on-call engineer,
**I want** a redaction guarantee plus runtime `LOG_LEVEL` control across all surfaces,
**so that** expanding logging coverage can never leak a credential, and I can raise detail during an incident without redeploying.

Traces to: **SJ-7** · JOB-004 **O5, O6** · Cross-cutting (born in Slice **01**, re-asserted by **02–06**)

### Elevator Pitch
Before: no secret leakage exists today, but the pattern is fragile and there is no centralized redaction; meanwhile the servers have no `LOG_LEVEL` (`ui/`'s `configuredLevel()` only reads `localStorage`), so raising detail means a code change + redeploy.
After: add an attribute containing a token to any log call → sees the serialized line render the value as redacted; and set `LOG_LEVEL=debug` on a service → sees DEBUG lines appear after a restart, default INFO when unset.
Decision enabled: the reviewer trusts that coverage can grow without a leak; the operator decides to raise verbosity mid-incident and revert after, with no deploy.

### Acceptance criteria
- AC7.1: A single redaction step in each logger serializer drops/masks known-sensitive keys (`authorization`, `cookie`, `*token*`, `*secret*`, `password`, raw `email`) before emit.
- AC7.2: A redaction regression test asserts sensitive keys never serialize; it ships with the first logger (Slice 01) and is re-run per surface.
- AC7.3: Every service honours `LOG_LEVEL` at runtime; default INFO.
- AC7.4: A manual scan of sample logs across all five surfaces finds no token/cookie/secret/PII.

---

## Traceability matrix

| Story | Sub-job | JOB-004 outcome | Primary surface | Slice | Operator-observable entry point |
|---|---|---|---|---|---|
| US-1 | SJ-1 | O1 | cross-cutting | 02 | `correlation_id` on error response + `grep <id>` |
| US-2 | SJ-2 | O2 | auth-proxy | 01 | auth-proxy WARN `auth.*.rejected` + audit lines |
| US-3 | SJ-3 | O4 | agent | 04 | agent INFO `chat.turn.start`/`chat.turn.ok` |
| US-4 | SJ-4 | O1, O3 | backend | 03 | backend request-lifecycle + DomainException log lines |
| US-5 | SJ-5 | O3 | ui-state (+ ui) | 05 | ui-state Redis/SSE WARN/ERROR lines; no empty catches |
| US-6 | SJ-6 | O3 | ui | 06 | SSR `bff.*.failed` structured lines |
| US-7 | SJ-7 | O5, O6 | cross-cutting | 01 (+02–06) | redacted attribute in output; `LOG_LEVEL=debug` |

The **redaction guarantee** (US-7) and the **correlation-id propagation** (US-1)
are cross-cutting: US-7's guard is born inside Slice 01 and re-asserted by every
later slice; US-1's id is consumed by US-2..US-6's log lines. Neither is a pure
`@infrastructure` slice — each ships an operator-observable change on contact.
