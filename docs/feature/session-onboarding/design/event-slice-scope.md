# Vertical-Slice Scope — `/event` flow to `/begin` parity

**Wave:** DESIGN (brownfield delta) · **Date:** 2026-05-24 · **Author:** Hera (nw-ddd-architect)
**Status:** RATIFIED 2026-05-24 (OQ-E1 enforce·403, OQ-E2 function, OQ-E3 incremental) — ready for DISTILL
**Subject:** Bring the `/event` endpoint + its flow to parity with the realigned `/begin`
slice under the current domain-model organizing pattern (ADR-041 / ADR-040).
**Extends (does NOT duplicate):** `event-model.md` (Specs 4/5 reused), `wave-decisions.md`
(OQ-5 inherited), `design-intent.md`, ADR-040/041, ADR-035.

This is a **delta scope** against the already-shipped `/begin` slice. It does not re-open
the domain realignment; it closes the transport-side asymmetry between `/begin` (which was
brought to the pattern) and `/event` (which was not).

---

## 1. Slice intent

`/begin` was realigned into the current pattern: a zod request DTO
(`beginRequestSchema`, `router.ts:88-100`), ACL identity translation (identity from the
verified `X-User-Id` header + forwarded Bearer, **never a body claim** — `router.ts:149-164`),
structured audit logging (`session_onboarding.org_claim`, `router.ts:170-175`), and a
first-class transport-side command object (`SessionOnboardingBeginStrategy`,
`strategy.ts:244`). `/event` (`router.ts:201-244`) does **none** of this: it inline-types
the body, hand-validates with `if (!body.flow_id || !body.type)`, trusts `body.flow_id` as
the aggregate identity **without checking it against the verified principal**, and spreads
the raw wire `payload` straight into the XState actor (`orchestrator.ts:746`). "Parity"
means `/event` translates wire vocabulary → domain command vocabulary **at the ACL
boundary**, derives the aggregate identity from the verified principal (the same ACL rule
`/begin` enforces), validates the inbound command shape with a zod DTO, and validates the
`__force_failure__.tag` against the `UnderlyingCauseTag` union — so the OnboardSession
aggregate is driven only by well-formed, principal-authorized commands.

---

## 2. Current vs. target (gap per layer)

| Layer | `/begin` (the pattern) | `/event` (current) | Target for `/event` |
|---|---|---|---|
| **Transport DTO** | `beginRequestSchema` zod parse → 400 with issues (`router.ts:151-163`) | inline TS type + manual `if (!body.flow_id \|\| !body.type)` (`router.ts:204-217`) | `eventRequestSchema` zod parse → 400 with issues |
| **ACL identity** | identity from `c.get("userId")` / `c.get("bearerToken")`, never a body claim (`router.ts:154-156`, L4) | identity IGNORED; `flow_id` taken raw from body (`router.ts:215, 236`) | derive expected `flow_id` from the verified principal; reject mismatch (cross-principal guard) |
| **Command vocabulary** | wire → domain command object `SessionOnboardingBeginStrategy` (`router.ts:182-196`) | raw `type` + `payload` forwarded verbatim to `flowOrchestrator.send` (`router.ts:236-242`) | translate wire event → a typed inbound-command shape at the ACL (see §3) |
| **Payload translation** | n/a (begin has no inbound user payload) | `payload` spread untouched into the actor (`orchestrator.ts:746`); `org_name` arrives raw `string`; `OrgName` VO built deep in guard (`guards.ts:28-31`) | shape-validate the payload per event type at the ACL (presence of `org_name`; `tag ∈ UnderlyingCauseTag`) — VO construction stays in the guard/action (constraint §IMPORTANT) |
| **Failure-sim gate** | `shouldInject(KNOB.forceReissueFailures…)` gates a body knob (`router.ts:177-181`) | `shouldInject(KNOB.forceFailureOnAuthRetry…)` gates `__force_failure__` presence only (`router.ts:219-234`) — does NOT validate `.tag` | keep the gate; ADD `tag ∈ UnderlyingCauseTag` validation at the boundary |
| **Audit logging** | structured `session_onboarding.org_claim` log (`router.ts:170-175`) | none | structured `session_onboarding.event_received` log (event type + principal + flow_id + correlation) |
| **Machine transitions** | `verifying → ready/needs_org/session_rejected` (`machine.ts:80-105`) | `org_form_submitted` in `needs_org` only (`machine.ts:108-129`); `retry_clicked` in `error_recoverable` only (`machine.ts:178-190`); `__force_failure__` in `needs_org` only (`machine.ts:122-128`) | **UNCHANGED** — machine transitions are already at the pattern; XState silently ignores events in non-handling states (`orchestrator.ts:745` comment) |
| **Emitted events** | `session_started` / `session_rejected` (`strategy.ts:286-361`) | `org_created` / `validation_failed` / `reissue_failed_partial` already emitted in `settle(...)` (`strategy.ts:102-168`) | **UNCHANGED** — settle-side emission is already at the pattern |
| **Domain model** | outputs richly modeled (`VerifiedUser`/`Org`/`VerifiedSession`); failure vocab (`domain.ts:108-183`) | INBOUND commands (SubmitOrgName/RetrySetup) not first-class | see §3 — recommended verdict: **stays at the ACL, not in `setup/domain.ts`** |

**Key asymmetry, stated plainly.** The composition root middleware
(`index.ts:96-108`, `router.use("*", …)`) **already** sets `userId`, `bearerToken`,
`orgId`, and `body` context vars on EVERY route — including `/event`. The ACL identity
infrastructure exists; `/event` simply does not consume it. Parity is therefore mostly a
matter of *reading what is already there*, not building new plumbing.

---

## 3. Domain-model decisions

### Decision D-E1 — The inbound command vocabulary stays at the ACL, NOT in `setup/domain.ts`. (anemic-but-correct)

**Verdict: nothing new belongs in `setup/domain.ts` for the command surface.** Add a zod
DTO + a thin translation function at the **router (ACL)** layer instead. This is the
correct DDD answer, not a compromise.

**Justification (DDD rigor):**

- **The aggregate's invariants are about OUTPUTS, not inbound command shape.** The
  OnboardSession invariant cluster (event-model.md "Aggregate boundary") is the
  *(verified user, org binding, settled state)* tuple. The inbound commands
  `SubmitOrgName` and `RetrySetup` carry no invariant the *aggregate* must protect — they
  are requests to transition. `SubmitOrgName`'s only domain rule (the org-name shape rule)
  **already lives on a value object** (`constructOrgName`, `domain.ts:97-106`) that the
  guard consults. Promoting `SubmitOrgName` to a domain type would not move that rule; it
  would only add a second home for it. There is no second invariant to model.

- **The role boundary is already correct and must be respected** (`domain.ts:13-20`): the
  value object EVALUATES, the guard ROUTES, the action WRITES. A command DTO at the ACL is
  a *fourth* role — the **ACL TRANSLATES** wire → domain — which is exactly where DDD puts
  boundary translation (Translation pattern, ACL). Putting command validation in the
  domain model would blur the ACL's job into the core.

- **Serialization constraint forbids rich command objects in context anyway**
  (`domain.ts:22-28`). Anything that reaches the actor is spread into context-bound XState
  events and round-trips through Redis; it must be a plain serializable shape. A
  behavior-bearing `SubmitOrgName` value object could never *be* the wire event — it would
  have to be flattened at the boundary regardless. So the boundary is the honest home.

- **Asymmetry with `/begin` is justified, not a gap.**
  `SessionOnboardingBeginStrategy` is a first-class command object because begin has
  genuine **orchestration** behavior: reset the log, start the actor, await the verify
  settle, branch on settled state, emit `session_started`/`session_rejected`
  (`strategy.ts:286-361`). `/event` has no equivalent orchestration — it forwards one
  event to an already-running actor and lets `settle(...)` emit. A command *class* for
  `/event` would be a ceremony with an empty body. **The consistent analogue is a typed
  translation at the ACL, not a class.** (See §6 OQ-E2 for the one place a class might earn
  its keep.)

**What this means concretely:**
- `setup/domain.ts` — **no change.**
- `setup/types.ts` — **no change** to the machine event union
  (`SessionOnboardingEvent`, `types.ts:80-83`); it is already correct. (One *optional*
  reuse: export `isUnderlyingCauseTag` from `domain.ts` so the ACL can validate
  `__force_failure__.tag` against the SAME closed set — see D-E2.)
- `router.ts` — **add** `eventRequestSchema` (zod) + a `translateWireEvent` ACL function.

### Decision D-E2 — Validate `__force_failure__.tag` against `UnderlyingCauseTag` at the ACL, reusing the domain's closed set.

`domain.ts:175-183` already owns `isUnderlyingCauseTag` (currently private — used by
`causeOf`). The ACL should validate the inbound `tag` against this **same** predicate so
the boundary and the failure-vocabulary never drift. **Recommended:** export
`isUnderlyingCauseTag` from `domain.ts` (a one-line `export`); the ACL imports it. This is
the only `setup/domain.ts` touch, and it is an *export widening*, not new modeling — the
domain remains the SSOT for its own failure vocabulary. An invalid tag → 400 at the
boundary (it must never reach `tagCause`, `machine.ts:122-128`).

### Decision D-E3 — Derive aggregate identity from the verified principal; the body `flow_id` is corroborated, not trusted.

`flow_id = session-onboarding:<principal_id>` (event-model.md "Stream / flow identity").
The principal is `c.get("userId")` (the verified `X-User-Id`, set by `index.ts:101`). The
ACL should compute the expected `flow_id` from the verified principal and **reject a body
`flow_id` that does not match** (the same L4 ACL rule `/begin` enforces: identity from the
verified header, never a body claim). This closes a latent cross-principal gap: today any
caller can post an event to *any* `flow_id` (`router.ts:215`).

> **Note for ratification (OQ-E1, §6):** the FE/harness currently send `flow_id` in the
> body and do NOT send `X-User-Id` on `/event` in every harness path. Tightening this is a
> behavior change at the transport contract; it needs the user's call on enforce-vs-warn
> and a harness audit. Flagged, not assumed.

---

## 4. Thin vertical slices (ordered, each independently shippable)

Ordering rationale: Slice 1 establishes the DTO seam with **zero behavior change**
(pure refactor under characterization tests) so later slices add validation on a stable
base. Slices 2-3 add the missing test coverage that *characterizes* current behavior
before Slice 4-5 *change* it. Slices 4-5 add new boundary validation (behavior change →
RED first).

### Slice 1 — Introduce `eventRequestSchema` (zod DTO) — behavior-preserving

**Files:** `ui-state/lib/machines/session-onboarding/router.ts`
**Delta:** Replace the inline body type + manual `if (!body.flow_id || !body.type)`
(`router.ts:204-217`) with a zod `eventRequestSchema` (`{ flow_id, machine?, type, payload? }`,
`.passthrough()` on payload), mirroring `beginRequestSchema`. Same 400 surface, now with
`issues`. No identity change yet, no tag validation yet. Add the structured
`session_onboarding.event_received` audit log (analogue of `org_claim`).
**G/W/T seed (characterization — current behavior preserved):**
```
GIVEN  an onboarding flow exists at flow_id "session-onboarding:u2" in needs_org
WHEN   POST /event { flow_id, type: "org_form_submitted", payload: { org_name: "Acme Data" } }
THEN   HTTP 200 AND projection.state == "ready"            (Spec 4, unchanged)

GIVEN  any request
WHEN   POST /event { type: "org_form_submitted" }          (no flow_id)
THEN   HTTP 400 with error == "invalid_request" AND issues[] names flow_id
```
> Iron Rule flag: the existing 400-on-missing-field behavior is **untested** at the HTTP
> layer (no test exercises `router.ts:215-217`). Write the 400 characterization test
> BEFORE the refactor so Slice 1 is provably behavior-preserving.

### Slice 2 — Characterize `retry_clicked` over `/event` at the HTTP layer

**Files:** `ui-state/index.test.ts` (test-only)
**Delta:** No production change. `retry_clicked` is exercised at the machine
(`machine.test.ts:303-304`) and orchestrator (`orchestrator.test.ts:192-211`) levels but
**never through the `/event` HTTP transport**. Add the missing characterization coverage so
later slices that touch the handler are safe.
**G/W/T seed (reuses event-model.md retry-budget path; NEW at HTTP layer):**
```
GIVEN  a flow driven to error_recoverable (org-create budget exhausted, partial-setup)
WHEN   POST /event { flow_id, type: "retry_clicked", payload: {} }  ×3
THEN   HTTP 200 each AND projection.state transitions error_recoverable → … → error_terminal
  AND  projection.context.retry_budget_used_count == 3
```

### Slice 3 — Characterize `__force_failure__` over `/event` (the gate + the happy path)

**Files:** `ui-state/index.test.ts` (test-only); test harness failure-sim knob config
**Delta:** No production change. The gate at `router.ts:219-234` (403 when the
failure-sim knob is disabled; pass-through when enabled) has **zero HTTP-layer coverage**
(grep: no test references `__force_failure__` or `403` in `index.test.ts`). Add both arms.
**G/W/T seed (NEW — closes the untested gate; ADR-035):**
```
GIVEN  the failure-simulation knob is DISABLED (production default)
WHEN   POST /event { flow_id, type: "__force_failure__", payload: { tag: "transient" } }
THEN   HTTP 403 AND the body explains the gate is disabled
  AND  no force-failure event reaches the actor

GIVEN  the failure-simulation knob is ENABLED (ENVIRONMENT=dev|ci + flag)
  AND  a flow in needs_org
WHEN   POST /event { flow_id, type: "__force_failure__", payload: { tag: "transient" } }
THEN   HTTP 200 AND projection.state == "error_recoverable"
  AND  projection.context.underlying_cause_tag == "transient"
```
> Brownfield discipline: Slices 2-3 are **characterization tests for untested transitions**
> — they MUST land before Slices 4-5 modify the handler. This is the brownfield analog to
> the walking skeleton (CLAUDE.md Iron Rule).

### Slice 4 — Validate `__force_failure__.tag` against `UnderlyingCauseTag` at the ACL — behavior change

**Files:** `router.ts`; `setup/domain.ts` (export `isUnderlyingCauseTag`); `index.test.ts`
**Delta:** After the gate passes (Slice 3), validate `payload.tag` against the domain's
closed set (D-E2). An invalid/absent tag → 400, never reaching `tagCause`
(`machine.ts:122-128`). Export `isUnderlyingCauseTag` from `domain.ts` and import it at the
ACL so the boundary and the failure vocabulary share one source of truth.
**G/W/T seed (NEW — boundary validation):**
```
GIVEN  the failure-simulation knob is ENABLED AND a flow in needs_org
WHEN   POST /event { flow_id, type: "__force_failure__", payload: { tag: "not-a-cause" } }
THEN   HTTP 400 with error == "invalid_request"
  AND  projection.state is UNCHANGED (still needs_org)
  AND  no force-failure event reaches the actor
```

### Slice 5 — ACL identity translation: derive `flow_id` from the verified principal — behavior change

**Files:** `router.ts`; `index.test.ts`
**Delta:** Read `c.get("userId")` (verified `X-User-Id`); compute
`expected = \`session-onboarding:${userId}\``; reject a body `flow_id` that does not match
(D-E3). This is the L4 ACL rule for `/event`. Add a `translateWireEvent` ACL helper that
returns the typed inbound command (event type + validated payload) the orchestrator's
`send` consumes — the structural analogue of `/begin`'s command construction.
**G/W/T seed (NEW — cross-principal guard; behavior change, RED first):**
```
GIVEN  the verified principal is X-User-Id == "u2" (flow session-onboarding:u2 in needs_org)
WHEN   POST /event { flow_id: "session-onboarding:u9", type: "org_form_submitted", … }
THEN   HTTP 403  — the flow_id does not belong to the verified principal
  AND  no event reaches u9's actor

GIVEN  the verified principal is X-User-Id == "u2"
WHEN   POST /event { flow_id: "session-onboarding:u2", type: "org_form_submitted",
                     payload: { org_name: "Acme Data" } }
THEN   HTTP 200 AND projection.state == "ready"     (Spec 4 — unchanged behavior, now authorized)
```
> **OQ-E1 RATIFIED 2026-05-24: ENFORCE (403).** Slice 5 rejects a mismatched body `flow_id`
> with 403 (no warn-only fallback). The FE + TS-harness audit (confirm `X-User-Id` is sent on
> every `/event` path) is a WORK ITEM INSIDE this slice — the acceptance suite fails loudly on
> any client that omits it, so the audit is test-driven, not a precondition.

### Slice 6 (optional) — `payload` shape validation per event type at the ACL

**Files:** `router.ts`; `index.test.ts`
**Delta:** Validate `org_form_submitted` carries a `payload.org_name: string` at the
boundary (presence/type only — the **shape rule** stays on `constructOrgName`, the **route**
stays in the guard). This stops a malformed payload (`org_name` missing/non-string) from
reaching the actor as a silent no-op. Distinct from Slice 4 (tag) and orthogonal; ship last
or fold into Slice 1's schema as a discriminated union if the team prefers one DTO.
**G/W/T seed (NEW — boundary type-check, NOT the domain shape rule):**
```
GIVEN  a flow in needs_org
WHEN   POST /event { flow_id, type: "org_form_submitted", payload: {} }   (org_name absent)
THEN   HTTP 400 with error == "invalid_request"  (boundary rejects malformed command)
  AND  contrast: POST … payload { org_name: "" }  STILL → 200 + validation_failed{empty}
       (the empty-string DOMAIN rule stays on the value object, Spec 5 — NOT promoted to the ACL)
```
> This slice encodes the value-object boundary explicitly: the ACL checks *well-formedness
> of the command* (is `org_name` a string at all); the value object checks *the domain rule*
> (is the string a valid org name). Keep them separate (constraint §IMPORTANT, D-E1).

---

## 5. Test parity check

Suite: `ui-state` vitest. Run: `cd ui-state && npx vitest run`. Two test homes:
- **HTTP/ACL transport + Event-Model specs** → `ui-state/index.test.ts`
- **Orchestrator send/freeze/replay** → `ui-state/lib/orchestrator.test.ts`
- **Machine transitions** → `ui-state/lib/machines/session-onboarding/machine.test.ts`

| Slice | Coverage today | Action | Where |
|---|---|---|---|
| 1 (DTO refactor) | Spec 4/5/7 happy+validation covered (`index.test.ts:193-279`); **400-on-missing-field UNCOVERED** | Add 400 characterization THEN refactor | `index.test.ts` |
| 2 (`retry_clicked` HTTP) | machine `:303` + orchestrator `:192`; **HTTP transport UNCOVERED** | Add characterization | `index.test.ts` |
| 3 (`__force_failure__` HTTP) | machine `:353`; **HTTP gate (403/200) UNCOVERED** | Add both gate arms | `index.test.ts` |
| 4 (tag validation) | none | Add RED boundary-validation test | `index.test.ts` |
| 5 (identity translation) | `/begin` identity covered; `/event` identity UNCOVERED | Add RED cross-principal test | `index.test.ts` |
| 6 (payload shape) | Spec 5 domain rule covered; ACL well-formedness UNCOVERED | Add RED boundary test | `index.test.ts` |

**Untested transitions requiring characterization FIRST (Iron Rule / brownfield):**
1. `/event` 400 on missing `flow_id`/`type` (`router.ts:215-217`) — Slice 1 precondition.
2. `retry_clicked` through `/event` (`router.ts:236-242` + `machine.ts:178-190`) — Slice 2.
3. `__force_failure__` gate both arms through `/event` (`router.ts:219-234`) — Slice 3.

These three are the brownfield "walking skeleton" for the handler: land them before any
handler edit. Slices 4-6 are genuine behavior changes → RED acceptance first (not
characterization), per CLAUDE.md Outside-In TDD.

---

## 6. Open questions / risks (ratify before DISTILL)

- **OQ-E1 — Cross-principal `/event` identity enforcement — RATIFIED 2026-05-24: ENFORCE (403).**
  Today `/event` trusts the body `flow_id` and never reads the verified principal
  (`router.ts:215`). Slice 5 tightens to "derive `flow_id` from `X-User-Id`, reject mismatch"
  (D-E3) — the correct L4 ACL rule, the same one `/begin` enforces. The FE + TS-harness audit
  (confirm `X-User-Id` is sent on every `/event` path, incl.
  `tests/acceptance/user-flow-state-machines/harness/`) is a WORK ITEM INSIDE Slice 5, not a
  blocker: the acceptance suite surfaces any client that omits the header (fails loudly). No
  longer blocks DISTILL.

- **OQ-E2 — Command object vs. ACL function for `/event` — RATIFIED 2026-05-24: FUNCTION.**
  Slice 5 adds a typed ACL translation **function** (`translateWireEvent`), NOT a
  `SessionOnboardingEventCommand` class. `/event` has no orchestration to justify a class
  (D-E1); structural symmetry with `SessionOnboardingBeginStrategy` is deliberately not
  pursued — a class would be a near-empty wrapper.

- **OQ-E3 — `payload` envelope vs. flat event (DTO sizing) — RATIFIED 2026-05-24: INCREMENTAL.**
  The wire sends `{ type, payload: { org_name } }` but the actor receives `{ type, ...payload }`
  (`orchestrator.ts:746`). DTO validation lands **incrementally** (thin-slice discipline):
  Slice 1 a minimal `eventRequestSchema` (`flow_id`/`type` presence + passthrough payload),
  Slice 4 adds `tag` validation, Slice 6 adds `org_name` well-formedness — NOT one
  discriminated-union schema up front. Keeps each slice independently shippable.

- **Risk — `orchestrator.send` is machine-agnostic.** The spread at `orchestrator.ts:746`
  serves ALL machines (project-context, session-chat). Any payload-translation MUST stay in
  the session-onboarding **router**, not in the shared orchestrator, or it leaks
  session-onboarding vocabulary into the generic send path (would violate the ADR-028
  "no machine knows another" seam). All §4 slices touch `router.ts` only — preserve that.

- **Risk — `__force_failure__` source-state mismatch.** The machine handles
  `__force_failure__` ONLY in `needs_org` (`machine.ts:122`); XState silently ignores it
  elsewhere (`orchestrator.ts:745`). The router gate does not know the source state, so a
  gated-but-ignored `__force_failure__` returns 200 with an unchanged projection. This is
  pre-existing and out of scope, but Slice 3's characterization should assert the
  needs_org precondition explicitly so the silent-ignore behavior is documented, not
  discovered later.

---

## Addendum note for `event-model.md`

The inbound commands `SubmitOrgName` (Spec 4/5) and `RetrySetup` (Phase 3 "Org-create
retry") are already modeled. This scope adds **no new domain events** — it adds
**boundary-validation specs** for those existing commands (tag well-formedness, payload
well-formedness, principal authorization). No `event-model.md` event-vocabulary change is
required; the command modeling is complete. The `__force_failure__` / retry-budget G/W/T
seeds in §4 above are the transport-layer specs DISTILL should add to the suite, derived
from the existing model — not new model elements.
