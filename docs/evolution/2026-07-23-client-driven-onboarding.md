# Client-Driven Onboarding — Evolution

> **Feature**: client-driven-onboarding
> **Finalized**: 2026-07-23
> **Waves**: DESIGN → DISTILL → DELIVER (brownfield entry at DESIGN; the
> user-ratified `design-intent.md` is the seed)
> **ADRs ratified**: ADR-048, ADR-049, ADR-050 (all Accepted 2026-06-11)
> **Delivered**: 5 vertical slices CDO-S1…CDO-S5, all merged 2026-06-11
> **Precursor**: [`2026-07-09-org-onboarding`](2026-07-09-org-onboarding/FINALIZE.md)
> (subsumed — see Business Context)

## Summary

Onboarding stopped being a **server-driven** flow and became a **client-driven**
one. The browser now owns the org/first-project write choreography: it POSTs to
the backend and then *reports* past-tense outcome events (`org_created`,
`org_found`, `project_created`, …) to the ui-state presentation coordinator, which
transitions on the reports alone. Every server-side onboarding egress invoke is
retired, so **ui-state has zero live network egress**; identity stays
headers-only, seeded once at cold-start.

Two structural boundaries moved to make that safe:

- **auth-proxy became the sole WorkOS boundary.** It intercepts `POST /api/orgs`,
  runs the pre-check → provision → forward → compensate workflow, and is the only
  container holding `WORKOS_API_KEY` and the only reader of `AUTH_MODE`. The
  backend lost its entire WorkOS/IdP half and is now a pure resource store.
- **The chat-app wire vocabulary closed.** The `{type: string}` catch-all and the
  imperative UI-intent members retired in favor of a closed past-tense outcome
  union, and the settled-child event-crash class was made *unrepresentable* by
  phase-gated vocabulary routing (no root-level total-forward).

## Business Context

The predecessor, **`org-onboarding`**, shipped a working first-run flow (org + one
default project) but on a **server-driven** model: ui-state itself called out to
the backend/WorkOS to create the org, and the machine carried in-flight states
(`creating_org`, `creating_project`) that could dead-end in a terminal
`partial-setup`. That coupling produced the class of bugs its own finalize
recorded — theater tests hiding a `POST /api/orgs` 500-on-success, and a stale
org-global catalog memo the API seam couldn't see. It also left the
`AUTH_MODE`/`WORKOS_*` config split across the backend *and* auth-proxy (an
`AUTH_MODE` split-brain representable in compose), and violated ADR-016 by letting
ui-state talk directly to the backend.

Client-driven-onboarding is the structural fix: move the write workflow to the one
boundary that should own it (auth-proxy), reduce the backend and ui-state to their
proper roles (resource store; presentation coordinator), and make the whole flow
report-driven so that **every failure is representable as retryable** — no
terminal-in-practice states. The predecessor's durable backend affordance
(nullable `organizations.created_by`, the `DEV_NO_ORG` DB-resolution flag) stays
live on `main`; its onboarding *layer* was reworked in place here, so
org-onboarding is archived as a precursor rather than finalized standalone.

## Architecture (post-feature)

- **auth-proxy** (`auth-proxy/`) — sole WorkOS boundary and sole `AUTH_MODE`
  reader. New `lib/org-create-workflow.ts` (pure, fault-injection-testable):
  pre-check availability → provision WorkOS org + membership (5s timeouts, no
  auto-retry on create, 1 retry on membership) → forward the backend POST with a
  trusted `X-Provisioned-Org-Id` (strip-then-inject via `IDENTITY_HEADERS`) →
  best-effort compensate (`DELETE /organizations/{id}`, 1 retry) on backend
  non-201. Also: `GET /api/auth/config → {mode}` (side-effect-free mode
  discovery), and reissue now emits `Set-Cookie: auth_token` (+ `session=1`)
  **in addition to** the retained `X-New-Access-Token` header on the org-create
  201 (ui-cookie-session D8 un-parked).
- **backend** (`backend/`) — pure resource store for the org path. WorkOS
  footprint deleted (`_create_workos_org`, `auth_mode` dispatch, `httpx`,
  `WORKOS_*`/auth-mode config). Gained `OrgCreate` name validation (422), a
  `GET /api/orgs/availability?name=` read, and honors the trusted
  `X-Provisioned-Org-Id` (the WorkOS org id IS the local id). `created_by` +
  name-uniqueness 409 + the dev create path unchanged.
- **ui-state** (`ui-state/`) — pure presentation-state coordinator with **zero
  network egress**. Onboarding, project-context, and session-chat machines are
  report-driven (past-tense outcome members); all egress actors deleted; config
  shrunk to Redis-only. Identity seeded once from the verified `X-User-Email`
  header at cold-start (INV-PCO — no event writes identity).
- **shared/ui-state-wire** (`shared/ui-state-wire/`) — the `ChatAppWireEvent`
  union closed: catch-all removed, imperative intents retired, past-tense outcome
  family + failure members + cause enums added. `ReducedContext` pruned four dead
  fields.
- **ui/** (`ui/`) — new `app/lib/onboarding-driver.ts` (pure, collaborator-injected
  flow policy): Phase-B probe (definitive-answers-only), status→cause mapping,
  automatic Phase-D default project, manual org retry + project probe-first
  convergence. `login.tsx` renders no sign-in affordance until `fetchAuthConfig`
  resolves (dev button only in dev mode); `onboarding.tsx` drives POST-then-report
  and honors the **binding display rule** (no raw cause tag reaches the DOM).
- **Topology**: zero delta — no new containers/replicas/ports, no nginx changes.

## Key Decisions (ratified 2026-06-11)

- **[D1] WorkOS write workflow → auth-proxy via org-create interception**
  (ADR-048). The `AUTH_MODE` split-brain becomes unrepresentable in compose.
- **[D2] Failure strategy = pre-check-then-compensate (A+B layered)** (ADR-048 §3).
  Backend name pre-check *before* any WorkOS egress (a user-typo 409 can never
  orphan an IdP org; TOCTOU backstopped by the DB unique constraint), layered with
  best-effort `DELETE` compensation; failed compensation emits the alertable
  `workos.org_compensate.fail` (operator reconcile queue). No scheduled reconciler
  at ~0.001 QPS.
- **[D3] Zero topology delta**; ui-state loses ALL network egress (the ADR-016
  bypass is removed, not patched).
- **[D4] Client-reported outcome event model** (ADR-049, amends ADR-041). ui-state
  transitions only on client-reported past-tense outcome events; all five egress
  invokes retired. **DR-2 ratified as plain past tense** (`org_created`,
  `org_found`, …), overriding the pass's `*_reported` recommendation: ui-state is
  an extension of the frontend (same trust domain), so the event language reads as
  the flow the user follows through the app.
- **[D5] INV-PCO — Presentation-Coordination-Only trust invariant** (ADR-049).
  ui-state state and every outcome report are trusted for presentation
  coordination ONLY — never authorization, resource-existence, or identity.
  Enforced by construction (zero egress, no downstream reader, reissue triggers off
  the backend 201, reports apply only to the reporter's own header-keyed actor).
- **[D6] Settled-child event-crash class dies by phase-gated vocabulary routing**
  (ADR-049). The root-level total-forward and `active_child_id` are deleted; events
  have handlers only in states where the target child is provably alive; the wire
  union closes. The crash (event → stopped child → unobserved XState throw →
  process death) becomes unrepresentable.
- **[D7] The six application contracts (a)–(f) pinned** (ADR-050): (a) reissue dual
  emission (Set-Cookie + retained header); (b) trusted `X-Provisioned-Org-Id`
  carry; (c) failure causes with the binding **display rule** (cause enums are
  wire-only; the UI never renders a raw tag); (d) side-effect-free mode discovery;
  (e) the closed wire vocabulary; (f) the engaged flip read off the
  `project_created` POST's own response document.

Three ratification amendments: DR-2 → plain past tense; the cause-tag display rule
(friendly helper text / generic retry surface, never a raw tag); and a
console-log audit trail on the client (each posted outcome + resulting region
state logged via `createLogger`).

## Work Completed (5 slices, all merged 2026-06-11)

- **CDO-S1 — walking skeleton** (`crew/framer`, dc-8nh). ui-state onboarding +
  project-context machines moved from invoke-driven I/O to client-reported outcome
  events; identity seeded once at cold-start; happy-path dev flow end-to-end. The
  closed-union catch-all + legacy members kept (closure deferred to S3/S5). Gate:
  ui-state 177 vitest green, walking-skeleton acceptance green.
- **CDO-S2 — backend pure-resource contracts** (`crew/quartermaster`, dc-qw4).
  `OrgCreate` 422 name validation; the entire backend WorkOS footprint deleted;
  `X-Provisioned-Org-Id` carry; `GET /api/orgs/availability`; compose `AUTH_MODE`/
  `WORKOS_*` env deltas. Resolved UPSTREAM-3 (HIGH): WorkOS org names are
  non-unique, so ADR-048 R1's assumption holds and compensation stays best-effort.
  Gate: backend 1426 pytest green.
- **CDO-S3 — failure-class robustness + crash-class elimination + closed-union
  closure** (`crew/lifeguard`, dc-o0x). Onboarding/project failure splits
  (re-edit vs retry; `error_recoverable` made report-accepting → kills the
  `partial-setup` terminal); closed wire union + state-document narrowing;
  crash-class elimination via phase-gated routing + closed router ACL (unknown →
  400 in every phase); project switch made report-only. Gate: ui-state 197 vitest
  green; DWD-5 deterministic crash-reproduction regression lock.
- **CDO-S4 — auth-proxy mode discovery + reissue Set-Cookie + retry-KPI cleanup**
  (`crew/doorman`, dc-c6u). `GET /api/auth/config` (pre-auth, side-effect-free,
  `max-age=300`); `applyOrgCreateReissue` dual emission (mode-agnostic; only
  `Secure` is dev-gated) un-parking ui-cookie-session D8; retired the dead
  `auth_retry_clicked` KPI trigger. Gate: auth-proxy 252 vitest green;
  `cdo_s4` acceptance green.
- **CDO-S5 — ui/ client-drive surfaces + auth-proxy WorkOS interception**
  (`crew/chauffeur`, dc-fx1) — the final single-cut closed-union deploy.
  Report-driven session-chat machine (DR-8); ui-state zero-egress (grep-proven);
  `lib/org-create-workflow.ts` interception; `ui/` onboarding-driver + login
  mode-discovery + the binding display rule; single-cut compose env deltas.
  Gates: ui-state 189 · auth-proxy 276 · ui 250 vitest, ui tsc clean; adversarial
  review APPROVE-WITH-NITS (all 6 binding requirements pass).

## Lessons Learned

- **Report-driven beats invoke-driven for a coordinator that must never dead-end.**
  Making `error_recoverable` *report-accepting* (rather than a terminal error) is
  what structurally eliminated the `partial-setup` terminal state — the invariant
  "every failure is retryable" fell out of the event model, not out of extra
  recovery machinery.
- **Crash-classes are best killed by making them unrepresentable.** The
  settled-child crash didn't need a guard bolted on; deleting the root total-forward
  and phase-gating the vocabulary meant the offending event simply has no handler
  in the wrong phase. Defense-in-depth (guarded forwarders) is additive, not the
  fix.
- **One boundary per external system.** Collapsing WorkOS to a single container
  removed a whole class of compose-representable `AUTH_MODE` split-brain, and
  shrinking the backend to a pure resource store made "the WorkOS org id IS the
  local id" a trivial trusted-header pass-through instead of a dual-write.
- **A single-cut closed-union deploy needs its readers mapped first.** Narrowing
  SHARED types (CDO-S3) narrows what every out-of-scope package imports; the
  confirmed readers (`ui/app/routes/app-shell.tsx`, the parked `frontend/`) had to
  be reconciled in the S5 single cut, not piecemeal.

## Deferred / Open Issues

- **UPSTREAM-S3-1 (open, backend + DISTILL — a follow-up backend slice, NOT CDO):**
  `test_org_name_taken_reedit` is RED because the backend `create_organization`
  raises `AuthorizationError` (`_ensure_user_has_no_org`) *before* the
  name-uniqueness check and the org controller has no `AuthorizationError → 4xx`
  arm, so the second `POST /api/orgs` returns **500 instead of 409**. Compounded by
  a DISTILL single-principal test-design limitation (a genuine
  name-conflict-by-another-user is unreproducible in the dev `DEV_NO_ORG` target
  without a second principal). It shipped RED + documented at the CDO-S4 gate and
  was carried forward identically through CDO-S5 (Iron Rule forbids editing the
  test). **Suggested fix:** map `AuthorizationError → 403` in the org
  result-mapper AND/OR run the name-uniqueness check before `_ensure_user_has_no_org`,
  plus a second-principal acceptance affordance.
- **Legacy wire members kept, not retired.** `org_form_submitted` /
  `create_project_submitted` / `switching_project_intent` remain in the union
  because they are still consumed by the live `project-and-chat-session-management`
  + `user-flow-state-machines` suites and by parked `frontend/`. `ui/` stops
  *producing* them; full retirement is a future cleanup once those suites migrate.
- **Feature-level mutation testing deferred.** No per-package TypeScript mutation
  harness is configured for ui-state/auth-proxy/ui; each slice relied on unit
  greens + adversarial review + the acceptance integration gate.

## Artifact Links

- Feature workspace (preserved): [`docs/feature/client-driven-onboarding/`](../feature/client-driven-onboarding/)
  — DESIGN (`design/`), DISTILL (`distill/`), and per-slice DELIVER
  (`deliver/cdo-s1…s5/`) artifacts, including each slice's `deliver-summary.md`
  and `wave-notes.md`.
- ADRs: [`ADR-048`](../decisions/adr-048-auth-proxy-owns-workos-write-workflow.md) ·
  [`ADR-049`](../decisions/adr-049-client-reported-outcome-event-model.md) ·
  [`ADR-050`](../decisions/adr-050-client-driven-onboarding-application-contracts.md)
- Architecture (copied on finalize): [`docs/architecture/client-driven-onboarding/`](../architecture/client-driven-onboarding/)
- Walking skeleton (copied on finalize): [`docs/scenarios/client-driven-onboarding/`](../scenarios/client-driven-onboarding/)
- Precursor: [`2026-07-09-org-onboarding/FINALIZE.md`](2026-07-09-org-onboarding/FINALIZE.md)
- Acceptance suite: `tests/acceptance/org-onboarding/` (reworked in place — AR-6)
