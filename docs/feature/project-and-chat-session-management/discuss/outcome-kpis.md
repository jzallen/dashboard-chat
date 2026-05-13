# Outcome KPIs — `project-and-chat-session-management` (J-002)

> **Wave**: DISCUSS
> **Date**: 2026-05-13
> **Scope**: J-002 deep-dive only. The 6 KPIs below decompose
> J-002's user-observable outcomes; they extend (not replace) J-001's
> K1-K5 in `docs/evolution/2026-05-12-user-flow-state-machines/discuss/outcome-kpis.md`.

## Objective

By the end of the Slice 1-6 carpaccio, **every J-002-territory user
action operates inside a coherent `(active_scope.project_id,
state.session_id, active_scope.resource_*)` tuple, with the agent
receiving scope from the same projection the FE shell reads, and
mid-mutation token expiries recovered silently** — eliminating the
ChatView project-context race and the cross-tenant data-leak
surface in one pass.

## Outcome KPIs

| # | Who | Does What | By How Much | Baseline | Measured By | Type |
|---|-----|-----------|-------------|----------|-------------|------|
| K-J002-1 | Returning users with ≥1 project | Lands in their last-used project's `session_list_visible` on sign-in | 100% reach the state with project chip and session list painted together at p99; first-paint latency ≤800ms (p95) | ~70% (developer recall; users manually navigate today) | FE event `j002_initial_project_resolved { project_id, latency_ms, degraded: boolean }` | Leading (outcome) |
| K-J002-2 | Users with cold deep-links | Sees the project chip + body painted together with the right project at <300ms (p95) OR a named-diagnostic panel within 300ms | 100% valid deep-links resolve in <300ms; 100% invalid deep-links surface the named-diagnostic panel | ~10% of stale links land on a blank page (uninstrumented) | FE event `j002_deep_link_resolved { project_id, latency_ms, outcome }` | Leading (outcome) |
| K-J002-3 | Returning users resuming a session with a previously-attached dataset | Sees the transcript AND the dataset chip on first paint; types a follow-up without re-attaching | ≥95% paint correctly at p95; zero re-attachments observed in instrumented sessions (when the dataset still exists) | 100% of resumes lose dataset context today (unimplemented) | FE event `session_resume_completed { session_id, dataset_present, latency_ms }` | Leading (outcome) |
| K-J002-4 | Users switching projects within their org | Sees chip + session list paint together within 300ms; zero observed chat-turns landing at the agent under the wrong project | 100% atomic at p99; cross-project chat-turn rate at 0 (any violation = bug, not metric) | ~10-20% of switches observe flicker (developer recall); cross-project chat-turn rate is uninstrumented but known to occur | FE event `j002_project_switch_completed { old_project_id, new_project_id, latency_ms, in_flight_turn_cancelled }`; acceptance test asserts no agent log shows mismatched (project_id, session_id) | Leading (outcome) — **NORTH STAR** |
| K-J002-5 | All chat-turns originating in any J-002 state | Carries `X-Active-Scope` from J-002's projection; missing-scope rejected with 400 | 100% at p99; 0 successful cross-tenant turns at p100; `scope_header_fallback_used` events trend to zero within one release | 0% scope-validated today (`agent/lib/chat/handleChat.ts:75` reads `project_id` from body unconditionally) | FE event `j002_chat_turn_dispatched { has_scope_header, org_id_in_header, project_id_in_header }`; agent event `chat_turn_rejected_missing_scope`; agent log event `scope_header_fallback_used` | Leading (outcome) — guardrail |
| K-J002-6 | Users mid-J-002-mutation when JWT expires | Stays in flow; mutation pauses and replays after silent re-auth; zero re-clicks | ≥95% of expiries recovered silently (composes with J-001 K4); 0 re-clicks in instrumented sessions | 0% today (no J-002 machine exists; mid-task expiry surfaces as generic error) | UI-state events `j002_frozen { last_live_state }`, `j002_thawed { replayed_intents_count, stale_intents_dropped_count }` | Leading (outcome) |

## Metric Hierarchy

* **North Star**: **K-J002-4** (atomic project switching with zero
  cross-project chat-turns). This is the single most user-visible
  proof that the ChatView project-context race is mechanically
  retired AND the cross-tenant data-leak surface is closed.
  Atomic switching is the user-experience headline; zero
  cross-project turns is the security headline.
* **Leading indicators (primary)**: K-J002-1, K-J002-2, K-J002-3 —
  three flow-level outcomes that decompose the user's daily entry
  paths into the product (last-used resume, deep-link, session
  resume).
* **Leading indicator (guardrail)**: K-J002-5 — agent contract
  enforcement. A regression here would re-open the cross-tenant
  surface; this is paged-on.
* **Leading indicator (cross-cutting)**: K-J002-6 — FREEZE/THAW
  participation. This proves the substrate amortizes; if J-002
  fails to participate cleanly, ADR-028's payoff is overstated.

## Guardrail metrics (must NOT degrade)

* **App-shell first-paint latency** — extends J-001's K2 guardrail
  to cover the project chip; first-paint must stay ≤1s at p95
  across J-001 + J-002 combined.
* **Backend `list_sessions` round-trip p95** — must not exceed
  current ~150ms. J-002's projection caches the first page; if
  the underlying query degrades, the cache stays warm but the
  cross-tab refresh slows.
* **Agent SSE stream cancellation rate** — J-002's project-switch
  cancels in-flight streams; if the cancellation rate exceeds 5%
  of chat-turns in steady-state (i.e., users are switching
  projects mid-turn frequently), the UX is wrong and needs a
  "complete the turn before switching" prompt.

## Measurement Plan

| KPI | Data Source | Collection Method | Frequency | Owner |
|-----|-------------|-------------------|-----------|-------|
| K-J002-1 | FE telemetry on app-shell mount + project-chip first-paint | Emit `j002_initial_project_resolved` event with project_id + latency_ms + degraded boolean | Per sign-in | platform-architect (DEVOPS) |
| K-J002-2 | FE telemetry on cold deep-link route mount | Emit `j002_deep_link_resolved` event with outcome ∈ {happy, cross_tenant, project_not_found, access_revoked} | Per deep-link load | platform-architect |
| K-J002-3 | FE telemetry on session resume | Emit `session_resume_completed` event with dataset_present + latency_ms; emit `session_dataset_unavailable` on degraded path | Per resume | platform-architect |
| K-J002-4 | FE + agent telemetry on project switch | FE: emit `j002_project_switch_completed`; agent: acceptance test asserts request log carries no mismatched (project_id, session_id) | Per switch | platform-architect + solution-architect |
| K-J002-5 | Agent + FE telemetry | FE: emit `j002_chat_turn_dispatched` per turn; agent: emit `chat_turn_rejected_missing_scope` + `scope_header_fallback_used` | Per chat turn | platform-architect |
| K-J002-6 | UI-state + FE telemetry | Emit `j002_frozen` + `j002_thawed` events; correlate with J-001's K4 silent-re-auth metric | Per FREEZE/THAW cycle | platform-architect |

## Hypothesis

We believe that **owning project + session + dataset-context state
in the J-002 machine and propagating it via `active_scope` to the
FE shell, the agent, and the TS harness** for **returning Dashboard
Chat users** will achieve **100% atomic project switching with
zero cross-tenant chat-turn rate AND ≥95% silent recovery from
mid-mutation token expiries**.

We will know this is true when:

* **K-J002-4** holds at p99 (atomic switching) AND p100 (zero
  cross-project chat-turns) — proves the ChatView project-context
  race is mechanically retired AND the cross-tenant data-leak
  surface is closed.
* **K-J002-1 + K-J002-3** hold at ≥95% — proves the daily
  user-experience improvements are observable.
* **K-J002-6** holds at ≥95% — proves the substrate amortizes
  (ADR-028 §94 payoff is real, not promised).

## Handoff to DEVOPS (platform-architect)

To plan instrumentation:

1. **Events to instrument** (FE):
   - `j002_initial_project_resolved { project_id, latency_ms,
     degraded: boolean, source: "last_used" | "lexicographic" }`
   - `j002_deep_link_resolved { project_id, latency_ms, outcome:
     "happy" | "cross_tenant" | "project_not_found" |
     "access_revoked" }`
   - `session_resume_completed { session_id, dataset_present:
     boolean, latency_ms, transcript_message_count }`
   - `session_dataset_unavailable { session_id,
     stored_dataset_id }`
   - `j002_project_switch_completed { old_project_id,
     new_project_id, latency_ms, in_flight_turn_cancelled:
     boolean }`
   - `j002_chat_turn_dispatched { has_scope_header,
     org_id_in_header, project_id_in_header, resource_id_in_header
     }`
   - `j002_new_session_welcome_painted { project_id, latency_ms }`
   - `j002_first_message_sent_session_created { project_id,
     session_id, latency_ms }`

2. **Events to instrument** (agent):
   - `chat_turn_rejected_missing_scope { missing_field:
     "org_id" | "project_id" | "org_id_mismatch", calling_client
     }`
   - `scope_header_fallback_used { calling_client }`

3. **Events to instrument** (ui-state):
   - `j002_frozen { last_live_state, queued_intents_count,
     correlation_id }`
   - `j002_thawed { last_live_state, replayed_intents_count,
     stale_intents_dropped_count, correlation_id }`
   - `last_used_resolution_degraded { degraded_project_count }`
   - `scope_reconciled { reason }`
   - `stale_intent_dropped_after_thaw { intent_type, target_id }`

4. **Dashboards needed**:
   - **Real-time**: K-J002-4 (north star — atomic switching +
     cross-project rate) + K-J002-5 (agent scope enforcement).
     Any anomaly is a same-day investigation.
   - **Weekly**: K-J002-1, K-J002-2, K-J002-3 — daily-experience
     indicators.
   - **Quarterly**: K-J002-6 cumulative — substrate amortization
     proof.

5. **Alerting thresholds (guardrails)**:
   - Cross-project chat-turn rate > 0 → page on-call
     (single violation is a bug).
   - K-J002-5 missing-scope rejection rate > 1% for 1 hour after
     migration-window closes → page on-call.
   - K-J002-4 atomic-switching rate < 99% for 1 hour → page
     on-call.
   - `scope_header_fallback_used` rate > 0 after the
     migration-window sunset date → page on-call (R8: catches
     unmaintained legacy clients).
   - `stale_intent_dropped_after_thaw` rate > 1 per active-user
     per day in steady state → investigate (baseline: 0; healthy
     range: <1/user/day under normal token-expiry frequency).
     Rising rate indicates either a stale-filter false-positive
     bug OR a UX shape that makes users click rapidly during
     known-freeze-prone moments.

6. **Baseline measurement before release**:
   - K-J002-1 through K-J002-6 have no current instrumentation;
     the instrumentation IS the baseline-establishment effort.
     Land it BEFORE Slice 4 (the agent contract slice) so we have
     before/after comparison for the cross-tenant surface
     closure.
