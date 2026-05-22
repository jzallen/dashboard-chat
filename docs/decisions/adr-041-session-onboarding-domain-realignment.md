# ADR-041: Session-Onboarding Domain Realignment (login-and-org-setup → session-onboarding)

**Status:** Accepted (ratified by user 2026-05-22)
**Date:** 2026-05-22
**Originating wave:** DESIGN — `session-onboarding` (domain / bounded-contexts scope, propose mode)
**Author:** Hera (nw-ddd-architect)
**Companion artifacts:**
- Seed brief: `docs/feature/session-onboarding/design-intent.md`
- DESIGN deliverables: `docs/feature/session-onboarding/design/{wave-decisions.md, c4-diagrams.md, event-model.md}`
- SSOT: `docs/product/architecture/brief.md` §"Domain Model — session-onboarding"
- Sibling ADR (same wave): ADR-042 (store-model inheritance for session-onboarding)
**Relationship to prior ADRs:**
- Honors ADR-016 (auth-proxy = token SSOT), ADR-027 §1 (FE projection contract), ADR-028
  (XState v5 actor model), ADR-029 (`active_scope` propagation), ADR-030 §1–§4 (topology),
  ADR-039 (ui-state vocabulary; this ADR changes one canonical machine-name registry key),
  ADR-040 (hexagonal transport; this realignment lands AFTER LEAF-4/5/6).

## Context

The `login-and-org-setup` XState machine models an **authentication handshake that does not
happen in `ui-state`**. Its vocabulary (`anonymous`, `sign_in_clicked`, `authenticating`,
`auth_callback_resolved`, `auth_failed`) describes a WorkOS sign-in that completes **upstream
and out of band**: by the time any request reaches `ui-state`, auth-proxy has already
authenticated the user and injected verified identity headers (ADR-016, ADR-030 §1). The
machine re-enacts a completed handshake.

This is a **bounded-context leak**: authentication belongs to the Authentication context
(owned by auth-proxy); session-onboarding belongs inside `ui-state`. The leak produces a
**probe-verified defect** (seed brief §2.2): the resolved user profile never reaches the
projection — `begin()` reads `user` back from a just-reset projection and emits
`auth_callback_resolved{user: null}`, so the projection exposes `user: null` end-to-end. This
is ADR-030's own emission-completeness tripwire firing.

The user has ratified six locked decisions (L1–L6, seed §5) realigning the machine to a
`session-onboarding` model whose entry assumes an already-authenticated principal.

## Decision

Realign `ui-state/lib/machines/login-and-org-setup/` to `session-onboarding`, honoring L1–L6:

### D1 — Rename + entry assumption (L1)
The machine is renamed `SessionOnboardingMachine`; the canonical machine-name registry key
(ADR-039) changes `login-and-org-setup` → `session-onboarding`. Entry assumes an
already-authenticated principal (identity from the verified `X-User-Id` header).

### D2 — `session_started` is the opening, self-contained event (L2)
The opening FlowEvent is `session_started{ user, org|null }`, carrying the **verified user**
(from re-verification, D4) and the org binding if the principal is a returning user. The
projection is **seeded from this event** — `begin()` never reads identity back from a
just-reset projection. This closes the §2.2 placeholder defect by construction (the user is
*in the event*, event-carried state transfer).

### D3 — `workosUserInfo` repurposed as token re-verification (L3)
The `workosUserInfo` invoke is KEPT but repurposed: it is no longer the authenticator; it is
a **defense-in-depth re-verification** of the forwarded Bearer (if a deployment misconfig
exposed `ui-state` to the open web, the WorkOS call independently validates user + token). The
`code → /oauth/token → /oauth/userinfo` persona-keyed exchange is replaced by a **direct
`GET /oauth/userinfo` authenticated with the forwarded Bearer**. `derivePersonaCode` and the
`/oauth/token` POST are deleted.

### D4 — Identity from the verified token, never client body (L4)
Re-verification uses the **forwarded Bearer token** (confirmed forwarded by auth-proxy —
`proxyToUpstream` passes all non-identity headers; `@bearer-forward` acceptance scenario
exists). The router (the Anti-Corruption Layer) takes identity from the verified `X-User-Id`
header and the Bearer; `persona_email` is **removed as a required production DTO field**,
closing the §2.5 production-path gap. `display_name` comes from the re-verify WorkOS profile
(L5) — auth-proxy need not forward a name claim.

### D5 — State-set change (L6)
- **Retire:** `anonymous`, `sign_in_clicked`, `auth_callback_resolved`, `auth_failed` (the
  last two were already dead machine events, removed in `79a9c01`; they now lose FlowEvent +
  reducer existence).
- **Collapse:** `anonymous` + `authenticating` → `verifying` (the re-verify invoke state).
- **Rename:** `authenticated_no_org` → `needs_org`.
- **Keep:** `creating_org`, `ready`, `expired_token`, `error_recoverable`, `error_terminal`.
- **Add:** `[hasOrg]` returning-user shortcut (`session_started` with non-null org →
  `ready` directly); `session_rejected` terminal for re-verify failure.

**`auth_ready` on the `[hasOrg]` path (ratified 2026-05-22).** A returning user reaching
`ready` via `verifying → ready` (no `creating_org` predecessor) MUST still fire the
`auth_ready` broadcast — returning users DO need project-context spawned. Today's
`isFirstReady` predicate (`strategy.ts:157`: `prior === "creating_org" || "anonymous" ||
!prior`) does not match `verifying → ready`; DELIVER extends it to include the `verifying`
predecessor. (Reviewer-flagged edge, user-resolved; see `event-model.md` Phase 3 + Spec 1.)

### D6 — `session_rejected` shape
Re-verify failure is a domain outcome surfaced as `projection.state = "session_rejected"`
over **HTTP 200** (the projection is the read-model contract; transport stays 200), with a
distinct `underlying_cause_tag` keeping it separable from org-setup errors. No `session_started`
is emitted; no user state advances. (Detail: `wave-decisions.md` OQ-2.)

### D7 — Context map relationship
`auth-proxy (Authentication)` → `ui-state (Session-Onboarding)` is **Customer-Supplier with
an ACL at the router**. The ACL rule enforced: identity from verified token/header, never a
client body claim (D4). `ui-state → WorkOS` is **Conformist via re-verification** (conforms to
the OIDC `/oauth/userinfo` shape; Pact-JS contract test recommended).

### D8 — `access_token` mint retained, relabeled (OQ-5)
`mintAccessTokenForReady` is retained as an explicitly **non-security** projection convenience
(it carries the org_id so the harness's `assert_jwt_carries_org_claim` can decode it; the
`alg:none` placeholder signature already signals "not a credential"). Recommended rename to
make non-security intent explicit. ADR-016 is honored — nothing verifies this string as auth.
Whether the **backend reissue call** is vestigial is flagged for empirical verification at
DISTILL (it may retire independently).

## Aggregate

One aggregate, **OnboardSession** (root entity, value-typed properties — Vernon's ~70%
root-only case). The aggregate is named as a noun/thing (`OnboardSession`); the flow/machine
that onboards it stays `session-onboarding` / `SessionOnboardingMachine` — a deliberate
aggregate-vs-flow-descriptor distinction (ratified by user 2026-05-22). Invariant cluster: a single principal's (verified user, org binding, settled
state) tuple is one consistency boundary; no second entity changes in the same transaction
(Org creation is a call to the backend Org aggregate in a separate context — referenced by id,
Vernon rule 3). Cross-aggregate signaling (the `auth_ready` broadcast to project-context) is
eventual-consistency via the pump (Vernon rule 4). Flow identity:
`flow_id = session-onboarding:<principal_id>` (ADR-030 §6).

## Considered options (the realignment shape)

1. **New context / new machine.** Rejected — `ui-state` is one bounded context (ADR-039); a
   new context is unjustified, and a new machine would duplicate the org-create/retry/
   silent-reauth subgraphs verbatim (Reuse Analysis R1).
2. **Patch the placeholder bug only (keep the auth vocabulary).** Rejected — it leaves the
   bounded-context leak in place; the vocabulary keeps misrepresenting where authentication
   happens, and the next contributor re-introduces the same class of confusion.
3. **Realign to session-onboarding (SELECTED).** Removes the leak, closes the defect by
   construction, and aligns the wire vocabulary with the actual responsibility.

## Consequences

**Positive**
- The placeholder defect is closed **by construction** (D2 — the user is in the opening event).
- The wire vocabulary stops misrepresenting authentication as a `ui-state` concern.
- Defense-in-depth re-verification is retained (D3) without `ui-state` being the authenticator.
- The `persona_email`-as-production-DTO gap (§2.5) is closed (D4).
- A genuine `session_rejected` path appears for invalid tokens (D6).

**Negative / accepted trade-offs**
- This is a **behavior change** (placeholder→real user, new rejection path, `[hasOrg]`
  shortcut), so it needs **RED acceptance coverage**, not characterization-only (seed §7;
  `wave-decisions.md` OQ-6). Three new RED scenarios are scoped for DISTILL.
- The rename touches the **ADR-039 canonical registry key** and the FE/harness path segments;
  mitigated by ADR-040 LEAF-2's alias map (no 404 window) and LEAF-6 alias removal.
- **Sequencing dependency:** lands AFTER ADR-040 LEAF-4/5/6 to avoid entangling with the
  in-flight hexagonal-transport series (seed §7).

## Open questions

1. Is the backend `/api/auth/reissue` call load-bearing, or vestigial given auth-proxy mints
   the org-scoped JWT fresh on the next request? Verify empirically at DISTILL (D8).
2. Final placement of the dev re-verify fixture — fake-workos vs a ui-state config seam
   (`wave-decisions.md` OQ-1, recommend fake-workos to keep the actor honest).

## References

- `docs/feature/session-onboarding/design-intent.md` (seed brief — problem, evidence, L1–L6)
- `docs/feature/session-onboarding/design/{wave-decisions.md, c4-diagrams.md, event-model.md}`
- `ui-state/lib/machines/login-and-org-setup/{machine.ts, strategy.ts, router.ts}`
- `ui-state/lib/projection.ts`; `auth-proxy/app.ts` (`/ui-state/*` handler, `proxyToUpstream`)
- ADR-016, ADR-027, ADR-028, ADR-029, ADR-030, ADR-039, ADR-040
</content>
