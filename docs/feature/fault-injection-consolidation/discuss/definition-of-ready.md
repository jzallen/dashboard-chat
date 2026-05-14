# Definition of Ready — Fault-Injection Consolidation

DISCUSS-wave gate. Each of US-CONSOL-1..5 must pass all 9 standard DoR items plus 4 consolidation-specific items before handoff to DESIGN. This document records the current status as of the DISCUSS revision pass that produced these artifacts.

A failed item is not a partial pass — it blocks handoff. Remediation is a return to DISCUSS or an explicit deferral with sign-off.

## Vocabulary note

This DISCUSS pass retired "harness" as a category descriptor and removed "nwave" from product-name positions. The 5 stories and 27 BDD scenarios were re-rendered with the new vocabulary in the same revision. The standard DoR items themselves are unchanged — only the proper-noun references inside them.

---

## Standard DoR (9 items, per nw-leanux-methodology)

Status for each story:

| DoR Item | CONSOL-1 | CONSOL-2 | CONSOL-3 | CONSOL-4 | CONSOL-5 |
|---|---|---|---|---|---|
| 1. Problem statement clear, domain language | PASS | PASS | PASS | PASS | PASS |
| 2. User/persona with specific characteristics | PASS | PASS | PASS | PASS | PASS |
| 3. 3+ domain examples with real data | PASS | PASS (3) | PASS (3) | PASS (4) | PASS (3) |
| 4. UAT in Given/When/Then (3-7 scenarios) | PASS (5) | CONDITIONAL (7) | PASS (5) | CONDITIONAL (6) | PASS (4) |
| 5. AC derived from UAT | PASS | PASS | PASS | PASS | PASS |
| 6. Right-sized (1-3 days, 3-7 scenarios) | PASS | CONDITIONAL | PASS | CONDITIONAL | PASS |
| 7. Technical notes: constraints/dependencies | PASS | PASS | PASS | PASS | PASS |
| 8. Dependencies resolved or tracked | PASS | PASS | PASS | PASS (depends on 1) | PASS (depends on 1) |
| 9. Outcome KPIs defined with measurable targets | PASS | PASS | PASS | PASS | PASS |

### CONDITIONAL items needing attention

#### CONSOL-2 item 4 (UAT count: 7 scenarios) and item 6 (right-sizing)

US-CONSOL-2 sits at the upper edge of the right-sizing band (7 scenarios). The scenarios are all closely related (one gate, multiple environment values + one default-fail-closed case + one inspection-probe case + one consistency case), so splitting feels artificial. **Recommendation**: keep as a single story but flag in DESIGN handoff that if effort exceeds 3 days, split into "ENVIRONMENT gate proper" (5 scenarios) and "Inspection-probe conditional registration" (2 scenarios).

#### CONSOL-4 item 4 (UAT count: 6 scenarios) and item 6 (right-sizing)

US-CONSOL-4 grew from 5 to 6 scenarios in the revision pass because the vocabulary-cleanup phase (renaming `__harness_*` events, `harness_force_reissue_failures` body field, deprecating `NWAVE_HARNESS_KNOBS`) added one scenario. Story remains within the 3-7 band but is now phased explicitly (adapter / vocabulary-cleanup / optional wire-rename). **Recommendation**: keep as a single story; the phases are sequential atomic commits in one MR, not parallel work. If effort tracking shows phase 2 (vocabulary cleanup) consistently exceeds 1 day, consider splitting it into a separate follow-up MR with its own story id.

---

## Consolidation-specific DoR addenda

These four items are specific to this feature's nature as cross-cutting infrastructure rather than user-facing behavior.

| Addendum | Status | Owner | Resolution path |
|---|---|---|---|
| A1. ADR drafted for `ENVIRONMENT` vs defense-in-depth flag interaction | NOT YET | solution-architect (DESIGN) | DESIGN-wave deliverable; see `open-questions.md` Q1 |
| A2. Module location decided (`shared/fault-injection/` vs `ui-state/lib/fault-injection/` vs per-service) | NOT YET | solution-architect (DESIGN) | DESIGN-wave deliverable; see `open-questions.md` Q2 |
| A3. Audit log sink decided (stdout / Redis stream / OTel span) | NOT YET | solution-architect (DESIGN) | DESIGN-wave deliverable; see `open-questions.md` Q3 |
| A4. Naming scheme decided (DISCUSS recommends `X-Force-*` retained for headers, verb-only for events/body fields) | NOT YET | solution-architect (DESIGN) | DESIGN-wave deliverable; see `open-questions.md` Q4 |

**None of A1-A4 block DISCUSS handoff** — they are inputs to DESIGN, not outputs of DISCUSS. The DISCUSS deliverable explicitly surfaces them in `open-questions.md` rather than guessing at answers.

---

## Definition of Ready: Overall verdict

### DISCUSS to DESIGN: READY

All 5 stories pass standard DoR (with conditional flags on CONSOL-2 and CONSOL-4 for size — see above). All 4 consolidation-specific addenda are correctly *open* — they belong to DESIGN, not DISCUSS, and surfacing them as questions is the right shape of handoff.

### DESIGN to DISTILL: NOT READY

A1-A4 must be resolved as ADRs before DISTILL. Specifically:

- **A1 ADR** must specify whether a defense-in-depth flag survives alongside `ENVIRONMENT` (DISCUSS recommends Q1.b — AND composition) and, if so, what it is named (DISCUSS recommends `FAULT_INJECTION_ENABLED`; explicitly NOT `NWAVE_*`). Whichever flag DESIGN picks, the existing `NWAVE_HARNESS_KNOBS` env var must be deprecated in US-CONSOL-4 migration scope.
- **A2 ADR** must specify the module's source-tree home, honoring ADR-033/034 (directory named for body of source). DISCUSS recommends `shared/fault-injection/` (precedent: `shared/chat/`). ADR must also document the category boundary between the fault-injection registry and the inspection probes (whether they share a module or live separately).
- **A3 ADR** must specify the audit log sink and the structured-data format.
- **A4 ADR** must specify the naming scheme. DISCUSS recommends: keep `X-Force-*` headers; rename `__harness_*` events to verb-only (`__force_failure__`, `__expire_token__`); rename `harness_force_reissue_failures` to `force_reissue_failures`. If DESIGN diverges, US-CONSOL-4 phase 2 must be re-scoped.

### DISTILL to DELIVER: NOT READY (premature to assess)

Standard DoR re-evaluation will happen at DISTILL handoff. The acceptance scenarios drafted here (27 across 5 stories) form the input to DISTILL's BDD test generation.

---

## Risk Register

Surface risks for downstream waves; product-owner does not manage them.

| Risk | Probability | Impact | Mitigation approach |
|---|---|---|---|
| US-CONSOL-4 adapter phase breaks acceptance scenarios | MEDIUM | HIGH | Acceptance suite is the safety net; atomic commits per knob |
| US-CONSOL-4 vocabulary-cleanup phase breaks acceptance scenarios | MEDIUM | HIGH | Rename commits are atomic (production + test together); each green at HEAD |
| `ENVIRONMENT` semantics conflict with future deployments | LOW | MEDIUM | Open question Q1 must be resolved before DESIGN ADR lands |
| Audit log adds non-trivial overhead in dev | LOW | LOW | Audit only fires on knob invocation, not per-request |
| Naming scheme decision delays DESIGN | LOW | LOW | DISCUSS recommendation (keep `X-Force-*`, drop `harness` prefix elsewhere) is conservative; phase 1 is wire-identical on headers |
| Manifest schema drift between TypeScript services | MEDIUM | MEDIUM | Q2 in `open-questions.md` — DESIGN must decide shared package vs per-service schema sync |
| CI lint check produces false positives blocking legitimate work | LOW | MEDIUM | Build the check incrementally; allow override with explicit annotation |
| Legacy `NWAVE_HARNESS_KNOBS` references survive in undocumented places (CI scripts, .env files, runbooks) | MEDIUM | LOW | Grep + deprecation warning at runtime; one release of overlap before removal |

---

## Handoff Package to DESIGN

Artifacts produced (or revised) in this DISCUSS pass:

- `stories.md` — 5 LeanUX user stories with embedded UAT (revised: harness/nwave excised; vocabulary-cleanup scoped into US-CONSOL-4)
- `acceptance-criteria.md` — 27 BDD scenarios, story-indexed (revised: event names, body fields, audit log names updated)
- `journey.md` — developer journey with emotional arc and friction map (revised: category-boundary section added)
- `definition-of-ready.md` — this file (revised: addenda renamed)
- `open-questions.md` — 4 questions for DESIGN to resolve as ADRs (revised: Q1 candidate names, Q2 location recommendation, Q3 audit-event names, Q4 naming-scheme decision)

DESIGN inputs from elsewhere:

- ADR-028 (machine isolation) — constrains module shape
- ADR-029 (X-Active-Scope) — constrains naming scheme; this DISCUSS keeps `X-Force-*` partly because it remains visually distinct from production headers
- ADR-033/034 (source-tree naming) — constrains module location
- Audit summary from prompt — 6 knobs, 3 inspection probes, current callsite map

DESIGN deliverables (expected):

- ADR for ENVIRONMENT vs defense-in-depth flag (resolves Q1)
- ADR for module location and category boundary between fault-injection registry and inspection probes (resolves Q2)
- ADR for audit log sink (resolves Q3)
- ADR for naming scheme (resolves Q4)
- C4 update showing the fault-injection registry's relationship to ui-state and agent services
- Domain-model update if the manifest is modeled as a first-class domain artifact

---

## Sign-off

**Author**: Luna (product-owner agent, DISCUSS wave — revision pass)
**Original date**: 2026-05-13
**Revision date**: 2026-05-14
**Status**: DISCUSS deliverables complete; DoR PASSED for handoff to DESIGN
**Next wave**: `/nw-design` with `docs/feature/fault-injection-consolidation/discuss/` as input

### Revision summary

This pass revised the original 5 artifacts to:

1. Retire "harness" as a category descriptor (the TS `tests/.../user-flow-state-machines/harness/` directory is unchanged — it's a proper noun).
2. Remove "nwave" from product-name positions (env vars, audit log fields, module names). The nwave-ai SDLC tooling is unaffected.
3. Rename the feature directory: `docs/feature/harness-knob-consolidation/` → `docs/feature/fault-injection-consolidation/`.
4. Scope vocabulary-cleanup (event renames, body-field rename, env-var deprecation) into US-CONSOL-4 phase 2.
5. Document the category boundary between fault injection (write-side state forcing) and inspection probes (read-side observation).
