# Slice 01 — auth-proxy auth-decision logging + redaction guard

**Story:** US-2, US-7 · **Sub-job:** SJ-2, SJ-7 · **Surface:** auth-proxy · **Effort:** ~1 day (+ pre-slice SPIKE)

## Goal (one sentence)
Make the security-critical auth-proxy explain every authentication/authorization decision in structured logs — with a redaction guard that ensures no credential ever appears — establishing the Node logger emitting the shared `LogRecord` envelope.

## IN scope
- Introduce a Node `createLogger(channel)` emitting the `ui/` `LogRecord` envelope (Q1: pino vs lifted consola — decide in SPIKE).
- A redaction step in the serializer dropping/masking `authorization`, `cookie`, `*token*`, `*secret*`, `password`, raw `email` — with a regression test.
- INFO on success / WARN-with-reason on rejection for JWT verify (`lib/auth.ts:117-173`), M2M client auth + mint (`lib/m2m.ts`, `app.ts:438-479`), PAT verify (`lib/pat.ts`).
- Audit lines for PAT issue/revoke and M2M mint (who/what/when, `principal_id`/`client_id`).
- `LOG_LEVEL` env support for the service.

## OUT scope
- Correlation-id minting/propagation (Slice 02 — though the ingress mint *point* is identified here).
- Any other service's logging.
- WorkOS-roundtrip and org-create per-step logging beyond the existing KPI events (nice-to-have, not this slice).

## Learning hypothesis
**Disproves** that the `ui/` `LogRecord` envelope + a redaction guard can be lifted into a Node service and log **every** auth decision **without ever** serializing a credential. If the redaction test can't be made to hold while still logging useful context, the envelope/attribute design needs rework before any other service adopts it.
**Confirms** (if it succeeds) that the envelope + redaction pattern is safe to reuse on every remaining surface.

## Acceptance criteria
- AC1: JWT/PAT/M2M verification logs INFO on success and WARN-with-reason on rejection, each with `principal_id`/`client_id`.
- AC2: PAT issue+revoke and M2M mint each emit an audit log line.
- AC3: The redaction regression test passes: a log call given a token/cookie/secret/`Authorization` value renders it redacted — **production-shaped inputs**, not a toy string.
- AC4: Existing KPI-event JSON lines (`app.ts:838-848`) and the startup image-identity line are unchanged.

## Dependencies
None (foundation). Establishes the Node logger + redaction guard reused by Slices 02, 04, 05, 06; identifies the correlation-id mint point for Slice 02.

## Pre-slice SPIKE (recommended)
Decide the Node logger (Q1): **pino** (fast, JSON-native, ecosystem) vs **lifting `ui/`'s consola logger** into a shared module (one logger everywhere). Produce a thin adapter either way that emits the exact `LogRecord` field names. Confirm coexistence with the existing `process.stdout.write` KPI lines.

## Reference class
Adding a structured logger to an existing Hono service; the envelope already exists in `ui/app/lib/log.ts` as the contract to match. Redaction-list pattern is standard for auth services (the README already flags `Authorization` / `X-New-Access-Token` as bearer credentials to redact).
