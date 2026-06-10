# ADR-049: Client-Reported Outcome Event Model for ui-state (Presentation-Coordination-Only Trust)

**Status:** Proposed (awaiting user ratification — DR-1–DR-8 in the domain-model doc)
**Date:** 2026-06-10
**Originating wave:** DESIGN — `client-driven-onboarding` (domain scope, propose mode)
**Author:** Hera (nw-ddd-architect); grounded in the user-ratified seed `docs/feature/client-driven-onboarding/design-intent.md`, ADR-048 (the sibling system-scope pass), and the live source
**Scope:** Domain architecture — the event model and trust semantics of the ui-state context after it loses all network egress: the client-reported outcome vocabulary, the PCO trust invariant amending ADR-041's ACL rule, the onboarding/project-context machine realignment, and the event-routing semantics that eliminate the settled-child crash class. Exact wire schemas (Zod/TS deltas to `shared/ui-state-wire/`), HTTP contracts, and file-by-file deltas are deliberately NOT decided here — they belong to the companion solution-architect pass.

**Amends (supersedes in part):** ADR-041 — the actor-driven write model (`getUserOrg`/`createOrg` invokes, D3 re-verification, D5's `verifying`/`creating_org`/`session_rejected` states, D6, D7's ui-state-downstream context-map edges). The precise survives/superseded map is §2.
**Companion:** ADR-048 (system scope — auth-proxy owns the WorkOS write workflow; this ADR inherits its binding constraint: *every failure outcome must be representable as retryable; no terminal-in-practice partial-setup states*).
**Honors:** ADR-016 (sole ingress), ADR-028 (parent-ignorant children), ADR-030 (single replica; header-derived flow identity), ADR-039 (ui-state is one bounded context), ADR-042 (no event sourcing for this context — re-confirmed), ADR-043 (token lifecycle out of ui-state), ADR-044 (ChatApp coordinator — phase-scoped invokes and `onSnapshot` advances unchanged), ADR-046 (the `/state` transport and StateProxy are untouched; only the event **vocabulary** inside the published language changes).

---

## Context

Three facts, verified in the live tree, motivate the domain redesign:

1. **The ratified boundary makes ui-state a pure presentation-state coordinator** (design-intent §"Boundary assignments", FIXED): zero network egress, transitions driven by client-reported outcome events. The machine-internal I/O being retired is concrete: the onboarding `loadSession` (WorkOS re-verify + `GET /api/orgs/me`) and `createOrg` invokes (`ui-state/lib/machines/onboarding/setup/actors.ts:121–396`), and project-context's `resolveInitialScope`/`createProject`/`switchProject` (`project-context/setup/actors.ts:140–480`) — all calling `${backendUrl}` with dev fixture identity headers (the ADR-016 bypass ADR-048 removes).
2. **The machine-internal I/O produced two observed defect classes (2026-06-10).** (a) *Process crash on an event to a settled child:* `POST /state/events` forwards every event through the parent's root-level `on.child_event` total forward (`chat-app/machine.ts:72–75`) into `sendTo(context.active_child_id, …)` (`chat-app/setup/actions.ts:153–168`); with the parent in `user_rejected`, `active_child_id` still names the **stopped** phase-scoped onboarding child (`machine.ts:43`, `:147`; the stop is documented at `setup/types.ts:81–95`), the phase ACL is skipped (`router.ts:443`), XState v5 cannot resolve the `sendTo` target among `snapshot.children` and throws inside event processing; the bare `actor.send` (`router.ts:560–573`) has no error observer, so the error re-raises outside the request handler and kills the ui-state process. (b) *Terminal-in-practice `partial-setup`:* `error_recoverable` has no exit transitions (`onboarding/machine.ts:188–192`, tagged at `:183`), so a genuine org-create failure wedges the flow until a force-restart.
3. **ADR-041's ACL rule needs explicit re-examination.** "Identity from verified headers, never client body claims" was written against an actor-driven model. The client now posts body claims about world state ("org_created with id X"); whether that violates the rule must be resolved in writing, not by drift.

## Decision

### 1. The client-reported outcome event model

ui-state's onboarding and project-context regions transition **only** on synchronous, client-posted events over the unchanged ADR-046 `/state` surface. The vocabulary (full glossary + payloads: domain-model §3):

- **Onboarding:** `session_begin` (kept) · `org_exists_reported` · `org_missing_reported` · `org_created_reported` · `org_create_failed_reported{cause}` · `__force_failure__` (kept, gated).
- **Project-context:** `scope_resolved_reported` · `no_projects_reported` · `scope_mismatch_reported{cause}` · `project_created_reported` · `project_create_failed_reported{cause}` · `project_switched_reported` · `open_deep_link` (kept, wish-capture) · `back_to_projects_clicked` (kept).

The `*_reported` suffix is deliberate ubiquitous language: it marks every such event as a **client observation admitted under the PCO invariant** (§Decision 2), distinguishing it from the retired server-verified vocabulary (`org_created` as an actor-output FlowEvent would be a homonym across two trust regimes — rejected).

**No server-visible in-flight states** (domain-model §4.1, Option B): the client keeps in-flight UI local (the catalog write-through pattern) and posts only outcomes. Under the no-I/O rule an in-flight server state is a promise only the client can keep — a danglable dead-end class, the very thing ADR-048 forbids. Consequently `org_form_submitted`, `create_project_submitted` (with its UI-1 `org_name`-misnomer), `create_project_clicked`, `switching_project_intent`, and `retry_clicked` **retire**; retry is "the client re-POSTs the SSOT and re-reports."

### 2. The PCO invariant — ADR-041's ACL rule resolved, not relaxed

**INV-PCO (Presentation-Coordination-Only trust):** ui-state state — the `ChatAppStateDocument`, every region context field, every client-reported outcome event — is trusted for **presentation coordination only**: never an authorization input, never a resource-existence oracle, never identity. The backend remains the resource SSOT; auth-proxy the identity SSOT. Enforcement is by construction: ui-state has zero egress (nothing it could corrupt downstream); the backend and auth-proxy never read ui-state (the reissue triggers off the backend's 201 inside ADR-048's interception, not off presentation state); reports apply only to the reporting principal's own header-keyed actor; a false report can therefore produce only the liar's own broken screen (the self-harm property).

**ADR-041 supersession map (precise):**

| ADR-041 | Status |
|---|---|
| D1 (rename; entry assumes authenticated principal) | **Survives.** |
| D2 (`session_started` self-contained seed; identity in at t0) | **Survives in principle; mechanism amended** — the seed's user profile comes from auth-proxy-verified identity headers at `session_begin` cold-start, not from a ui-state re-verification (ratification DR-4). |
| D3 (WorkOS re-verification invoke) | **Superseded — retired** (zero egress; auth-proxy is the only verifier; residual risk documented in domain-model §2.3). |
| D4 (identity from verified headers, never client body claims) | **Survives FOR IDENTITY — absolute and unchanged.** INV-PCO narrows the rule's object: outcome body claims are admitted as presentation-coordination signals; no event writes identity. |
| D5 (state set) | **Amended:** `verifying` → `awaiting_org_report`; `creating_org` retired; `error_recoverable` kept by name and made genuinely recoverable; `session_rejected` retired (producer gone); `[hasOrg]` survives as the `org_exists_reported` fast path. |
| D6 (`session_rejected` shape) | **Superseded** (state retired; auth failure is auth-proxy's 401). |
| D7 (context map) | **Superseded in part:** auth-proxy→ui-state Customer-Supplier + ACL survives (ACL re-scoped to well-formedness/phase validation); ui-state→WorkOS (Conformist) and ui-state→backend (Customer-Supplier) edges **deleted** — ui-state has no downstream suppliers at all. The client (ui/) joins the map as the driving party; org creation's IdP half sits in the Authentication context (ADR-048), its resource half stays in backend Org/Project. |
| D8 (`access_token` projection echo) | **Recommend retire** (DR-6) — superseded by the real `Set-Cookie` reissue (ADR-048 §6). |
| Aggregate OnboardSession | **Survives** (root-only; Vernon rule re-check in domain-model §4.4). |
| OQ1 (reissue vestigial?) / OQ2 (dev re-verify fixture) | **Resolved by ADR-048** / **moot** (seam relocates to auth-proxy `WORKOS_BASE`). |

### 3. Machine realignment (event-level; statecharts + Given/When/Then in the domain-model doc)

- **Onboarding:** `awaiting_org_report → ready | needs_org` on probe reports; `needs_org → ready` on `org_created_reported`; `org_create_failed_reported` splits **re-edit vs. retry** — `org_name_taken` stays in `needs_org` with the inline validation error (today's 409 arm preserved), every other cause lands in `error_recoverable`, which **accepts all outcome reports** (Spec 5: a compensated or even orphaned ADR-048 failure is retried by re-submission — no dead ends, the `partial-setup` terminal dies). Report acceptance is wide across pre-`ready` states so multi-tab/crash flows **converge**; `ready` ignores late reports and answers with the current document.
- **Project-context:** `awaiting_scope_report → project_selected | no_projects | scope_mismatch_terminal` on reports; Phase D (the automatic default project) is `project_created_reported` accepted from `awaiting_scope_report` or `no_projects`; failures land in a report-accepting `error_recoverable`; switching is report-only (`project_switched_reported` / `scope_mismatch_reported`). The last-used-resolution and deep-link-discrimination policies move to the client with the retired resolvers.
- **The engaged flip (design-intent open point f):** unchanged in shape — the parent's `onSnapshot` guard `isInitialProjectSelected` (`chat-app/setup/guards.ts:36–38`) still advances `engaged.project_context → chat` when the child reaches `project_selected`; only the producer changes (a client report instead of an invoke `onDone`). The client observes app entry on the **POST response document itself** (`phase === "chat"`, `regions.projectContext.state === "project_selected"`, `active_scope.project_id` set) — no extra read, no race. Exact FE-gate field set: solution architect.
- **State names `ready` / `error_recoverable` are preserved deliberately** — the auth-proxy KPI sniffer pins those literals.

### 4. Crash-class elimination: phase-gated vocabulary routing

The parent's root-level total forward (`on.child_event` → `sendTo(active_child_id)`) is **replaced by phase-gated, vocabulary-routed acceptance** (domain-model §6, Option 1): onboarding reports are handled only on `login` (where the onboarding invoke lives — target alive by construction); project-context vocabulary only on `engaged` (the child is invoked on the `engaged` ancestor, alive in both substates — which is exactly why switch reports keep working from chat); session vocabulary only on `engaged.chat`. An event with no handler in the current state is dropped by XState semantics — **no `sendTo` executes, so the invalid send has no syntax**. `active_child_id` (the crash's load-bearing mutable pointer) is deleted; `user_rejected` (the one state where the stale pointer was reachable) retires with the re-verify (DR-5).

Considered and rejected: never-stopping regions (contradicts ADR-044's phase-scoped design + its retention machinery, for no added safety) and a guarded forwarder alone (the invalid send stays representable, merely caught). A guard check inside surviving forwarders is acceptable defense-in-depth.

**Side effect adopted:** the wire union becomes **closed** — the `{ type: string }` catch-all (`shared/ui-state-wire/wire-event.ts:52`) retires, because vocabulary routing requires naming the vocabulary. This resolves ADR-046's "unmodeled-event silence" open question: unknown types are rejectable at the edge; known-but-out-of-phase reports converge (no transition, current document returned — the regression spec for the 2026-06-10 crash).

### 5. ES/CQRS posture re-confirmed

Client reports are coordination commands, not an event source. The live actor + settled snapshot remain the state-of-record (ADR-044 hybrid; ADR-042 inheritance); the bookkeeping log stays demoted to SSE/audit substrate. No written temporal requirement exists; if one appears it belongs on the SSOT sides (ADR-048 §5 already gives org-create a structured trail at auth-proxy), never on the presentation tier.

## Consequences

**Positive**

- The 2026-06-10 fragility class is gone **structurally**: no egress means no machine-internal write to misfire; no total forward means no send into a stopped child; report-accepting error states mean no terminal-in-practice partial setup.
- ADR-041's ACL rule emerges *stronger*: identity-from-headers is restated as absolute, and the new trust category (outcome reports) gets an explicit named invariant instead of an unexamined exception.
- One write philosophy across the product (client-driven optimistic write-through); the trust posture is legible in the event names themselves (`*_reported`).
- The chat-app parent's coordination machinery (invokes, `onSnapshot` guards, hand-offs) is reused unchanged — the redesign is a realignment of two child machines plus routing semantics, not a new coordinator.
- The wire vocabulary becomes closed and honest; ADR-046's unmodeled-event-silence question is resolved as a side effect.

**Costs / accepted trade-offs**

- The document can no longer show in-flight writes to *other* tabs (in-flight is local to the writing tab); accepted — convergence on the outcome report covers the multi-tab case, and the alternative re-introduces danglable server states.
- The shipped org-onboarding surfaces (acceptance suite, `ui/` onboarding route, the `org_form_submitted`/`create_project_submitted` events) need sequenced rework — known and named in the seed (open point e); plan: solution architect.
- A misbehaving client can render itself a wrong screen (INV-PCO's accepted residue); the blast radius is provably the reporter's own presentation.
- Session-chat's egress retires under the same pattern in this feature (ADR-048's env table deletes `BACKEND_URL` tier-wide); its vocabulary is mechanical follow-on work pinned by the solution architect (DR-8).

## References

- Seed (fixed inputs): `docs/feature/client-driven-onboarding/design-intent.md`
- Domain-scope deliverable: `docs/feature/client-driven-onboarding/design/domain-model.md` (context-map amendment §1, INV-PCO §2, vocabulary §3, statecharts + specs §4–5, crash-class options §6, reuse §7, ratification DR-1–DR-8 §9)
- ADR-048 (system scope, companion), ADR-041 (amended — §2 map), ADR-042/043/044/046 (honored), ADR-016/028/030/039/040 (inherited)
- org-onboarding (shipped baseline this reworks): `docs/feature/org-onboarding/design/delta-and-decisions.md`
- Live code: `ui-state/lib/machines/onboarding/{machine.ts, setup/actors.ts}`, `ui-state/lib/machines/project-context/{machine.ts, setup/actors.ts}`, `ui-state/lib/machines/chat-app/{machine.ts:43,72–75,147, setup/actions.ts:153–168, setup/types.ts:51–95, setup/guards.ts:26–50, router.ts:244–253,440–456,484,560–573}`, `shared/ui-state-wire/{wire-event.ts, state-document.ts}`
