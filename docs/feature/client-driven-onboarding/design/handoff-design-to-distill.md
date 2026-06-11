# Handoff: DESIGN → DISTILL — client-driven-onboarding

**Date:** 2026-06-10
**From:** DESIGN wave (full-stack: system → domain → application, propose mode)
**To:** DISTILL (acceptance-test design)
**Gate:** CLEARED — ADRs 048/049/050 **Accepted** (user-ratified 2026-06-11). All recommendations stand except DR-2 (overridden → **plain past tense** event names), plus two amendments: the cause-tag **display rule** (no raw tags rendered) and the **console-log audit trail**. See `wave-decisions.md` §"Ratification record".

## What DISTILL receives

| Artifact | Content |
|---|---|
| `../design-intent.md` | The user-ratified seed: fixed boundaries + Phases A–D target flow |
| `system-architecture.md` + ADR-048 | Interception system view, pre-check-then-compensate, env/credential deltas, observability events, C4 context/container |
| `domain-model.md` + ADR-049 | Context-map amendment, INV-PCO, the past-tense outcome vocabulary, both region statecharts + Given/When/Then Specs 1–8, crash-class elimination |
| `application-architecture.md` + ADR-050 | The six pinned contracts (a)–(f) with exact HTTP/TS shapes, file-by-file delta, cleanup inventory, component C4, per-test acceptance migration verdicts |
| `wave-decisions.md` | Consolidated decisions, reuse analysis, constraints, ratification register, review trail |

## The acceptance surface (what tests assert against)

- **Wire:** the unchanged ADR-046 `/ui-state/state(+/events,+/stream)` surface — but with the CLOSED `ChatAppWireEvent` union (ADR-050 §e.1) and the new region state strings (`awaiting_org_report` replaces `verifying`; `creating_org`/`creating_project` gone; `error_recoverable`/`ready` kept by name).
- **HTTP:** `GET /api/auth/config → {mode}` (d); `POST /api/orgs` through auth-proxy with interception semantics + reissue `Set-Cookie` (a,b); failure envelopes + cause mapping (c); `GET /api/orgs/availability` pre-check affordance.
- **The flip:** app entry asserts `regions.projectContext.state === "project_selected"` + non-null `active_scope.project_id` on the `project_created` response document (f).

## DISTILL work plan (from the application pass §e.4 + domain Specs)

1. **Rework `tests/acceptance/org-onboarding/` in place** (AR-6): driver EXTEND (`create_project` + report helpers; `create_org` already POSTs); 5 tests REWORK (real POST + outcome-report choreography replaces `org_form_submitted`/`create_project_submitted`); `test_invalid_org_name_stays_needs_org.py` REWRITE against the new backend 422 (AR-3); `test_post_orgs_no_longer_auto_creates_project.py` SURVIVES near-as-is.
2. **New RED scenarios** (from domain Specs 4/5/7b/8): name-taken 409 re-edit (no dead end); org-create 5xx → `error_recoverable` → successful retry (compensated and uncompensated indistinguishable); default-project failure → retry convergence (probe-first); **the Spec-8 crash regression** — an out-of-phase/late event to a settled region must return a coherent document, never crash the process.
3. **Mode-discovery scenarios** (d): dev mode → dev button; workos mode → no dev affordance + redirect descriptor.
4. **Reissue scenario** (a): org-create 201 response carries `Set-Cookie: auth_token` with the new org claim (workos-mode path may be compose-gated as in ui-cookie-session; dev path asserts no reissue needed via `DEV_NO_ORG`).
5. **DISTILL-time verifications** (cheap, pinned by the wave): no harness reads the four pruned `ReducedContext` fields (AR-7); enumerate session-chat UI-intent members mechanically from the machine's event union (AR-8).

## Constraints the tests must encode (non-negotiable)

- **No terminal dead-ends:** every failure state accepts a retry path (ADR-048 inheritance).
- **No raw cause tags rendered (ratification amendment 2):** any scenario that renders a failure asserts user-friendly helper text (re-edit class) or the generic "something went wrong on our end" surface (retry class) — never a wire tag like `org_create_failed` in the DOM. The shipped `Cause: partial-setup` rendering is the anti-pattern.
- **Console-log audit trail (ratification amendment 3):** the client logs each posted outcome event + resulting region state via `createLogger` — browser-pass scenarios may assert the narration exists; unit-level enforcement lands at DELIVER.
- **INV-PCO:** no test may treat ui-state output as a resource oracle — app-DB side effects are asserted via the backend (`GET /api/orgs/me`, project existence), exactly as the shipped suite already does.
- **Iron Rule:** the shipped suite is GREEN today; the rework makes it RED against the new contracts only where behavior genuinely changes — never modify an assertion merely to make it pass.

## Sequencing notes

- The walking-skeleton path: orgless principal → mode discovery → sign-in → probe+report → org create (intercepted) + report → automatic default project + report → engaged entry. Strategy C (real compose stack), `AUTH_MODE=dev` + `DEV_NO_ORG=true` primary, as shipped.
- Compose deltas land with DELIVER (env removals per ADR-048 §4; the override api `AUTH_MODE` pin deletion) — DISTILL may assume the current stack.
- One DELIVER-time validation flagged: the WorkOS org-name-uniqueness assumption (R1 note).
