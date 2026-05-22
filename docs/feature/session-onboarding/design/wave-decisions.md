# Wave Decisions — session-onboarding (DESIGN, propose mode)

**Wave:** DESIGN (Domain / bounded-contexts scope) · **Date:** 2026-05-22 · **Author:** Hera (nw-ddd-architect)
**Status:** RATIFIED by user 2026-05-22 (passed nw-ddd-architect-reviewer review). See §8 for ratification deltas (aggregate rename, auth_ready edge resolved, reviewer follow-ups folded in).
**Subject:** brownfield REFACTOR + domain-model correction of `ui-state/lib/machines/login-and-org-setup/` → `session-onboarding`
**Primary input:** `docs/feature/session-onboarding/design-intent.md` (seed brief)
**Companion deliverables:** `c4-diagrams.md`, `event-model.md`, ADR-041, ADR-042; `docs/product/architecture/brief.md` §"Domain Model — session-onboarding"

---

## 0. Key Decisions (locked, honored — not relitigated)

L1–L6 from the seed brief §5 are user-ratified and are the contract this DESIGN obeys. They
are restated in ADR-041's Decision section. This document does NOT re-open them; it resolves
the six OPEN questions §6 left to the wave.

> **CONTRADICTION CHECK (per CONSTRAINTS).** No contradiction found between L1–L6 and any
> ADR or the J-001 journey. One **strong alignment-with-amendment** is surfaced for
> ratification (OQ-4 below): the seed brief frames ES-vs-store as open, but **ADR-040
> (Accepted) already adopted the server-authoritative store** for the entire `ui-state`
> context as the "tripwire exit." This is not a contradiction with a locked decision — it
> *strengthens* the store recommendation and removes ambiguity. Flagged explicitly so the
> user ratifies the inheritance rather than re-deciding.

---

## 1. Architecture Summary

### Bounded-context decision

`ui-state/` remains **one bounded context** (ADR-039 TL;DR: the project-context /
session-chat / login split is an SRP partition inside one ubiquitous language, not a
context-map boundary). This feature does **not** create a new context. It performs a
**domain-language correction** inside the existing context and sharpens the **context map
relationship** between two *already-distinct* contexts:

- **Authentication context** (owned by `auth-proxy`) — token SSOT (ADR-016). Owns the WorkOS
  handshake, JWT verification, identity-header injection, Bearer forwarding.
- **Session-Onboarding context** (the realigned machine, inside `ui-state`) — owns bringing
  an *already-authenticated* principal to an org-scoped app-ready state.

The defect (§1–§2 of the seed brief) is fundamentally a **bounded-context leak**: the
machine modeled an authentication handshake that belongs to the Authentication context and
already completed upstream. Realigning it removes the leak.

### Context map relationship

`auth-proxy (Authentication)` → `ui-state (Session-Onboarding)` is **Customer-Supplier with
an Anti-Corruption Layer at the router**:

- Customer-Supplier: auth-proxy is upstream (supplier of verified identity); session-onboarding
  is downstream (customer). The contract is the injected header set + forwarded Bearer.
- ACL: the `/flow/session-onboarding/*` router translates the supplier's wire vocabulary
  (`X-User-Id`, `Authorization: Bearer`) into the domain's language (`principal_id`,
  `session_started{user, org}`). **The ACL rule this feature enforces:** identity comes from
  the verified token / verified headers, never a client body claim (L4) — closing the §2.5
  `persona_email`-as-DTO production gap.

`ui-state (Session-Onboarding)` → `WorkOS` is **Conformist via re-verification** (ui-state
conforms to the OIDC `/oauth/userinfo` response shape; contract-test recommended).

`ui-state (Session-Onboarding)` → `backend (Org/Project)` is **Customer-Supplier** (org
creation + reissue via OpenAPI-contracted endpoints) — unchanged.

### Architectural style

Hexagonal (ADR-040) — preserved verbatim. This feature touches the **domain core** (machine
+ strategy + reducers) and the **driving ACL adapter** (router), not the port/adapter
shapes. The `SettledStateStore` driven read-port (ADR-040 D3) is inherited.

---

## 2. Reuse Analysis (MANDATORY HARD GATE)

Default verdict is **EXTEND**. **CREATE NEW requires evidence.** Every existing component
with overlapping responsibility is enumerated. "EXTEND" here means *modify in place /
rename / repurpose the existing artifact*; "CREATE NEW" means *add a net-new artifact*.

| # | Existing component | File | Overlapping responsibility | Verdict | Justification |
|---|---|---|---|---|---|
| R1 | `LoginAndOrgSetupMachine` (`createLoginAndOrgSetupMachine`) | `ui-state/lib/machines/login-and-org-setup/machine.ts` | The state chart for the flow | **EXTEND (rename + reshape)** | Same aggregate, same XState `setup`/`createMachine` skeleton, same org-create/retry/expired-token subgraphs. The change is vocabulary (rename to `SessionOnboardingMachine`), state-set (collapse `anonymous`+`authenticating`→`verifying`; add `[hasOrg]` + `session_rejected`; rename `authenticated_no_org`→`needs_org`), and the `workosUserInfo` input (Bearer not persona-code). A new machine would duplicate the org-create/retry/silent-reauth subgraphs verbatim — no evidence justifies that. |
| R2 | `loginOrgSetupStrategy` + `LoginBeginStrategy` | `ui-state/lib/machines/login-and-org-setup/strategy.ts` | `FlowStrategy` port impl + begin semantics + settle/emit | **EXTEND (rename + correct begin)** | The strategy carving (ADR-040 LEAF-3) already landed and is sound. `begin()` is corrected to seed the projection from `session_started` (L2) instead of reading user back from a just-reset projection — this is the defect fix, an *edit to existing begin*, not a new strategy. `settle`'s emit arms are renamed (`org_created_and_jwt_reissued`→`org_created` per OQ-3) but keep the same structure. |
| R3 | `buildProjection` + EVENT_HANDLERS | `ui-state/lib/projection.ts` | The read-model fold | **EXTEND (reducer set edit)** | Add `session_started` + `session_rejected` reducers; retire `sign_in_clicked`/`auth_callback_resolved`/`auth_failed` reducers (OQ-3). The dispatch-table pattern is reused as-is. Note: under ADR-040 LEAF-5 the *event-log rebuild* path is replaced by the store, but the reducer LOGIC is retained as the store's projection-shape source (ADR-040 D3 keeps the read-path contract). No new projection module. |
| R4 | `createWorkOSUserInfoActor` | `ui-state/lib/machines/login-and-org-setup/machine.ts:406` | The WorkOS call | **EXTEND (repurpose)** | L3 KEEPS this invoke. Repurpose: drop the `code→token` exchange (`derivePersonaCode`, the `/oauth/token` POST), keep the `/oauth/userinfo` GET but authenticate it with the **forwarded Bearer** (L4) instead of a fixture code header. Same actor type, same `WorkOSProfile` output. A new actor would re-create the fetch/parse/error-classify scaffolding. `derivePersonaCode` (machine.ts:653) **becomes dead code → DELETE**. |
| R5 | `login-and-org-setup/router.ts` | `ui-state/lib/machines/login-and-org-setup/router.ts` | The ACL / HTTP transport | **EXTEND (rename + DTO change)** | Rename to `session-onboarding`; drop `persona_email` from `loginRequestSchema` required fields (L4); thread the forwarded Bearer into the begin strategy. The `/event`, `/open-deep-link`, `mountUniformFlowRoutes` wiring is reused. ADR-040 LEAF-2 alias-map mounts the legacy `/flow/login-and-org-setup` path during migration so the FE/harness don't 404. |
| R6 | `FlowEventLog` (Redis Streams adapter) | `ui-state/lib/persistence/redis.ts` | Append-only flow-event persistence | **EXTEND (no change here; superseded by ADR-040 LEAF-5)** | This feature does NOT touch the persistence substrate. Per ADR-040 LEAF-5 the event-log read path is replaced by `SettledStateStore` context-wide; session-onboarding inherits that and lands AFTER it (§7 sequencing). No session-onboarding-specific persistence work. |
| R7 | `BeginFlowOrchestrator` | `ui-state/lib/orchestrator.ts` | begin tracking (enter/begin/exit) | **EXTEND (no change)** | The orchestrator's begin-tracking is machine-agnostic; the renamed begin strategy plugs into it unchanged. No edit needed. |
| R8 | `harvestSettledLoginState` | `ui-state/lib/orchestrator-harvester.ts` | snapshot-read boundary for settle emission | **EXTEND now / DELETE under ADR-040 LEAF-5** | The settle path still harvests org/user from the snapshot today (strategy.ts:118). The `session_started`-seeds-projection change (L2) reduces but does not by itself remove the harvest at the `ready`/`error_recoverable` settle arms. ADR-040 LEAF-5 deletes the entire `harvestSettled*` family by construction (store model). Verdict: **leave in place for the session-onboarding rename; it dies with LEAF-5, not with this feature.** Do NOT pre-delete (entangles with the in-flight LEAF series — §7). |
| R9 | `mintAccessTokenForReady` | `ui-state/lib/machines/login-and-org-setup/strategy.ts:59` | synthesize a JWT-shaped access_token for the projection | **CREATE-NEW decision deferred to OQ-5** | This is the one component whose fate is a genuine open question (vestigial vs real). See §3 OQ-5. Default-bias: **EXTEND-by-retaining** (lowest risk) unless the user ratifies removal. Not a CREATE-NEW; the question is keep-vs-delete. |
| R10 | `createOrgFn`/`reissueOrgJwtFn`/`createOrgAndReissueActor` + forced-failure variant | `ui-state/lib/machines/login-and-org-setup/strategy.ts:465-646` | org-create + reissue + harness failure injection | **EXTEND (no change / OQ-5-dependent)** | The org-create path is orthogonal to the auth correction and is reused verbatim. Only the *reissue* half is implicated by OQ-5 (if reissue is vestigial, `reissueOrgJwtFn` + the reissue step in `createOrgAndReissueFn` retire). Hold pending OQ-5. |

**Reuse verdict summary:** 0 net-new domain artifacts mandated; 1 deletion (`derivePersonaCode`,
R4), 2 deletions deferred to other waves (`harvestSettled*` via ADR-040 LEAF-5; reissue path
pending OQ-5). Everything else is EXTEND. This is a correction-in-place, not a rebuild.

---

## 3. Open-Question Resolutions (each: PROPOSED — pending user ratification)

### OQ-1 — Dev / fake-workos token path → **RECOMMEND: Option B (fake-workos accepts the dev token at `/oauth/userinfo`)**

**Trade-off that drove it:** skipping re-verify in dev (Option A) would mean the dev path
exercises a *different* code path than prod (the exact divergence ADR-016 warns against);
accepting a dev token at fake-workos keeps prod-fidelity at near-zero cost.

| Option | Behavior in dev | Trade-off |
|---|---|---|
| **A — skip re-verify in dev** | `AUTH_MODE=dev` short-circuits `verifying`; emit `session_started` directly from injected DEV_USER headers. | Simplest, but dev exercises a branch prod never runs (ADR-016 anti-pattern); `session_rejected` becomes dev-unreachable AND the verify-actor itself goes untested in dev/ci. |
| **B — fake-workos `/oauth/userinfo` accepts `dev-token-static` (RECOMMENDED)** | The verify actor runs in dev; fake-workos returns the DEV_USER profile for the dev Bearer (or a configured fixture). auth-proxy already injects identity; the dev Bearer is the static `dev-token-static`. | Prod-fidelity: same `verifying → /oauth/userinfo → session_started` path in dev and prod. Cost: fake-workos gains one fixture mapping (dev token → DEV_USER profile). `session_rejected` is reachable in ci by feeding a bad token. |
| **C — dev injects a real-shaped token + JWKS** | Mint a dev JWT and verify via JWKS in dev. | Highest fidelity but pulls real JWKS infra into dev; over-engineered for the planning horizon. |

**Spec change vs today:** the actor switches from `code → /oauth/token → /oauth/userinfo`
(persona-keyed exchange) to a **direct `GET /oauth/userinfo` with the forwarded Bearer**.
In dev, the forwarded Bearer is `dev-token-static`; fake-workos maps it to DEV_USER.
`derivePersonaCode` + the `/oauth/token` POST are deleted (R4). **Open sub-point for the
user:** confirm fake-workos is the right place for the dev fixture vs. a ui-state config
seam — recommend fake-workos to keep the actor honest (it makes a real userinfo call).

### OQ-2 — `session_rejected` shape → **RECOMMEND: HTTP 200 + projection.state="session_rejected", distinct from org-setup errors**

**Trade-off that drove it:** the projection is the read-model contract (ADR-030/ADR-040);
returning a non-200 from `/begin` on a *domain* rejection would split the contract (FE/harness
read state from the body, not the status). Keep the transport 200; encode the rejection in
the projection — *consistent with how every other terminal state surfaces.*

| Facet | Recommendation | Rationale |
|---|---|---|
| HTTP status of `/begin` | **200** with the rejected projection body | Re-verify failure is a *domain outcome*, not a transport error. (Contrast: a missing/garbled token never reaches ui-state — auth-proxy 401s it in prod.) The FE/harness already read `projection.state`. |
| projection.state | **`session_rejected`** (new terminal) | Distinct from `error_recoverable` (transient, retryable) and `error_terminal` (retries exhausted) — a rejected session is neither; it's "this identity/token is not valid here." |
| projection.context | `underlying_cause_tag: "session_rejected"` (or finer: `"token_invalid"`/`"user_not_found"`) + NO user/org | Reuses the `_tag` discriminator convention (ADR-039 C9). Distinct tag space keeps it separable from org-setup `partial-setup`/validation tags. |
| Distinctness from org-setup errors | session_rejected is **pre-org**, terminal, no retry CTA → "sign in again"; org-setup errors are **post-identity**, recoverable. | The FE renders different surfaces; the harness asserts `state == "session_rejected"` not `error_recoverable`. |

**Alternative considered:** 401 from `/begin`. Rejected — it would make the harness branch on
status code for a domain state and break the "projection is the single read shape" contract.

### OQ-3 — `session_started` reducer + full reducer set → **RECOMMEND: self-contained `session_started{user, org|null}`; replicate `[hasOrg]` in the projection; retire 3 reducers**

**Trade-off that drove it:** event-carried-state-transfer (self-contained event) is what
closes the placeholder defect — the reducer must NOT need to look anything up; the user is
*in the event* (L2).

**`session_started` payload (PROPOSED):**
```
session_started {
  user: { email, display_name, first_name },   // from the re-verify WorkOS profile (L5)
  org:  { id, name } | null,                     // org binding if returning user, else null
}
```

**`session_started` reducer (PROPOSED):**
```
session_started: (_state, context, event) => {
  const user = event.payload.user;
  const org  = event.payload.org;            // null for new users
  return {
    state: org && org.id ? "ready" : "needs_org",   // [hasOrg] branch replicated in projection
    context: {
      ...context,
      user: { email: user.email, display_name: user.display_name, first_name: user.first_name },
      org:  org ? { id: org.id, name: org.name } : { id: null, name: null },
    },
  };
}
```

**`session_rejected` reducer (PROPOSED):**
```
session_rejected: (_state, context, event) => ({
  state: "session_rejected",
  context: { ...context, underlying_cause_tag: event.payload.reason ?? "session_rejected" },
})
```

**The `[hasOrg]` branch is replicated in BOTH the machine guard and the projection reducer**
(as `org_form_submitted`/`org_created` already are) — this is the existing pattern (the
projection is a pure fold independent of the actor; it must reach the same terminal state).

**Reducers to RETIRE (L6):** `sign_in_clicked`, `auth_callback_resolved`, `auth_failed`.
**Reducers to KEEP unchanged:** `org_form_submitted`, `validation_failed`, `token_expired`,
`reissue_failed_partial`, and (renamed) `org_created_and_jwt_reissued`→`org_created`.

### OQ-4 — Event-sourced projection vs server-authoritative store → **RECOMMEND: SERVER-AUTHORITATIVE STORE (inherit ADR-040 D3). ★ THE call most needing user ratification.**

**Trade-off that drove it:** with auth re-enactment gone, the session-onboarding flow is the
thinnest flow in the system (user from one event, org from one event, ~6 states). The
event-sourced projection's *only* justification was audit/temporal replay, for which **no
written requirement exists** at the planning horizon. The store model eliminates the
emission-completeness invariant *by construction* — which is exactly the failure class that
produced this very defect.

| Option | What it is | Trade-offs |
|---|---|---|
| **ES-projection (status quo pre-ADR-040)** | FlowEvents on Redis Streams; `buildProjection` rebuilds the read model. | (+) audit trail, point-in-time replay, retroactive views. (−) manufactures the emission-completeness invariant — the *exact* tripwire that stranded the user payload here; hand-policed by review/lint; ADR-030's own 2026-05-16 amendment names it the largest accidental-complexity surplus. No written temporal requirement consumes the audit trail. |
| **Server-authoritative store (ADR-040 D3) — RECOMMENDED** | One settled-state record per `flow_id`; `GET /projection` = `store.get(flow_id)`; settle = `store.set(...)`. | (+) emission-completeness invariant **gone by construction** (nothing to rebuild, nothing to go stale); (+) session-onboarding is the *ideal* candidate — the thinnest flow, no audit need; (+) already the ratified context-wide direction (ADR-040 Accepted). (−) loses full-history audit/point-in-time (re-introduced as a separate audit adapter only if a requirement is ever written; none exists). The bounded US-210 FREEZE/THAW intent buffer survives separately (ADR-040 D3) — but session-onboarding/login does NOT participate in FREEZE/THAW (strategy.ts:224-247), so even that doesn't apply here. |

**Why this is the ratification-critical call:** the seed brief framed it as open, but
**ADR-040 (Accepted, 2026-05-16) already adopted the store model for the whole `ui-state`
context** as the tripwire exit, with a binding LEAF-5 equivalence gate. The honest
recommendation is therefore **not a fresh decision but an inheritance confirmation**:
session-onboarding adopts the store like every other flow. The user should ratify *that the
session-onboarding rename rides ADR-040's store model (and lands after LEAF-5, §7)* — and
explicitly NOT re-introduce event-sourcing for this flow. If the user wants to revisit
ADR-040 itself, that is a separate, larger decision outside this feature's scope and should
be flagged as such. **ADR-042 records this inheritance as PROPOSED.**

### OQ-5 — `access_token` mint (`mintAccessTokenForReady`) → **RECOMMEND: Option B (retain as an explicitly-labeled projection convenience; do NOT mint a security token)**

**Trade-off that drove it:** auth-proxy is the token SSOT (ADR-016); ui-state must never be
believed to issue real tokens. But the projection's `access_token` field has a *live
consumer*: the TS harness's `assert_jwt_carries_org_claim` (IC-2/IC-4) decodes it to verify
the org_id claim matches. Deleting it breaks that assertion's mechanism.

| Option | Behavior | Trade-off |
|---|---|---|
| **A — delete the mint; drop `access_token` from the projection** | The `org_id` claim verification reads `projection.context.org.id` directly. | Cleanest re: ADR-016 (ui-state stops emitting a token-shaped string). Cost: rework `assert_jwt_carries_org_claim` (harness) + IC-2/IC-4 acceptance to assert on `org.id` directly rather than a decoded claim — a contract change to the harness surface. |
| **B — retain, relabel as a non-security "org-claim echo" (RECOMMENDED)** | Keep `mintAccessTokenForReady` but rename to make non-security intent explicit (e.g. `composeOrgClaimEcho`); keep the `alg:none` placeholder sig (it already signals "not a real token", strategy.ts:59-67). | Lowest risk; the harness/IC contract is unchanged; the `alg:none` + `ui-state-mint` sig already make it self-evidently not a credential. ADR-016 is honored because nothing *verifies* this string as auth — it's a projection convenience the harness decodes. Cost: it remains a token-shaped artifact someone could misread; mitigated by the rename + a docstring. |
| **C — replace with a structured `org_claim` field** | Replace the JWT-shaped string with `projection.context.org_claim = { org_id }`. | Honest shape (not pretending to be a JWT) but still a harness/IC contract change like A, with extra reducer churn. |

**Recommendation B, with a caveat to the user:** the *reissue* call to backend
(`/api/auth/reissue`, `reissueOrgJwtFn`) is the genuinely-vestigial-suspect part. The
ui-state-minted string is NOT what auth-proxy verifies; the **real** reissued JWT (with the
org_id claim) is what auth-proxy mints on the next request. **Recommend the user ratify
whether the backend reissue call is load-bearing** (does the backend persist anything on
reissue, or is the org_id claim minted fresh by auth-proxy from the now-existing org row?).
If reissue is a no-op, `reissueOrgJwtFn` + the reissue step retire (R10) — but that
verification needs a backend read, flagged for DISTILL. **For DESIGN: keep both, relabel the
ui-state mint, flag reissue for empirical verification.**

### OQ-6 — Acceptance-test impact (J-001 / J-002) → **RECOMMEND: rename ripples are mechanical + bounded; ONE genuine new RED suite for the rejection path**

**Trade-off that drove it:** most J-001 acceptance scenarios are written at the
*user-observable* level ("post-sign-in state", "email is X", "does not see any error") — they
survive the rename. The coupling lives in the harness *implementation* and in
state-name/event-name string literals.

**What breaks (must change):**

| Surface | File | Breakage | Fix |
|---|---|---|---|
| Harness `begin_auth` body | `tests/acceptance/user-flow-state-machines/harness/user-flow-harness.ts:55` | sends `persona_email`/`persona_display_name`; the new DTO drops `persona_email` as required and identity comes from the verified header (L4). | Update the harness to stop sending `persona_email` as the identity source (it may stay as a dev-fixture hint for fake-workos, OQ-1); rely on injected `X-User-Id`. The Bearer must be supplied (dev: `dev-token-static`). |
| Harness path segment | same, `:51` and J002 `:362` | `/flow/login-and-org-setup/begin` | ADR-040 LEAF-2 alias keeps it working during migration; update to `/flow/session-onboarding/begin` post-migration (LEAF-6 alias removal). |
| State-name assertions | step defs + features asserting `authenticated_no_org` | renamed to `needs_org` (L6) | Rename the literal in `assert_state("authenticated_no_org")` call sites + the `first-time-sign-in` "post-sign-in state" step mapping. |
| `assert_jwt_carries_org_claim` mechanism | harness `:246` | depends on `context.access_token` | unchanged if OQ-5 Option B is taken; reworked if Option A. |
| `harness-drives-...` scenarios | feature file | "post-sign-in state" / "ready state" semantics | survive (user-observable wording); only the underlying state literal in the step impl changes. |

**What is genuinely NEW (RED acceptance, not characterization — per seed §7 + CONSTRAINTS):**

1. **`session_rejected` path** — no current scenario covers re-verify failure (the old flow
   had no rejection terminal). DISTILL must write a RED acceptance scenario: *given a request
   with an invalid token, when onboarding begins, then the session is rejected and no
   identity advances* (Event-Model Spec 3). This is the behavior-change coverage the seed
   brief flags as REQUIRED.
2. **`[hasOrg]` returning-user shortcut** — the old flow always went through
   `authenticated_no_org`; the direct `session_started → ready` path is new behavior needing
   a RED scenario (Event-Model Spec 1).
3. **Identity-populated-at-t=0 assertion** — the defect-closing assertion (`context.user`
   non-null on the first projection read, Event-Model Spec 2) should be an explicit RED
   scenario; today's bug would pass a weaker assertion.

**J-002 impact:** minimal/none directly. J-002 consumes the `auth_ready` broadcast
(org_id + first_name) which is **preserved** (R2, strategy.ts:144). As long as
`session_started → ready` still fires the `auth_ready` hook with the same payload, J-002's
spawn chain is unaffected. DISTILL should run the J-002 suite as a regression gate after the
rename.

---

## 4. Tech Stack

**No technology selection.** This is a domain-model correction. Runtime stack (Hono, XState
v5, Redis, hexagonal transport) is fixed by ADR-027/028/030/040 and inherited unchanged. The
only external integration touched is **WorkOS `/oauth/userinfo`** (re-verify) —
**contract-test recommended (Pact-JS)** for the OIDC userinfo response shape, consistent with
ADR-027 §6's existing WorkOS contract-test recommendation.

---

## 5. Constraints

| # | Constraint | Source |
|---|---|---|
| C1 | **Lands AFTER ADR-040 LEAF-4 → LEAF-5 → LEAF-6.** Do not entangle with the in-flight hexagonal-transport LEAF series; touching session-onboarding mid-series increases merge churn. The store model (OQ-4) is only real after LEAF-5. | seed §7; ADR-040 |
| C2 | **This is a BEHAVIOR change, not characterization.** Placeholder→real user + new `session_rejected` path + `[hasOrg]` shortcut need RED acceptance coverage (OQ-6). Note for DISTILL. | seed §7; OQ-6 |
| C3 | **Rename touches the ADR-039 canonical machine-name registry key.** `login-and-org-setup` → `session-onboarding` is a vocabulary change governed by ADR-039; sequence the rename deliberately (ADR-040 LEAF-2 alias map covers the migration window; LEAF-6 removes aliases). | seed §7; ADR-039; ADR-040 D5 |
| C4 | **Identity from verified token/header, never client body** (ACL rule). | L4 |
| C5 | **auth-proxy must NOT be asked to forward a name claim** — display_name comes from the re-verify WorkOS profile. | L5 |
| C6 | **ui-state must not be believed to issue real tokens** (ADR-016). The `access_token` field stays explicitly non-security (OQ-5). | ADR-016 |

---

## 6. Upstream Changes

| Change | Direction | Status |
|---|---|---|
| auth-proxy **already** forwards the Bearer to ui-state (`proxyToUpstream` passes all non-identity headers, app.ts:494-517; `@bearer-forward` acceptance scenario exists). | ui-state ← auth-proxy | **No change needed** — confirmed forwarded (L4 precondition holds). |
| fake-workos must accept `dev-token-static` at `/oauth/userinfo` returning the DEV_USER profile (OQ-1 Option B). | ui-state → fake-workos (test fixture) | **NEW (small fixture)** — DISTILL/DELIVER. |
| auth-proxy need NOT forward a name/display_name claim (L5). | — | **Explicitly no change** — display_name from re-verify. |
| backend `/api/auth/reissue` load-bearingness needs empirical verification (OQ-5). | ui-state → backend | **Verify at DISTILL** — may retire `reissueOrgJwtFn`. |
| nginx `/ui-state/` proxy + auth-proxy `/ui-state/*` routing table — **unchanged** (path prefix preserved; ADR-040 LEAF-2 alias map handles the per-machine sub-route rename). | — | **No change.** |

---

## 7. Decision points requiring user ratification (relay list)

1. **★ OQ-4 (ES-vs-store) — the biggest call.** Confirm session-onboarding rides ADR-040's
   server-authoritative store (lands after LEAF-5), and does NOT re-introduce event-sourcing
   for this flow. (Recommended; ADR-040 already ratified the store context-wide.)
2. **OQ-1** — fake-workos accepts `dev-token-static` at `/oauth/userinfo` (Option B), keeping
   the verify path prod-faithful in dev.
3. **OQ-2** — `session_rejected` = HTTP 200 + `projection.state="session_rejected"` + distinct
   `_tag`, separate from org-setup errors.
4. **OQ-3** — `session_started{user, org|null}` self-contained payload; `[hasOrg]` branch
   replicated in the reducer; retire `sign_in_clicked`/`auth_callback_resolved`/`auth_failed`.
5. **OQ-5** — retain + relabel the ui-state `access_token` mint as a non-security org-claim
   echo (Option B); separately VERIFY whether the backend reissue call is vestigial (DISTILL).
6. **OQ-6 / C2** — the new RED acceptance coverage (session_rejected, [hasOrg], identity-at-t0)
   is in scope for DISTILL, not characterization-only.
7. **ADR numbers** — ADR-041 (session-onboarding domain realignment) + ADR-042 (store-model
   inheritance for session-onboarding) — both PROPOSED, pending ratification.
8. **Inheritance flag (OQ-4 sub-point)** — acknowledge that ADR-040 already decided the store
   for `ui-state`; this feature confirms the inheritance rather than re-opening it.

---

## 8. Ratification (2026-05-22)

User ratified all §7 decision points **as recommended** (OQ-1..6, the ADR-040 store
inheritance, ADR-041 + ADR-042 → **Accepted**), with two adjustments and the reviewer's
follow-ups folded in. The design passed `nw-ddd-architect-reviewer` (verdict: approved; the
ADR-040 inheritance claim independently confirmed against ADR-040 D3 + LEAF-5).

**Adjustment A — Aggregate name is a noun.** The aggregate is renamed **`OnboardSession`**
(not `SessionOnboarding`). The flow / bounded-context / machine stay `session-onboarding` /
`SessionOnboardingMachine` (process descriptor) and the command stays `BeginSessionOnboarding`
(commands are verbs). Applied in `brief.md`, `event-model.md`, ADR-041. This is a deliberate
aggregate-noun vs flow-descriptor distinction.

**Adjustment B — `auth_ready` on the `[hasOrg]` path: RESOLVED (returning users DO need it).**
The reviewer flagged that `verifying → ready` (returning user) would not fire `auth_ready`
under the current `isFirstReady` predicate (`strategy.ts:157`), so project-context might never
spawn. User decision: returning users DO need the broadcast. **DELIVER action:** extend
`isFirstReady` to include the `verifying → ready` predecessor. Event-Model Phase 3 + Spec 1
updated to assert the broadcast fires on both `creating_org → ready` and `verifying → ready`.

**Reviewer follow-ups folded into the DISTILL handoff (low severity, non-blocking):**
- **LEAF-5 equivalence-gate coverage.** When LEAF-5 is sequenced, the binding equivalence gate
  (ADR-040) must enumerate the session-onboarding state histories explicitly: (a)
  `verifying → needs_org → creating_org → ready`, (b) `verifying → ready [hasOrg]`, (c)
  `verifying → session_rejected`, (d) `ready → expired_token → ready`. ADR-042 open-question 1
  tracks this; DISTILL must not drop it.
- **R4 actor input type change (make explicit in the DISTILL handoff).** The `workosUserInfo`
  actor input type changes `{ persona_email: string }` → `{ bearer_token: string }`, sourced
  from the router's forwarded `Authorization` header; thread it through machine input → actor
  invocation → strategy. One-line type change, but call it out so the crafter doesn't re-derive.
</content>
