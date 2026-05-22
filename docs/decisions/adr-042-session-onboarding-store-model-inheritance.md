# ADR-042: Session-Onboarding Adopts the Server-Authoritative Store (ADR-040 inheritance)

**Status:** Accepted (ratified by user 2026-05-22)
**Date:** 2026-05-22
**Originating wave:** DESIGN — `session-onboarding` (domain / bounded-contexts scope, propose mode)
**Author:** Hera (nw-ddd-architect)
**Companion artifacts:**
- Seed brief: `docs/feature/session-onboarding/design-intent.md` §6 open-question #4
- Sibling ADR (same wave): ADR-041 (session-onboarding domain realignment)
- DESIGN deliverable: `docs/feature/session-onboarding/design/wave-decisions.md` §OQ-4
**Relationship to prior ADRs:**
- **Inherits** ADR-040 D3 (the per-flow server-authoritative `SettledStateStore` becomes the
  read-model SSOT for the `ui-state` context; the Redis-Streams event-log + `buildProjection`
  rebuild is removed at LEAF-5). This ADR confirms session-onboarding rides that decision.
- **Inherits** ADR-040's 2026-05-16 tripwire resolution (event-sourcing dropped for `ui-state`
  flows absent a written temporal requirement).
- Honors ADR-030 §1–§4 (topology/scaling/failover unchanged), ADR-027 §1 (FE projection read
  contract preserved at the adapter edge).

## Context

The seed brief (§6 #4) names "event-sourced projection vs. server-authoritative store" as
**the biggest call** for the session-onboarding wave, citing ADR-030's 2026-05-16
emission-completeness tripwire ("with auth re-enactment gone, J-001's projection becomes very
thin … evaluate the simpler per-flow store here").

A reconciliation finding shapes this ADR: **ADR-040 (Accepted, 2026-05-16) already adopted the
server-authoritative store model for the entire `ui-state` context** as the tripwire exit, with
a binding LEAF-5 equivalence gate. The store decision is therefore **not open at the context
level** — what is open is whether the session-onboarding realignment confirms the inheritance
or argues for an exception. This ADR records the confirmation.

The defect that motivated the whole feature (ADR-041 §Context) is itself an instance of the
emission-completeness failure class the store model eliminates by construction — making
session-onboarding the *strongest* candidate for the store, not a borderline one.

## Decision drivers

- **Thinnest flow in the system.** Post-realignment, session-onboarding holds user from one
  event (`session_started`), org from one event, and ~6 states. The event-sourced
  projection's only justification (audit / point-in-time replay) has **no written
  requirement** at the planning horizon.
- **Emission-completeness eliminated by construction.** The store model removes the manufactured
  invariant that produced this very defect; the seed brief's defect is the empirical case for
  the store.
- **Context-wide consistency.** ADR-040 already commits `ui-state` to the store; a per-flow
  exception (keeping event-sourcing only for session-onboarding) would re-introduce the exact
  dual-model complexity ADR-040 exits, for the flow that needs it least.
- **No FREEZE/THAW participation.** Session-onboarding / login does NOT participate in the
  US-210 FREEZE/THAW intent buffer (the one temporal mechanism ADR-040 retains) — its strategy
  declares no-op freeze/thaw members (`strategy.ts:224-247`). So even the surviving bounded
  buffer is irrelevant here.

## Considered options

1. **Keep event-sourcing for session-onboarding only.** Rejected — re-introduces the
   dual-model complexity ADR-040 exits, for the thinnest flow, with no audit consumer; and
   re-arms the emission-completeness invariant that caused the defect.
2. **Adopt the server-authoritative store (inherit ADR-040 D3) — SELECTED.** The per-flow
   settled-state record is the SSOT; `GET /projection` resolves to `store.get(flow_id)`; settle
   writes `store.set(flow_id, …)`. The session-onboarding reducers (`session_started`,
   `session_rejected`, etc.) define the *shape* of the settled record; the rebuild path is gone.
3. **Re-open ADR-040 itself.** Out of scope. If the user wants to revisit the store decision
   *context-wide*, that is a separate, larger decision — flagged, not bundled here.

## Decision

**Session-onboarding adopts the server-authoritative `SettledStateStore` (ADR-040 D3).** It
does NOT re-introduce event-sourcing for this flow. Concretely:

- The session-onboarding settled state is one record per `flow_id = session-onboarding:<principal_id>`.
- `GET /flow/session-onboarding/projection` resolves to `store.get(flow_id)` (ADR-040 LEAF-5).
- The settle path writes the settled record (no FlowEvent append, no rebuild).
- The projection *shape* (the reducer outputs in ADR-041 D2/D6) is preserved as the store
  record's shape — the FE/harness read contract (ADR-027 §1) is unchanged at the adapter edge.
- Audit trail / point-in-time replay over session-onboarding history is **not provided**;
  re-introduced as a separate append-only audit adapter only if a temporal requirement is ever
  written (none exists).

## Sequencing (binding constraint)

This inheritance is only real **after ADR-040 LEAF-5** lands (the read-port swap that replaces
the event-log with the store, gated by the LEAF-5 equivalence gate). Per seed §7 the
session-onboarding realignment lands **after ADR-040 LEAF-4/5/6**. Until LEAF-5, the
session-onboarding rename (ADR-041) lands behavior-neutral on the *event-log* substrate (like
ADR-040 LEAF-3 did), and the store swap is inherited when LEAF-5 lands context-wide. The two
must not be entangled.

## Consequences

**Positive**
- The emission-completeness failure class — which produced this feature's defect — is gone by
  construction for session-onboarding.
- `ui-state` stays single-model (store everywhere); no per-flow special case.
- The thinnest flow carries the least machinery; complexity matches product stage.

**Negative / accepted trade-offs**
- No full-history audit / point-in-time replay for session-onboarding. Accepted — no written
  requirement; re-introducible as a separate adapter if one appears.
- Inherits ADR-040 LEAF-5's accepted hard-swap risk (no dual-read parity window) and its
  binding equivalence-gate prerequisite. Session-onboarding's store-record equivalence MUST be
  covered by the LEAF-5 equivalence gate (or an analogous gate authored for the renamed flow).
- The decision is **contingent on LEAF-5 landing first**; if ADR-040's LEAF series is
  re-prioritized, this ADR's premise re-opens.

## Open questions

1. Does the LEAF-5 equivalence gate (ADR-040) already cover the login/session-onboarding flow's
   state-histories, or does the rename require an analogous gate authored for `session-onboarding`?
   Confirm at DISTILL when LEAF-5 is sequenced.

## References

- ADR-040 (D3 store model, LEAF-5 equivalence gate, 2026-05-16 tripwire resolution)
- ADR-030 (§1–§4 topology; 2026-05-16 emission-completeness tripwire amendment)
- `docs/feature/session-onboarding/design/wave-decisions.md` §OQ-4
- ADR-041 (session-onboarding domain realignment)
</content>
