# Outcome KPIs — `user-flow-state-machines`

> **Wave**: DISCUSS
> **Date**: 2026-05-11
> **Scope**: Deep-dive column (login + org setup) only. Other columns
> earn their own KPI tables in subsequent DISCUSS passes.

## Feature: user-flow-state-machines (Login + Org Setup slice)

### Objective

By the end of the slice 1-3 carpaccio, **every state transition in
the login + org-setup flow is owned by a single server-driven
machine, is visible to a TS harness via the same projection the FE
reads, and surfaces a correlation id on every recoverable failure**
— eliminating the four-place flow-state duplication the team has
been debugging for the last week.

### Outcome KPIs

| # | Who | Does What | By How Much | Baseline | Measured By | Type |
|---|-----|-----------|-------------|----------|-------------|------|
| K1 | First-time users (Maya-shaped) | Reaches the welcome page with email pre-filled at first paint | 100% at p99 (no race-condition empty header) | ~10% observe race (developer recall; uninstrumented) | FE event `welcome_page_rendered` + `email_present_at_first_paint` | Leading (outcome) |
| K2 | First-time users completing org setup | Sees the app shell with both org and user chips on first paint, no flicker | 100% at p99 | ~70-80% (estimated; uninstrumented) | FE event `app_shell_first_paint` with `org_chip_value` + `user_chip_value` != placeholder | Leading (outcome) |
| K3 | Users encountering a transient auth failure | Recovers via retry within 60 seconds without contacting support | ≥90% recovery rate; 100% of failures show a correlation id | 0% display correlation id today; recovery rate unknown | FE events `auth_recoverable_error_shown` + `auth_retry_clicked` + `ready_reached_in_same_session` | Leading (outcome) |
| K4 | Returning users with mid-session token expiries | Stays in flow without re-submitting after a transparent silent re-auth | ≥95% of expiries are recovered silently; 0 re-typed requests in instrumented sessions | Every expiry surfaces a generic network error today; user must re-submit | FE+worker events `token_expired_event` + `silent_reauth_ok` + `silent_reauth_failed` + duplicate-request detector | Leading (outcome) |
| K5 | Developers writing acceptance tests for any user-facing flow | Sets up the J-001 precondition for their test in ≤5 lines of TS code | ≥90% of new acceptance tests use the harness vs ad-hoc bypass; first-test cycle time ≤2 hours | 1 day to first passing acceptance test for a new flow today | Code-review survey + grep for legacy bypass patterns; cycle-time tracking | Leading (secondary) |

### Metric Hierarchy

- **North Star**: K2 (`app_shell_first_paint` with correct values, no
  flicker) — this is the single most user-visible proof that the
  state-machine pattern works. If K2 holds, the whole architectural
  promise is visibly delivered.
- **Leading Indicators (primary)**: K1, K3, K4 — three flow-level
  outcomes that decompose the north star into the three named states
  most-likely-to-fail (`authenticated_no_org`, `error_recoverable`,
  `expired_token`).
- **Leading Indicators (secondary)**: K5 — developer-facing leading
  indicator that predicts whether the pattern will be extended to A2-A7
  in future DISCUSS passes (if K5 is bad, no one will write tests for
  flows 2-7 even after they have machines).
- **Guardrail Metrics** (must NOT degrade):
  - **Auth-callback round-trip p95** — should not exceed the
    current ~2-second budget. The machine introduces no new
    serial round-trips.
  - **Acceptance-test suite duration** — TS harness adoption
    should not double suite time. Per-test budget remains the
    current ~5 seconds for J-001 setup.
  - **Auth failure rate (any cause)** — must remain at or
    below today's level. The machine reshapes failure handling;
    it does not introduce new failure modes.

### Measurement Plan

| KPI | Data Source | Collection Method | Frequency | Owner |
|-----|-------------|-------------------|-----------|-------|
| K1 | FE telemetry on welcome page mount | Emit `welcome_page_rendered` event with `email_present_at_first_paint` boolean | Per page load | platform-architect (DEVOPS) |
| K2 | FE telemetry on shell mount | Emit `app_shell_first_paint` event with `org_chip_value` + `user_chip_value` + `flicker_observed` boolean | Per session | platform-architect |
| K3 | FE telemetry on `error_recoverable` state entry + exit | Emit `auth_recoverable_error_shown` (with `underlying_cause_tag` + `correlation_id`) and `auth_retry_clicked` and `ready_reached`; correlate by session | Per error event | platform-architect |
| K4 | FE + worker telemetry on `expired_token` state | Emit `token_expired_event` (FE) + `silent_reauth_ok/failed` (auth-proxy) + `request_replayed` (worker); correlate by `correlation_id_of_original_request` | Per expiry event | platform-architect |
| K5 | Repo-level survey | Quarterly grep for `dev-token-static` (legacy bypass) under `tests/acceptance/**/`; manual cycle-time tracking in feature retros | Quarterly | solution-architect (DESIGN) + product-owner (this role) |

### Hypothesis

We believe that **owning login + org-setup flow state on the server
and projecting it to the FE + TS harness** for
**first-time and returning Dashboard Chat users** will achieve
**100% first-paint identity consistency and ≥95% silent
recovery from transient auth failures**.

We will know this is true when:

* **K2** holds at p99 (100% of new users see both chips correctly on
  first paint of the app shell) — proves the projection-not-derivation
  story.
* **K3** holds at ≥90% recovery + 100% correlation id display —
  proves the failure-handling story.
* **K5** climbs to ≥90% harness adoption within one quarter of
  framework GA — proves the pattern is extensible to A2-A7.

### Handoff to DEVOPS (platform-architect)

To plan instrumentation:

1. **Events to instrument** (FE):
   - `welcome_page_rendered { email_present_at_first_paint: boolean, time_to_email_visible_ms: number, correlation_id: string }`
   - `app_shell_first_paint { org_chip_value: string, user_chip_value: string, flicker_observed: boolean }`
   - `auth_recoverable_error_shown { underlying_cause_tag: string, correlation_id: string }`
   - `auth_retry_clicked { correlation_id: string }`
   - `ready_reached { correlation_id: string }`
   - `token_expired_event { correlation_id_of_original_request: string }`
   - `request_replayed { correlation_id_of_original_request: string, replay_success: boolean }`

2. **Events to instrument** (auth-proxy + worker):
   - `silent_reauth_ok { correlation_id_of_original_request: string, latency_ms: number }`
   - `silent_reauth_failed { correlation_id_of_original_request: string, underlying_cause_tag: string }`

3. **Dashboards needed**:
   - **Real-time**: K3 + K4 (auth-failure recovery rate; correlation-id presence on every failure). Anomalies need same-day investigation.
   - **Weekly**: K1, K2 (north star + secondary indicators). K5 quarterly with repo survey.

4. **Alerting thresholds (guardrails)**:
   - Auth-callback round-trip p95 > 2.5s → page on-call
   - K3 recovery rate < 80% for 1 hour → page on-call
   - K2 north-star metric < 99% for 1 hour → page on-call

5. **Baseline measurement before release**:
   - K1, K2, K3 have no current instrumentation; the
     instrumentation IS the baseline-establishment effort. Land
     it BEFORE the machine framework so we have a before/after
     comparison.
   - K4: today every expiry surfaces a generic error; counting
     occurrences pre-framework will need a one-day FE
     instrumentation spike. DEVOPS to scope.
