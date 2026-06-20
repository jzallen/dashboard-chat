# Slice 03 — backend request lifecycle + DomainException + LOG_LEVEL

**Story:** US-4 · **Sub-job:** SJ-4 · **Surface:** backend · **Effort:** ~1 day (may split — see below)

## Goal (one sentence)
Make the backend log its request lifecycle and every access-denying domain decision with tenant context, under runtime `LOG_LEVEL` control — so denied requests are auditable instead of vanishing into a silent HTTP mapping.

## IN scope
- Central logging config via `logging.config.dictConfig` with a JSON formatter emitting the `LogRecord` field names; `LOG_LEVEL` env-driven (default INFO).
- Request middleware logging method, path, status, latency, and tenant context (`org_id`/`user_id`/`correlation_id`).
- Log DomainException outcomes (INFO for normal business outcomes, WARN for authorization denials) instead of the silent map at `main.py:151-161`.
- Enrich `@handle_returns` exception logs (`use_cases/__init__.py:19`) with tenant context.
- Convert stray `print()` (e.g. `repositories/lake/bucket_cors.py:72`) to logging.

## OUT scope
- Per-repository/per-query DEBUG logging of every DB op (nice-to-have; not required for the denial-audit value).
- Alembic log-config unification (small follow-up).
- Correlation-id binding mechanism itself (Slice 02 provides it; this slice consumes it).

## Learning hypothesis
**Disproves** that DomainException outcomes can be logged centrally **without** turning routine 404s (ProjectNotFound on a normal miss) into ERROR-level noise. If a clean INFO-business / WARN-authz split can't be drawn at the handler, the level taxonomy needs refining before backend logging expands.
**Confirms** (if it succeeds) that the backend can be observable without becoming noisy.

## Acceptance criteria
- AC1: A request middleware logs method, path, status, latency, and tenant context per request.
- AC2: A denied request logs the DomainException outcome (WARN for authz) naming the resource; a normal business 404 logs at INFO, not ERROR.
- AC3: `@handle_returns` exception logs include `org_id`/`user_id`/`correlation_id`, not just `func.__name__`.
- AC4: `LOG_LEVEL=debug` produces DEBUG lines; unset defaults to INFO. No `print()` remains on the catalogued path.

## Dependencies
BlockedBy Slice 02 for full trace value (lines should carry the correlation id). Independent of agent/ui-state/ui.

## Split plan (if >1 day)
- **3a:** request middleware + `dictConfig`/`LOG_LEVEL` + `print()` cleanup.
- **3b:** DomainException-outcome logging + `@handle_returns` tenant-context enrichment.

## Reference class
FastAPI middleware + `dictConfig` JSON logging is standard; the repo already has a `_auth_user` ContextVar and an `@handle_returns` choke point, so tenant context has a single natural injection site.
