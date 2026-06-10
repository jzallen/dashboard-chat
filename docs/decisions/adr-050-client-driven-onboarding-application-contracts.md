# ADR-050: Client-Driven-Onboarding Application Contracts (Reissue Cookie, Org-Id Carry, Failure Causes, Mode Discovery, Closed Wire Vocabulary, Engaged Flip)

**Status:** Proposed (awaiting user ratification — AR-1–AR-8 in the application-architecture doc)
**Date:** 2026-06-10
**Originating wave:** DESIGN — `client-driven-onboarding` (application scope, propose mode — final architect pass)
**Author:** Morgan (nw-solution-architect); grounded in the user-ratified seed `docs/feature/client-driven-onboarding/design-intent.md`, ADR-048 (system scope), ADR-049 (domain scope), and the live source
**Scope:** Application architecture — the concrete wire/HTTP contracts that make the inherited decisions implementable: the reissue→`Set-Cookie` mechanism (a), the org-id carry (b), failure-class HTTP shapes + cause enums + retry policy (c), the mode-discovery endpoint (d), the closed `ChatAppWireEvent` union + state-document deltas + the migration of the shipped org-onboarding surfaces and acceptance suite (e), and the wire-level engaged-state flip (f). One ADR, six per-point sections — matching the seed's "(a)–(f), each as a short ADR or ADR section".

**Companions:** ADR-048 (auth-proxy owns the WorkOS write workflow — inherited: A+B layered failure strategy, zero nginx changes, env deltas, observability events, R5 timeouts), ADR-049 (client-reported outcome event model — inherited: the `*_reported` vocabulary, INV-PCO, phase-gated vocabulary routing, no in-flight server states, the retryability constraint).
**Un-parks (completes):** ui-cookie-session D8 (`docs/feature/ui-cookie-session/design/delta-and-decisions.md` §3/§6) — the reissue→`Set-Cookie` conversion, parked 2026-06-08, pinned here.
**Closes:** org-onboarding upstream issue UI-1 (`docs/feature/org-onboarding/distill/upstream-issues.md`) — the `create_project_submitted` `org_name`-misnomer dies with the event.
**Honors:** ADR-016 (sole ingress / trusted-header posture — the org-id carry rides it), ADR-044/046 (the `/state` transport and StateProxy are byte-untouched; only the vocabulary inside the published language changes).

---

## Context

ADR-048 fixed *where* the WorkOS write workflow lives (auth-proxy interception of `POST /api/orgs`) and ADR-049 fixed *what* ui-state becomes (a zero-egress coordinator transitioning on client-reported outcomes). Both deliberately left the wire-level contracts to this pass (ADR-048 scope note; ADR-049 scope note). Without them the design is not implementable: the reissued token has no pinned transport, the WorkOS-minted id has no pinned channel into the backend write, failures have no client-mappable shapes, the dev sign-in affordance still renders unconditionally (design-intent Why #5), the shipped org-onboarding surfaces and acceptance suite (`tests/acceptance/org-onboarding/`, shipped 2026-06-10) have no migration path, and the FE has no pinned predicate for "onboarding complete".

All decisions below are grounded in the live tree; file:line evidence is in the deliverable (`docs/feature/client-driven-onboarding/design/application-architecture.md`).

## Decision

### (a) Token reissue rides `Set-Cookie` on the org-create response — unconditional dual emission

`applyOrgCreateReissue` (`auth-proxy/app.ts:839–885`) keeps its compute (`lib/post-response-reissue.ts`) and, on trigger (`POST /api/orgs → 201`, user token), emits **both** the existing `X-New-Access-Token`/`X-New-Token-Expires-In` headers **and** the cookie pair with the ui-cookie-session D1 attributes: `auth_token=<jwt>; HttpOnly; SameSite=Lax; Path=/; Max-Age=<expiresIn>` (+`Secure` iff `AUTH_MODE != dev`) plus a refreshed `session=1` flag — two distinct `Set-Cookie` headers, never collapsed (UC-6), built with the same `buildSetCookie` the callback uses (`app.ts:173–198`).

- **The client does nothing** — httpOnly; Phase D's automatic `POST /api/projects` rides the new org claim, which is why the reissue must land on the org-create response itself (no extra round-trip, no race).
- **Dev mode: no special case** — the hook stays mode-agnostic; `DEV_NO_ORG` DB resolution (`backend/app/routers/deps.py:49–65`) makes the claim refresh harmless redundancy.
- **Header emission retained** — ui-cookie-session D2/D9 reaffirmed: `frontend/` stays localStorage-Bearer; PAT/M2M/headless reissue reads keep working (read priority HEADER > COOKIE makes dual-credential browsers safe). Considered and rejected: cookie-only (breaks `frontend/` + headless), conditional-on-credential-source (plumbing + doubled test matrix for zero security gain — the token was already header-exposed).
- `auth.reissue.emitted` (ADR-048 §5) reports `transport: "both"`.

### (b) Org-id carry: trusted header `X-Provisioned-Org-Id`, strip-then-inject

The interception branch, after a successful WorkOS org-create, sets `X-Provisioned-Org-Id: <workos_org_id>` on the forwarded `POST /api/orgs`. The header joins the `IDENTITY_HEADERS` strip list (`auth-proxy/lib/auth.ts:68`), so a client-supplied value is dropped on every route — unforgeable by the same construction that protects `X-User-Id`. The backend reads it gated on `trust_proxy_headers` (the existing trust gate, `deps.py:36–45`) and passes it to the repository as the row `id=` — the exact parameter today's workos path uses (`create_organization.py:79`), preserving the rule that **the WorkOS org id IS the local org id**. Header absent (dev mode, and all non-intercepted traffic) → backend-generated id, as today (`:82`).

Considered and rejected: proxy body rewrite (breaks the streamed forward, `app.ts:926–932`, and conflates client-authored with proxy-authored body fields); backend accepting `id` in the request body (client-forgeable org-id minting — violates the headers-not-bodies trust posture of ADR-016).

Supporting affordance (ADR-048 layer A): **`GET /api/orgs/availability?name=` → `200 {"available": bool}`** — one new backend route over the existing `get_organization_by_name` lookup, called by the interception with the same identity headers + correlation id before any WorkOS egress.

### (c) Failure contracts: relayed backend statuses + one synthesized proxy envelope; three-tag cause enum; manual-retry-only policy

The intercepted route **relays backend statuses verbatim**; proxy-originated WorkOS-egress failures synthesize `502 {"errors":[{"status":"502","title":"Organization provisioning failed","code":"org_provisioning_failed"}]}`; the pre-check conflict synthesizes the **backend's own JSON:API 409 shape** so the client has one 409 contract regardless of which layer caught it. Compensated and uncompensated persist failures are **client-indistinguishable by design** — the orphan signal is operator-side (`workos.org_compensate.fail`, ADR-048 §5) and the client's retry is valid either way.

Cause enums (closing ADR-049 §3.2's delegation): `OrgCreateFailureCause = "org_name_taken" | "org_name_invalid" | "org_create_failed"`; `ProjectCreateFailureCause = "project_create_failed"`; `ScopeMismatchCause` unchanged. Client mapping: `201 → org_created_reported`; `409 → org_name_taken`; `400/422 → org_name_invalid`; anything else (incl. network/timeout) → `org_create_failed`; `401` is never an outcome report (auth gate). The two-way domain split holds: the first two re-edit in `needs_org` (inline `org_validation_error`), the third lands in the report-accepting `error_recoverable`.

Retry policy: **manual only** for org create (non-idempotent end-to-end — ADR-048 R5); **probe-first convergence** for the default project (re-probe `GET /api/projects` before re-POSTing — a lost 201 becomes `scope_resolved_reported`, not a duplicate). **Probe transport failures are not reportable**: only definitive SSOT answers (`200`/`404`) produce `org_exists_reported`/`org_missing_reported` — the earned-trust rule applied client-side.

Consequence: the backend `OrgCreate` schema gains name validation (strip + min length) — the retired machine-side `isOrgNameValid` guard relocates to the SSOT (today `name: str` is unconstrained, `organizations.py:16–19`). The backend's `requires_reauth` response attribute dies (its purpose is replaced by (a)).

### (d) Mode discovery: side-effect-free `GET /api/auth/config`

`GET /api/auth/config → 200 {"mode": "dev" | "workos"}` with `Cache-Control: public, max-age=300` — an auth-proxy local route (sole `AUTH_MODE` reader), registered before the catch-all per the `/api/auth/me` pattern, requiring no credential and no nginx change (ADR-048 §3). `ui/app/routes/login.tsx` fetches it once (memoized, Zod-validated at the boundary), renders **no sign-in affordance until the mode is known** (no flash of a dev affordance), then: `dev` → the dev button; `workos` → a plain "Sign in" button — both invoking the unchanged `login()` (auth-proxy already returns the mode-appropriate URL).

Considered and rejected: folding mode into `GET /api/auth/login` — in workos mode every login call mints and remembers a one-shot CSRF state (`app.ts:119–120`); a render-time discovery call would leak unconsumed states and conflate render with sign-in intent. Discovery must be side-effect-free.

### (e) The closed wire vocabulary, document deltas, and the migration of the shipped surfaces

- **`ChatAppWireEvent` becomes a closed union** (full TS sketch in the deliverable §e.1): the ADR-049 `*_reported` members with the (c) cause enums and `{id, name}` display snapshots; kept members `session_begin`, `open_deep_link`, `back_to_projects_clicked`, `__force_failure__`; the session-chat vocabulary (executing DR-8): outcome members `session_list_reported`, `session_resumed_reported`, `session_created_reported`, `dataset_context_switched_reported` (+ `*_failed_reported` partners) and the surviving UI intents (`session_clicked`, `new_session_clicked`, `first_message_sent`, `refresh_session_list`, `dataset_resolved_by_agent`, `dataset_picked_directly`, suggestion chips). Retired: `org_form_submitted`, `create_project_submitted` (UI-1 dies), `create_project_clicked`, `switching_project_intent`, `retry_clicked`, and the `{type: string}` catch-all (`wire-event.ts:52`).
- **Router ACL**: the onboarding-phase-only schema (`router.ts:244–253`) becomes a full closed-vocabulary Zod schema validated on every POST, compile-bound to the shared union (`z.ZodType<ChatAppWireEvent>`). Unknown type → 400 at the edge; known-but-out-of-phase → forwarded, dropped by the machine, current document returned (ADR-049 Spec 8). The `switching_project_intent → PROJECT_SWITCH` special case retires.
- **State document**: `ChatAppPhase` loses `"rejected"`; region state strings — onboarding `verifying→awaiting_org_report` (−`creating_org`, −`session_rejected`), projectContext `resolving_initial_scope→awaiting_scope_report` (−`creating_project`, −`switching_project`), sessionChat `loading_session_list→awaiting_session_list_report` (−`resuming_session`, −`creating_session`, −`switching_dataset_context`); `ready`/`error_recoverable` preserved (KPI literals). `anonymousStateDocument()` zero states follow. `ReducedContext` prunes `access_token` (executes DR-6), `pending_project_name`, `most_recent_session_per_project`, `last_used_resolution_degraded`.
- **`ui/` migration**: the org form drives `POST /api/orgs` then reports (in-flight UI local — DR-1); the `ProjectNameForm` is deleted (Phase D is an automatic client step); a **new `ui/app/lib/onboarding-driver.ts`** owns the relocated flow policy (Phase-B probe, status→cause mapping, Phase-D auto-create, retry policies, initial-scope resolution ported from the retired `resolveInitialScopeFn`); the app-shell gate updates its state literals and loses the `rejected` branch; StateProxy/Provider are untouched.
- **Acceptance migration** (`tests/acceptance/org-onboarding/` — per-file table in the deliverable §e.4): **rework in place**. The driver gains `create_project` + report helpers (its `create_org` already POSTs the backend directly); five tests rework their choreography (real POST + report instead of `org_form_submitted`/`create_project_submitted`); `test_invalid_org_name_stays_needs_org.py` is rewritten against the new backend 422 (its machine-guard subject retires); `test_post_orgs_no_longer_auto_creates_project.py` survives near-as-is; the feature file's Phase-D wording becomes automatic and gains failure/convergence scenarios (incl. the Spec-8 crash regression).
- **KPI fallout**: the `auth_retry_clicked` trigger (`app.ts:703–709`) retires with `retry_clicked`; the retry funnel re-derives from `org_create.intercepted` (ADR-048 §5).

### (f) Engaged-state flip: region state is the gate predicate; the POST's own response document is the entry signal

The client enters the app on the response document of its `project_created_reported` (or `scope_resolved_reported`) POST, when `regions.projectContext.state === "project_selected"` (the state-of-record predicate) **and** `active_scope.project_id` is non-null; `phase === "chat"` is routing convenience only (the document SSOT itself demotes `phase` to "not a state-of-record", `state-document.ts:170–172`). The parent's `isInitialProjectSelected` guard advances `engaged.project_context → chat` during the same settle, so the triple is atomic in one response. Duplicate, stale-tab, out-of-order, and crash-recovery cases all converge per ADR-049 phase-gating: no handler → no transition → the returned current document makes the client's navigation idempotent. The shipped `ui/` surfaces already dispatch on this predicate (`onboarding.tsx:73`, `app-shell.tsx:153`) — the contract is continuity, not change.

## Consequences

**Positive**

- The design becomes buildable: every inherited decision now has an exact wire shape, header, status mapping, or migration verdict, with file:line grounding.
- ui-cookie-session D8 is completed rather than re-parked; Phase D works in workos mode with zero client token code.
- The trust posture is uniform: ids and identity ride proxy-injected, strip-protected headers; bodies are never trusted; the dev affordance is server-gated; the wire union is closed so unknown events are rejected at the edge.
- The shipped org-onboarding investment is preserved: the business scenarios and the `ui/` surfaces survive — only the write choreography moves; upstream issue UI-1 closes structurally.
- Two new modules total (an auth-proxy workflow unit, a `ui/` flow driver), each filling a documented absence; everything else is extend/shrink/delete.

**Costs / accepted trade-offs**

- The acceptance suite goes RED across the cut and is reworked in the same MR sequence (single-cut closed union; FE + ui-state + shared deploy together in compose) — accepted over a transitional dual-vocabulary window that would let the retired events linger.
- The backend gains one validation rule and one read endpoint — small new surface, each justified upstream (guard relocation; ADR-048 layer A).
- A KPI definition changes (`auth_retry_clicked` derivation moves aggregator-side) — ratification AR-5.
- Workos-mode interception coverage shifts to auth-proxy unit + fake-WorkOS acceptance (via the R4 `WORKOS_BASE` pin) — new test surface to build at DISTILL.

## References

- Application-scope deliverable (options matrices, contracts, file-by-file map, cleanup inventory, C4 component view, reuse gate, AR-1–AR-8): `docs/feature/client-driven-onboarding/design/application-architecture.md`
- Seed: `docs/feature/client-driven-onboarding/design-intent.md` · ADR-048 (system) · ADR-049 (domain)
- ui-cookie-session D1–D9: `docs/feature/ui-cookie-session/design/delta-and-decisions.md` · org-onboarding bridge + upstream issues: `docs/feature/org-onboarding/design/delta-and-decisions.md`, `docs/feature/org-onboarding/distill/upstream-issues.md`
- ADR-016 (sole ingress), ADR-030 (observability inheritance), ADR-043 (token lifecycle), ADR-044/046 (transport unchanged)
- Live code (verified 2026-06-10): `auth-proxy/app.ts:66–84,107–136,173–198,280–298,689–770,785–826,839–885`, `auth-proxy/lib/{post-response-reissue.ts, cookies.ts, auth.ts:60–68, user-auth/workos.ts}`, `backend/app/use_cases/organization/{create_organization.py, exceptions.py}`, `backend/app/routers/{organizations.py, deps.py:36–65}`, `backend/app/controllers/{organization_controller.py, _result_mapper.py}`, `backend/app/config.py:74–81`, `ui-state/{config.ts, lib/machines/chat-app/{machine.ts, router.ts:244–253,440–456,560–573, setup/{actions.ts, guards.ts}}, lib/machines/{onboarding,project-context,session-chat}/}`, `shared/ui-state-wire/{wire-event.ts, state-document.ts}`, `ui/app/{routes/{login,onboarding,app-shell}.tsx, lib/{state-proxy.ts, StateProxyProvider.tsx}, auth/bootstrap.ts}`, `docker-compose.override.yml:30–37`, `tests/acceptance/org-onboarding/`
