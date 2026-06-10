# DESIGN Decisions — client-driven-onboarding

**Wave:** DESIGN (full-stack: system → domain → application, propose mode, headless)
**Date:** 2026-06-10
**Seed (fixed input):** `../design-intent.md` — user-ratified boundary assignments + ordered target flow (Phases A–D). The boundaries were NOT design options; the wave pinned the open points (a)–(f) and produced the ADRs/contracts that make the target implementable.
**Reviews:** all three passes peer-reviewed (system-designer-reviewer / ddd-architect-reviewer / solution-architect-reviewer) — APPROVED; findings addressed in-wave (see §"Review trail").

## Key Decisions

- **[D1] WorkOS write workflow moves to auth-proxy via org-create route interception** (ADR-048): auth-proxy becomes the sole WorkOS boundary and sole AUTH_MODE reader; backend loses `_create_workos_org`, its `auth_mode` read, and all `WORKOS_*` config/env. The AUTH_MODE split-brain becomes unrepresentable in compose. (see: `system-architecture.md` §1, §4)
- **[D2] Failure strategy = pre-check-then-compensate (A+B layered)** (ADR-048 §3): backend name pre-check BEFORE any WorkOS egress (a user-typo 409 can never orphan an IdP org; TOCTOU backstopped by the DB unique constraint), layered with best-effort compensation `DELETE /organizations/{id}` on failed backend persist; failed compensation emits the alertable `workos.org_compensate.fail` (the operator reconcile queue). No scheduled reconciler at ~0.001 QPS. (see: `system-architecture.md` §2)
- **[D3] Zero topology delta**: no new containers/replicas/ports; zero nginx changes (`/api/*` already routes to auth-proxy — `frontend/nginx.conf:37–42`); ui-state loses ALL network egress (the ADR-016 bypass is removed, not patched). (see: `system-architecture.md` §3, §8)
- **[D4] Client-reported outcome event model** (ADR-049, amends ADR-041): ui-state transitions only on client-reported `*_reported` outcome events; all five egress invokes (getUserOrg, createOrg, createProject, the WorkOS re-verify, project-context's resolver egress) are retired. ADR-041 superseded decision-by-decision (D1 survives; D2 survives with amended seed mechanism; D3/D6 superseded; D4 survives absolute FOR IDENTITY; D5 amended; D7 superseded in part; D8 recommend retire). (see: `domain-model.md` §1.3)
- **[D5] INV-PCO — the Presentation-Coordination-Only trust invariant** (ADR-049): ui-state state and every outcome report are trusted for presentation coordination ONLY — never an authorization input, never a resource-existence oracle, never identity (identity stays headers-only, seeded at cold-start). Enforced by construction: zero egress, no downstream reader, reissue triggers off the backend's 201, reports apply only to the reporter's own header-keyed actor. (see: `domain-model.md` §2)
- **[D6] The settled-child event-crash class dies by phase-gated vocabulary routing** (ADR-049): events have handlers only in states where the target child is provably alive; the root-level total forward (`chat-app/machine.ts:72–75` → `sendTo(active_child_id)`) and `active_child_id` itself are deleted; the wire union closes. The crash (event → stopped onboarding child → unobserved XState throw → process death) becomes unrepresentable. (see: `domain-model.md` §6)
- **[D7] The six application contracts (a)–(f) pinned** (ADR-050) — one-line each:
  - **(a) Reissue:** `applyOrgCreateReissue` gains unconditional dual emission — `Set-Cookie: auth_token` (+ `session=1`) with ui-cookie-session D1 attributes (un-parks D8) alongside the retained `X-New-Access-Token` (frontend/ + PAT stay header-based per D2/D9). Client does nothing (httpOnly); dev mode needs no special case (`DEV_NO_ORG` DB resolution).
  - **(b) Org-id carry:** trusted `X-Provisioned-Org-Id` header on the forwarded backend POST, added to the `IDENTITY_HEADERS` strip list (`auth-proxy/lib/auth.ts:68`) — strip-then-inject unforgeability; backend passes it to the repo `id=`; "WorkOS id IS the local id" preserved; dev stays backend-generated.
  - **(c) Failure paths:** backend statuses relayed verbatim; WorkOS-egress failures → one synthesized 502 envelope; cause enums `org_name_taken`/`org_name_invalid` (re-edit) vs `org_create_failed` (retryable); compensated-vs-orphaned is client-indistinguishable by design; probe-first convergence for the default project; backend `OrgCreate` gains the name validation the retired machine guard performed.
  - **(d) Mode discovery:** side-effect-free `GET /api/auth/config → {mode: "dev"|"workos"}` (`max-age=300`); `login.tsx` renders no affordance until mode is known; the dev button renders ONLY when the server says `dev`.
  - **(e) Wire vocabulary:** `ChatAppWireEvent` becomes a CLOSED union (catch-all retired; `org_form_submitted`/`create_project_submitted`/`create_project_clicked`/`switching_project_intent`/`retry_clicked` retired; `_reported` family added); router ACL compile-bound via `z.ZodType<ChatAppWireEvent>`; migration paths pinned for the shipped ui/ surfaces and per-test for `tests/acceptance/org-onboarding/`.
  - **(f) Engaged flip:** FE gate reads `regions.projectContext.state === "project_selected"` + non-null `active_scope.project_id` on the `project_created_reported` POST's OWN response document; `phase === "chat"` is routing convenience only; duplicate/stale/out-of-order reports converge per phase-gating.

## Architecture Summary

- **Pattern:** unchanged — hexagonal services behind a sole auth-proxy ingress (ADR-016 now honored by every in-network participant except the agent's documented caveat); ui-state reduced to a pure presentation-state coordinator (server-resident XState actor, ADR-044/046 transport unchanged).
- **Paradigm:** unchanged (TS services, OOP+actors per existing conventions; Python backend).
- **Key components touched:** auth-proxy (interception workflow + reissue cookie + mode discovery), backend (pure resource store; loses IdP half), ui-state (no-egress machine realignment), ui/ (new onboarding-driver owning the write choreography), shared/ui-state-wire (closed union).

## Reuse Analysis (consolidated; full tables in each pass doc)

| Existing Component | File | Overlap | Decision | Justification |
|---|---|---|---|---|
| Post-response reissue seam | `auth-proxy/app.ts:839–885`, `lib/post-response-reissue.ts` | reissue trigger/mint | EXTEND | gains Set-Cookie emission (D8 un-park); guard + mint reused verbatim |
| Catch-all proxy path | `auth-proxy/app.ts:785–826` | org-create route | EXTEND | request-side interception twin of the existing response-side seam |
| WorkOS provider module | `auth-proxy/lib/user-auth/workos.ts` | WorkOS HTTP boundary | EXTEND | org-provisioning joins the same injected-fetch boundary; no second client |
| Backend create_organization | `backend/app/use_cases/organization/create_organization.py` | org write | SHRINK | IdP half + auth_mode dispatch deleted; row+uniqueness+created_by survive |
| ChatApp parent machine | `ui-state/lib/machines/chat-app/machine.ts` | coordination | EXTEND | phase-gated routing replaces root total-forward; lifecycle/invokes/guards reused |
| Onboarding + project-context machines | `ui-state/lib/machines/{onboarding,project-context}/` | flow states | EXTEND (realign) | state-sets realigned; egress actors RETIRED with fixtures |
| `/state` transport + StateProxy | `chat-app/router.ts`, `ui/app/lib/state-proxy.ts` | wire surface | REUSE | ADR-046 surface unchanged; ACL schema swapped to closed union |
| shared/ui-state-wire | `wire-event.ts`, `state-document.ts` | wire types | EXTEND | closed union; document shape unchanged (region state strings + pruned context fields) |
| org-onboarding acceptance suite | `tests/acceptance/org-onboarding/` | scenarios | REWORK in place | scenarios survive; driver choreography changes (AR-6) |
| nginx conf | `frontend/nginx.conf` | routing | REUSE (verified) | zero changes needed |
| **NEW** `org-create-workflow.ts` | `auth-proxy/lib/` (planned) | — | CREATE NEW (justified) | no existing module owns request-side interception; keeps pre-check/provision/forward/compensate fault-injection-testable |
| **NEW** `onboarding-driver.ts` | `ui/app/` (planned) | — | CREATE NEW (justified) | the flow policy previously lived in the retired ui-state actors; no ui/ module owns onboarding choreography |

Zero unjustified CREATE NEW (reviewer-verified in all three passes).

## Technology Stack

No new technologies. Hono (auth-proxy/ui-state), XState v5, FastAPI/SQLAlchemy, React 18 + RRv7 CSR (ui/), Zod at the inbound boundary — all per existing ADRs.

## Constraints Established

- Every failure outcome must be representable as retryable — no terminal-in-practice `partial-setup` states (ADR-048 → inherited by the machine design and DISTILL scenarios).
- INV-PCO: nothing downstream may read ui-state to authorize or to assert resource existence (ADR-049).
- KPI literal compatibility: `error_recoverable` and `ready` state names are load-bearing for auth-proxy's KPI sniffer (`app.ts:710–722`) and are kept by name.
- `WORKOS_API_KEY` exists in exactly one container (auth-proxy); the `docker-compose.override.yml` api `AUTH_MODE` pin becomes obsolete and is deleted (its comment names this feature as its sunset).
- Non-idempotent WorkOS create is never auto-retried; 5s per-call timeout; 1 retry on membership/compensation only (R5).

## Upstream Changes

- **ADR-041** partially superseded (decision-by-decision map in `domain-model.md` §1.3; recorded in ADR-049).
- **ADR-016** strengthened: ui-state's documented direct-to-backend bypass is REMOVED.
- **ui-cookie-session D8** (parked reissue→Set-Cookie) is UN-PARKED and pinned by ADR-050 §a.
- **org-onboarding**: shipped surfaces stay; write path + machine events change; UI-1 (the `create_project_submitted` name-field quirk) closes structurally — the event itself retires.
- **DISCUSS-level assumption changes:** none (no DISCUSS artifacts exist; the seed is the user-ratified design-intent). No `upstream-changes.md` needed beyond the ADR supersessions recorded above.

## Decisions needing user ratification

All ADRs are **Status: Proposed** — the user ratifies. Each point below carries the architect's recommendation; full options tables in the pass docs.

**System (R1–R5 — `system-architecture.md` §10):**
- **R1** Failure/compensation strategy → **A+B layered** (pre-check + best-effort compensate). NOTE the embedded assumption: WorkOS does not enforce org-name uniqueness — validate during DELIVER; if false, compensation becomes mandatory-blocking.
- **R2** workos-mode startup probe → **soft-fail** (`health.startup.degraded`), never refuse-to-start on an IdP blip.
- **R3** Agent's independent `AUTH_MODE` read (`agent/lib/auth.ts:4`) → **leave as documented inconsistency** (ADR-016 tradition).
- **R4** Pin `WORKOS_BASE` in compose for auth-proxy → **yes** (relocated test seam replacing ui-state's `FAKE_WORKOS_URL`).
- **R5** Timeouts: 5s/WorkOS call, no auto-retry on create, 1 retry on membership/compensation → **as stated**.

**Domain (DR-1–DR-8 — `domain-model.md` §8):**
- **DR-1** In-flight-state model → **report-only (Option B)**: `creating_org`/`creating_project` etc. retire; no server-visible in-flight states.
- **DR-2** Naming family → **`*_reported`** (the INV-PCO linguistic marker).
- **DR-3** Phase-D event name → **generic `project_created_reported`** ("default" is client policy, invisible to the machine).
- **DR-4** User-profile source after the re-verify retires → **auth-proxy-verified identity headers seeded at cold-start**.
- **DR-5** Retire `session_rejected` + `user_rejected` + their guards → **yes** (only producer is gone; auth failure is auth-proxy's 401).
- **DR-6** Retire ADR-041 D8's non-security `access_token` echo → **yes** (executed by AR-7).
- **DR-7** Crash-class elimination → **phase-gated vocabulary routing** (guarded forwarders acceptable as added defense).
- **DR-8** Session-chat egress retirement → **same feature**, vocabulary pinned by the application pass (executed by AR-8).

**Application (AR-1–AR-8 — `application-architecture.md` §"Decisions needing user ratification"):**
- **AR-1** Reissue emission → **unconditional dual** (Set-Cookie + retained header).
- **AR-2** Org-id carry → **trusted `X-Provisioned-Org-Id`** (strip-then-inject).
- **AR-3** Cause enums + backend `OrgCreate` gains name validation → **yes** (validation moves to the SSOT as the machine guard dies).
- **AR-4** Mode discovery → **side-effect-free `GET /api/auth/config`** (login mints one-shot CSRF state; discovery must not).
- **AR-5** Retire the `auth_retry_clicked` KPI trigger; derive the retry funnel from `org_create.intercepted` aggregator-side → **yes**.
- **AR-6** Acceptance migration → **rework `tests/acceptance/org-onboarding/` in place** (scenarios survive; only driver choreography changes).
- **AR-7** `ReducedContext` pruning (delete `access_token`, `pending_project_name`, `most_recent_session_per_project`, `last_used_resolution_degraded`) → **yes, all four** (DISTILL verifies no harness reads them).
- **AR-8** Session-chat wire vocabulary → **as pinned in §e.5**; UI-intent members enumerated mechanically at DISTILL.

## Review trail

| Pass | Reviewer | Verdict | Findings addressed in-wave |
|---|---|---|---|
| System | nw-system-designer-reviewer | APPROVE | (i) WorkOS org-name-uniqueness claim marked as a DELIVER-validated ASSUMPTION with the consequence if false; (ii) WorkOS endpoint naming clarified (logical ops vs the actual `POST /organizations` + `POST /user_management/organization_memberships` + `DELETE /organizations/{id}`). |
| Domain | nw-ddd-architect-reviewer | APPROVE | Glossary heading renamed to "Presentation Coordination context" in brief.md (cosmetic). Crash-class file:line claims spot-verified by the reviewer against live code. |
| Application | nw-solution-architect-reviewer | APPROVE | Medium finding "verify three backend claims before DISTILL" — **resolved in-wave by orchestrator verification 2026-06-10**: `OrgCreate.name: str` unconstrained (`backend/app/routers/organizations.py:16–19` ✓); `trust_proxy_headers` gate (`backend/app/routers/deps.py:38`, `config.py:74` ✓); `get_organization_by_name` name-uniqueness lookup (`create_organization.py:48` ✓). Bonus: `IDENTITY_HEADERS` strip confirmed applied on ALL THREE ingress paths (`auth-proxy/app.ts:508` /ui-state, `:595` /worker, `:791` catch-all ✓) — the AR-2 strip-then-inject posture holds everywhere. |
