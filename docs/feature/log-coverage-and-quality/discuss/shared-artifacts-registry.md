# Shared Artifacts Registry — log-coverage-and-quality

Every artifact passed between journey steps (and across services), with its
**single** source of truth. The governing rule: **the structured `LogRecord`
stream is the only diagnosis surface, one correlation id is minted once at ingress,
and credentials are never an artifact that enters a log.**

| Artifact (`${...}`) | Single source of truth | Owner / writer | Derived? | Consumers | Notes |
|---|---|---|---|---|---|
| `${log_record}` | the ECS/OTel `LogRecord` envelope defined in `ui/app/lib/log.ts` | each service's `createLogger(channel)` (Node) / `dictConfig` JSON formatter (Python) | No | operators, log sink (future) | Fields: `@timestamp`, `log.level`, `event.module`, `event.action`, `attributes`. Same field names in both stacks. |
| `${correlation_id}` | minted at auth-proxy ingress (generalize `app.ts:958`) if absent on `x-request-id`/`x-correlation-id` | auth-proxy ingress | No | every downstream service's request-context binding; every log line; error responses | Minted **once**; only ever read/propagated downstream. Bound via `AsyncLocalStorage` (Node) / `contextvars` (Python). |
| `${tenant_context}` | the authenticated identity + resource ids in scope | each service's request-context binding | No | every log line where in scope | `org_id` / `user_id` / `principal_id` + `project_id` / `dataset_id` / `session_id` / `thread_id` / `flow_id`. Attributes-only — never the credential that proved identity. |
| `${log_level}` | `LOG_LEVEL` env var, per service | each service's logger config | No | the logger instance | Fixes ui/ SSR where `configuredLevel()` reads only `localStorage`. Default INFO. |
| `${event_action_keys}` | the documented dotted-key namespace (conventions in `wave-decisions.md`) | this feature; chat keys co-owned with `shared/chat` | No | every `.info/.debug/.warn/.error(action, …)` call | Stable, greppable keys (e.g. `auth.jwt.rejected`, `chat.turn.start`). Chat keys align across `agent` (producer) and `ui` (consumer). |
| `${redaction_ruleset}` | the sensitive-key list applied in each serializer | the shared logger module (born in Slice 01) | No | every logger's emit path | `authorization`, `cookie`, `*token*`, `*secret*`, `password`, raw `email`. One rule list, reused per stack. |
| `${kpi_event_line}` | existing auth-proxy KPI JSON lines (`app.ts:838-848`) | auth-proxy (unchanged) | No (pre-existing) | existing scrapers | **Preserved**, not replaced — the new logger coexists (US-2 AC2.4). |
| `${startup_identity_line}` | `log_image_identity(...)` startup line (per `docs/evolution/2026-05-04-log-image-identity-on-startup.md`) | each service at startup | No (pre-existing) | ops | Preserved; not migrated into the structured logger. |

## Single-source check

- ✅ The correlation id has exactly one writer (auth-proxy ingress); everyone else reads it.
- ✅ The envelope has one definition (`ui/app/lib/log.ts`), generalized — not re-invented per service.
- ✅ Credentials are never an artifact — redaction is applied in the one place every line passes through (the serializer).
- ✅ Pre-existing log conventions (KPI lines, startup identity) have a single, unchanged source and are explicitly preserved.

## Cross-service hand-offs

- **auth-proxy → backend/agent/ui-state:** `${correlation_id}` rides the upstream
  hop header; each downstream service binds it into its request context.
- **agent ↔ ui (chat):** `${event_action_keys}` for chat are co-owned via
  `shared/chat` so a turn reads coherently from both the producer and consumer side.
- **ui (browser) → ui (SSR) → backend:** `${correlation_id}` is injected on the
  `/bff/*` and `/api/*` hops (`proxy-fetch.ts`) so a browser-originated action is
  traceable from the first server hop.
