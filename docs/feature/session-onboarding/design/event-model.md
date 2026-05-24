# Event Model — session-onboarding (corrected flow)

**Wave:** DESIGN (propose mode) · **Date:** 2026-05-22 · **Author:** Hera (nw-ddd-architect)
**Status:** PROPOSED — pending user ratification
**Technique:** Event Modeling (Dymitruk) — the model IS the spec; it produces the Given/When/Then
the DISTILL wave turns into RED acceptance coverage.

This models the **to-be** flow (seed brief §4) for the realigned `session-onboarding`
machine. It is technology-agnostic: it describes *what happens*, not how XState wires it.
The FlowEvent names below are the proposed wire vocabulary (ADR-039-conformant); the
DISTILL/DELIVER waves bind them to reducers + machine transitions.

---

## Ubiquitous language (Session-Onboarding context)

| Term | Meaning in this context | Replaces |
|---|---|---|
| **Session onboarding** | Bringing an already-authenticated principal to an org-scoped, app-ready state. | "login" (which happened upstream) |
| **Principal** | The verified user identity injected by auth-proxy (`X-User-Id`). | `persona` (a dev fixture concept) |
| **Re-verification** | Defense-in-depth re-check of the forwarded Bearer against WorkOS `/oauth/userinfo`. | "authentication" |
| **Verified user** | The WorkOS profile (`email`, `display_name`) returned by re-verification. | `persona_email`/`persona_display_name` body claims |
| **Org binding** | The (org_id, org_name) the principal operates under; pre-existing (returning user) or freshly created. | — |
| **Session rejected** | Terminal state when re-verification fails (token/user invalid). | — (new) |

---

## Phase 1 — Events on the timeline (orange)

Past-tense facts, left → right chronological. Two entry branches (returning user with org;
new user without org) and the rejection branch.

```
Timeline ──────────────────────────────────────────────────────────────────────▶

  session_started ──┬── (hasOrg)  ──────────────────────────────▶ [ready]
  {user, org|null}  │
                    └── (no org)  ── org_form_submitted ──┬── org_created
                                                          │       {org, access_token?}
                                                          └── validation_failed
                                                                  (stay needs_org)

  session_rejected   (re-verify failed — terminal, no user state advances)

  ─── side-states from ready ───
  token_expired ── silent_reauth_ok ──▶ [ready]
                └─ silent_reauth_failed ──▶ error_recoverable
  reissue_failed_partial ──▶ error_recoverable ── retry_clicked ──┬─▶ creating_org
                                                                  └─▶ error_terminal
```

**Retired events** (L6 / §2.4): `sign_in_clicked`, `auth_callback_resolved`, `auth_failed`.
The first is replaced by `session_started`; the latter two were already dead in the machine
(removed in `79a9c01`) and now lose their FlowEvent + reducer existence too.

---

## Phase 2 — Commands (blue), Read Models (green), Screens (white)

Wiring: `Screen → Command → Event(s) → Read Model → Screen`.

| Screen | Command | Event(s) | Read Model (projection) |
|---|---|---|---|
| (browser arrives authenticated) | **BeginSessionOnboarding** | `session_started{user, org}` → then `[hasOrg]` ready OR `needs_org` | projection.context.user populated **at t=0** (defect fixed), projection.state ∈ {ready, needs_org} |
| Welcome / org-name form | **SubmitOrgName** | `org_created{org, access_token?}` OR `validation_failed{error}` | projection.state = ready, projection.context.org set; OR needs_org + org_validation_error |
| (re-verify failure surface) | (none — BeginSessionOnboarding side outcome) | `session_rejected{reason}` | projection.state = session_rejected; FE renders a "sign in again" / contact-support surface |
| App shell (ready) | (no command — token expiry is system-driven) | `token_expired` | projection.state = expired_token; chat frozen |
| Recoverable-error page | **RetrySetup** | `org_created` (retry) OR escalate `error_terminal` | projection.state ∈ {ready, error_terminal} |

**The decisive change (L2).** `BeginSessionOnboarding` is a *single* command that produces
`session_started` carrying the verified user from the re-verify call, then immediately
forks `[hasOrg] → ready` vs `[else] → needs_org`. The old flow needed two events
(`sign_in_clicked` then `auth_callback_resolved`) and stranded the user payload between
them; the new flow has one self-contained event that seeds the projection.

---

## Phase 3 — Automations (yellow) and External Systems (red)

| Automation / Policy | Trigger → Command |
|---|---|
| **auth_ready broadcast** (preserved + EXTENDED — ratified 2026-05-22) | Fires on first `ready` via EITHER path: `creating_org → ready` (new user) OR `verifying → ready` (returning user, `[hasOrg]`) → pump fires `beginIfNotStarted(project-context)` (carries org_id + first_name). **DELIVER action:** today's `isFirstReady` predicate (`strategy.ts:157`: `prior === "creating_org" \|\| "anonymous" \|\| !prior`) does NOT match `verifying → ready`, so a returning user would not spawn project-context. Extend the predicate to include the `verifying` predecessor. User decision: returning users DO need the broadcast (project-context is not guaranteed already running). |
| **Silent re-auth** | When `token_expired` → invoke `silentReauth` (≤1 attempt, IC-6). |
| **Org-create retry** | When `org_created` invoke fails within budget → re-enter `creating_org`; budget exhausted → `error_recoverable` (preserved). |

| External System (red) | Role |
|---|---|
| **WorkOS `/oauth/userinfo`** | Re-verification target (Bearer in → profile out). `fake-workos` in dev/ci. **Contract-test recommended** (Pact-JS) — OIDC userinfo response shape. |
| **backend `/api/orgs` + `/api/auth/reissue`** | Org creation + (vestigial?) reissue — see open-question #5. |

---

## Phase 4 — Given/When/Then specifications (the DISTILL seed)

These are the testable specs the model produces. They map directly to the RED acceptance
coverage the seed brief §7 flags as REQUIRED (this is a behavior change, not a
characterization-only refactor).

### Spec 1 — Returning user with an org lands ready (NEW `[hasOrg]` branch)

```
GIVEN  auth-proxy has verified the principal (X-User-Id = "u1", Bearer "tok-1")
  AND  WorkOS /oauth/userinfo(tok-1) returns { email: "maya@acme", name: "Maya Chen" }
  AND  the principal already has org binding { id: "org-1", name: "Acme Data" }
WHEN   BeginSessionOnboarding
THEN   session_started { user: {email:"maya@acme", display_name:"Maya Chen"}, org:{id:"org-1", name:"Acme Data"} }
  AND  projection.state == "ready"
  AND  projection.context.user.display_name == "Maya Chen"   (NOT null — defect closed)
  AND  the auth_ready broadcast fires with { org_id: "org-1", first_name: "Maya" }   (returning user spawns project-context — ratified 2026-05-22)
```

### Spec 2 — New user with no org reaches needs_org with identity populated (defect-closing)

```
GIVEN  auth-proxy has verified the principal (X-User-Id = "u2", Bearer "tok-2")
  AND  WorkOS /oauth/userinfo(tok-2) returns { email: "maya@acme", name: "Maya Chen" }
  AND  the principal has no org binding
WHEN   BeginSessionOnboarding
THEN   session_started { user: {email:"maya@acme", display_name:"Maya Chen"}, org: null }
  AND  projection.state == "needs_org"
  AND  projection.context.user.email == "maya@acme"     (was null end-to-end — THE bug)
```

### Spec 3 — Re-verification failure → session_rejected (NEW rejection path)

```
GIVEN  a request reaches ui-state with Bearer "tok-bad"
  AND  WorkOS /oauth/userinfo(tok-bad) responds 401
WHEN   BeginSessionOnboarding
THEN   session_rejected { reason: "token_invalid" }
  AND  projection.state == "session_rejected"
  AND  NO session_started is emitted
  AND  NO user state advances
```

### Spec 4 — Org submission from needs_org reaches ready (preserved)

```
GIVEN  session_started { user:{...}, org: null }   (state = needs_org)
WHEN   SubmitOrgName("Acme Data")  [name valid + unique in tenant]
THEN   org_created { org:{id:"org-1", name:"Acme Data"}, access_token: <see OQ#5> }
  AND  projection.state == "ready"
  AND  projection.context.user is STILL populated   (carried from session_started, not re-fetched)
```

### Spec 5 — Invalid org name keeps needs_org (preserved, renamed state)

```
GIVEN  session_started { user:{...}, org: null }   (state = needs_org)
WHEN   SubmitOrgName("")  [empty]
THEN   validation_failed { error: { kind: "empty", message: "Please enter an organization name" } }
  AND  projection.state == "needs_org"   (was authenticated_no_org)
  AND  no org created, no reissue
```

### Spec 6 — Dev mode skips/short-circuits re-verify (open-question #1; see wave-decisions §OQ-1)

```
GIVEN  AUTH_MODE=dev (auth-proxy injected DEV_USER, no real Bearer)
WHEN   BeginSessionOnboarding
THEN   session_started { user: <DEV_USER profile>, org: <dev org if present> }
  AND  projection.state ∈ {ready, needs_org}     (re-verify is skipped or fake-workos-accepted per OQ-1)
  AND  session_rejected is NOT reachable in dev for the dev user
```

---

## Aggregate boundary (one aggregate, root-only)

**Aggregate: OnboardSession** (root entity, value-typed properties). The aggregate is the
noun/thing the flow manages; the flow/machine that onboards it stays named `session-onboarding`
/ `SessionOnboardingMachine` (process descriptor — ratified distinction, 2026-05-22).

- **Invariant cluster (Vernon rule 1):** a single principal's onboarding state must be
  transactionally consistent — the (verified user, org binding, settled state) tuple is one
  consistency boundary. There is no second entity that must change in the same transaction.
- **Small by default (Vernon rule 2):** root-only — `user` (VO), `org` (VO), state value,
  validation/error VOs. No child entities. This is the ~70% case.
- **Reference by identity (Vernon rule 3):** `Org` is referenced by id; org *creation* is a
  call to the backend Org aggregate (separate context), not an in-aggregate mutation. The
  onboarding aggregate holds `{org_id, org_name}` as a value snapshot, not an Org entity.
- **Eventual consistency outside (Vernon rule 4):** the `auth_ready` broadcast to
  project-context is a cross-aggregate signal (pump-mediated), not a shared transaction.

Stream / flow identity: `flow_id = session-onboarding:<principal_id>` (ADR-030 §6 per-user
flow naming — carried through the rename).

---

## Addendum — `/event` command surface (DESIGN delta, 2026-05-24)

The `/event`-driven commands **SubmitOrgName** (Specs 4/5) and **RetrySetup** (Phase 3
"Org-create retry") are already modeled above; this addendum records that the
`/event`-to-`/begin` parity slice (`event-slice-scope.md`) adds **no new domain events**.

The parity work is **boundary-validation** of the existing commands, not new model elements:
the inbound command vocabulary stays at the ACL (wave-decisions §9 D-E1) — it carries no
aggregate invariant beyond the org-name shape rule, which already lives on the
`constructOrgName` value object. The transport-layer G/W/T seeds DISTILL should add (the
`__force_failure__` failure-simulation gate, the retry-budget exhaustion path, the
`tag`/`payload` well-formedness checks, and the cross-principal identity guard) are derived
from this model and live in `event-slice-scope.md` §4 — they are transport specs, not
additions to the event vocabulary. No event-vocabulary change is required; the command
modeling is complete.
</content>
</invoke>
