# JTBD Job Stories — log-coverage-and-quality

**Wave:** DISCUSS · **Mode:** light JTBD bridge (no DIVERGE) · **Area:** cross-cutting (infra/observability)

This is a *bridge*, not a full ODI study. The job was articulated directly by the
DC-103 brief ("track down a bug and find silence in the logs … or nothing but
noise") and is grounded by a per-service audit with `file:line` evidence (see the
per-surface findings below and in `wave-decisions.md`). A full DIVERGE Phase-1
study (real-user interviews, measured satisfaction) was not run because the job is
a cross-cutting quality sweep with a single well-evidenced need, not a contested
product opportunity. It lands as **JOB-004** in `docs/product/jobs.yaml`.

---

## Primary job (JOB-004)

> **When** something goes wrong (or I need to prove something went right) anywhere
> across the five runtime surfaces — agent, auth-proxy, backend, ui, ui-state —
> **I want** every critical path to emit consistent, structured, correlatable
> INFO/DEBUG/WARN/ERROR logs that share one envelope and one request-spanning
> correlation id, **so I can** follow a single user action end-to-end and read the
> reason for every auth and business decision — instead of finding silence on the
> failure path or noise with no context.

### Three dimensions

| Dimension | Content |
|---|---|
| **Functional** | Every critical path emits an INFO entry/exit marker + DEBUG detail; every failure logs a reason with context; one correlation id is minted at ingress and propagated through every hop; tenant context (`org_id`/`user_id`/`principal_id`) is attached; `LOG_LEVEL` controls verbosity at runtime; no secret/PII ever serialized. |
| **Emotional** | Confidence under pressure. When a user reports a failure, learn *within minutes* which hop failed and why by grepping one id — never spelunk four services' stdout in parallel only to find the one decision that mattered was never logged. |
| **Social** | The logs should *read* like an audit trail an on-call engineer or security reviewer already trusts: stable dotted event keys, tenant context, zero secrets — not ad-hoc `console.log`/`print()` debris that proves the author was debugging rather than that the system is observable. |

---

## The anchor (carry through every artifact)

`ui/app/lib/log.ts` **already defines** the canonical envelope: a `createLogger(channel)`
factory projecting each event onto an ECS/OTel `LogRecord`
(`@timestamp`, `log.level`, `event.module`, `event.action`, `attributes`), with an
opt-in one-line JSON reporter. This feature **standardizes the other four surfaces
on that same envelope** rather than inventing one. The envelope is not a new
abstraction to design — it is an existing one to lift.

---

## Sub-jobs (the job decomposed — these become the journey steps and stories)

| # | Sub-job (job-story form) | Feeds story | Primary surface |
|---|---|---|---|
| SJ-1 | When a request fails somewhere in the stack, I want to follow one correlation id across every service it touched, so I can localize the failing hop without reconstructing the path by hand. | US-1 | cross-cutting (mint at auth-proxy) |
| SJ-2 | When an authentication/authorization decision is made, I want its outcome and reason logged with the principal (never the credential), so I can audit access and diagnose rejections. | US-2 | auth-proxy |
| SJ-3 | When a chat turn runs, I want INFO markers at its boundaries (and DEBUG for tool/model detail), so I can confirm the happy path executed correctly without a debugger. | US-3 | agent |
| SJ-4 | When a backend request runs or a domain decision denies access, I want the request lifecycle and the denial reason logged with tenant context, so access denials are auditable instead of silent HTTP mappings. | US-4 | backend |
| SJ-5 | When a best-effort operation fails (Redis write, persistence, SSE), I want it logged at WARN/ERROR with context, so degraded behavior is never invisible. | US-5 | ui-state (+ ui chat/SSE) |
| SJ-6 | When an SSR loader/action or a `/bff/*` relay fails, I want it logged server-side through the structured logger, so a failed gateway hop leaves a trace instead of vanishing. | US-6 | ui |
| SJ-7 | When logging coverage expands, I want a redaction guarantee and runtime verbosity control, so no log ever leaks a secret/PII and I can turn up detail during an incident without redeploying. | US-7 | cross-cutting |

Every story in `user-stories.md` traces to exactly one sub-job; every sub-job
traces to a surface with `file:line` audit evidence.

---

## Why these are the right jobs (evidence pointers — from the DC-103 audit)

- **SJ-1** — no correlation id spans the stack today. `ui-state` mints a
  `request_id` (`flow-router.ts`) and `auth-proxy` reads `x-request-id` for *one*
  upstream call (`app.ts:958-974`), but nothing is propagated end-to-end or emitted
  to logs across services.
- **SJ-2** — `auth-proxy` is operationally blind: JWT verify (`lib/auth.ts:117-173`),
  M2M auth + mint (`lib/m2m.ts`, `app.ts:438-479`), and PAT verify/issue/revoke
  (`lib/pat.ts`) are all silent on success *and* failure; rejections throw and map
  to HTTP with no reason logged.
- **SJ-3** — `agent` logs only on error (dataset-schema fetch `handleChat.ts:154-161`,
  thread persistence `pipeChatStream.ts:177`); `/chat` entry/exit, SSE turn
  boundaries, Groq calls, and tool dispatch are silent.
- **SJ-4** — `backend` maps DomainExceptions to HTTP with no log (`main.py:151-161`),
  the auth middleware sets `AuthUser` silently (`auth/middleware.py`), and there is
  no request middleware; `@handle_returns` logs exceptions without tenant context
  (`use_cases/__init__.py:19`).
- **SJ-5** — `ui-state` Redis ops are silent (`lib/persistence/redis.ts`) and
  best-effort `catch` blocks swallow errors (state bookkeeping ~line 648, persist
  ~line 221); SSE errors are sent to the client but not logged server-side
  (`router.ts:904-905`). `ui` `Chat.tsx` (~line 152) and `chat-stream.ts` swallow
  fetch/stream errors.
- **SJ-6** — `ui` `/bff/chat` and `/bff/health` relays log nothing
  (`routes/bff-chat.tsx`, `routes/bff-health.tsx`); `entry.server.tsx:49` uses a
  bare `console.error` outside the structured logger.
- **SJ-7** — no secret leakage exists today (verified across all surfaces), but the
  pattern is fragile and there is **no** `LOG_LEVEL` runtime control on the servers
  (`ui/`'s `configuredLevel()` reads only `localStorage`, unavailable in SSR).

See `jtbd-four-forces.md` for the adoption-forces analysis.
