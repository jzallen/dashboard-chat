# Outcome KPIs — log-coverage-and-quality

**Wave:** DISCUSS · **Job:** JOB-004 · Hand-off to DEVOPS (instrumentation) + DESIGN.

KPIs are framed as outcomes (JOB-004 under-served outcomes first), each with a
numeric target and a measurement method. Because this is a cross-cutting
observability feature, most targets are **coverage invariants measured against the
critical-path catalogue** (seeded by the DC-103 audit) plus a few test-enforced
guarantees — not runtime telemetry of the logs themselves.

| KPI | JOB-004 outcome | Numeric target | Measurement method |
|---|---|---|---|
| **K1 — End-to-end traceability** | O1 | 100% of multi-service requests have all their log lines sharing one `correlation_id`; the id appears on 100% of error responses | Integration assertion (Slice 02): drive a request across ≥2 services, assert one id on every line + on the error response |
| **K2 — Auth-decision coverage** | O2 | 100% of auth-proxy auth decisions (JWT/PAT/M2M) log INFO on success and WARN-with-reason on rejection; 100% of PAT/M2M issue+revoke emit an audit line | Slice-01 acceptance tests over each auth path; checklist against the auth-path inventory in the audit |
| **K3 — No silent failures** | O3 | 0 empty `catch {}` / unlogged-exception sites on catalogued critical paths (auth-proxy, ui-state, ui chat/SSE, backend DomainExceptions) | Grep + review against the catalogue (Slices 03/05/06); count must be 0 |
| **K4 — Happy-path visibility** | O4 | 100% of catalogued critical paths emit an INFO entry + completion marker | Coverage checklist against the critical-path catalogue (all slices); each path maps to a start + completion log |
| **K5 — Zero credential/PII leakage** | O5 | 0 log lines containing a token/cookie/secret/PII across all five surfaces | Redaction regression test (Slice 01, re-run per surface) + a manual sample-log scan at each slice close |
| **K6 — Runtime verbosity control** | O6 | 5/5 surfaces honour `LOG_LEVEL` at runtime; default INFO | Per-surface test: set `LOG_LEVEL=debug`, assert DEBUG lines appear; unset, assert INFO default |
| **K7 — Envelope consistency** | O1 | 5/5 surfaces emit the same `LogRecord` field set (`@timestamp`, `log.level`, `event.module`, `event.action`, `attributes`) | Schema check on a sample line from each service against the `ui/app/lib/log.ts` shape |

## Leading indicators (track during DELIVER)

- Number of surfaces emitting the shared envelope (target 5; baseline 1 = `ui/`).
- Number of catalogued critical paths with INFO entry/exit (track toward 100%).
- Count of remaining bare `console.*` / `print()` outside logger modules (track toward 0; candidate CI lint — Q4).

## Non-KPI guardrails (must-not-regress)

- Existing KPI-event JSON lines (`auth-proxy app.ts:838-848`) and startup
  image-identity lines stay intact (no scraper breakage).
- No new logs reach the **browser** console in production (ui).
- Logging stays non-blocking on hot/SSE paths — no measurable latency regression on
  chat streaming at default INFO.
- Multi-tenancy preserved: tenant context in logs is attributes only; no `org_id`
  scoping bypassed to obtain it.
