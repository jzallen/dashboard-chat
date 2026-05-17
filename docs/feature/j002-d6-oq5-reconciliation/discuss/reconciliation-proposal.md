# J-002 Reconciliation Proposal — D6 vs US-201 (CONFLICT-A) · OQ-J002-5 (CONFLICT-B)

> **Type**: Explanation / Decision proposal (DIVIO)
> **Wave**: DISCUSS (targeted reconciliation pass — NOT a greenfield DISCUSS)
> **Date**: 2026-05-17
> **Branch**: `discuss/j002-d6-oq5-reconciliation` · HEAD `707079a`
> **Status**: **PROPOSED — awaiting overseer ratification.** This document
> does NOT edit ratified SSOT in place. It proposes amendment blocks for
> the overseer to ratify (or reject) before downstream TDD remediation.
> **Upstream problem statement**:
> `/home/node/gt/dashboard_chat/crew/rca_j002/docs/research/j002-mr123-rca-triage.md` §5
> **Scope**: exactly the two recorded, unreconciled contradictions in RCA §5.
> No code, test, or stack changes. No merge-queue submission.

---

## 1. Why this document exists

The J-002 `mr_1/2/3` acceptance cluster is a genuine acceptance-debt
cluster (RCA §1, `j002-mr123-rca-triage.md:14-34`). Before Iron-Rule-safe
TDD remediation can begin, the RCA flagged a hard blocker (RCA §5,
`j002-mr123-rca-triage.md:239-269`): **the binding spec contradicts
itself in two places**, so a remediation engineer cannot know whether a
RED test encodes real unimplemented behavior (drive it GREEN) or a
spec the team explicitly carved out (skip it with citation). Driving the
wrong one violates the nwave Iron Rule.

This proposal establishes, with quotes, where each contradiction arose,
lays out 2–3 reconciliation options per conflict with their downstream
RCA-bucket effect, and recommends one option each — grounded in the
journey SSOT and ADR-027/029. The deliverable is a set of **PROPOSED
amendment blocks** for the overseer.

---

## 2. CONFLICT-A — create-project ownership (DISCUSS-internal)

### 2.1 The contradiction, evidenced

**Side 1 — US-201 AC + IC-J002-2 + journey SSOT: J-002 OWNS the
create-project sub-flow.**

US-201 acceptance criteria require J-002 to carry the in-flight,
validation, and recoverable-error sub-states internally:

- "Clicking 'Create project' with a valid name transitions through
  `creating_project` to `project_selected`" — `US-201.md:175-178`.
- "Empty project name returns the machine to `no_projects_empty_state`
  with an inline form error; no `POST /api/projects` is attempted" —
  `US-201.md:179-181`.
- "Transient `POST /api/projects` failure transitions to
  `error_recoverable` carrying the create-attempt's `correlation_id`;
  retry re-enters `creating_project` with the same id" —
  `US-201.md:182-184`.

The integration checkpoint IC-J002-2 drives exactly this path:
`create_project_submitted` → `creating_project` → `project_selected`,
asserting non-null `active_scope.project_id` on entry —
`test_journey_invariants_j002.py:204-225`.

Critically, the **journey YAML — the SSOT promoted to
`docs/product/journeys/project-and-chat-session-management.yaml`** —
models these as first-class J-002 machine states:

- `creating_project` is a declared `in-flight` state with transitions
  `project_created → project_selected`, `validation_failed →
  no_projects_empty_state`, `transient_failure → error_recoverable` —
  `journey-project-and-chat-session-management.yaml:88-106`.
- `error_recoverable` explicitly names `creating_project` as an
  originating in-flight state —
  `journey-project-and-chat-session-management.yaml:316-324`.
- `failure_modes` declares `j002_create_project_validation_failed:
  creating_project → no_projects_empty_state (inline form error)` —
  `journey-project-and-chat-session-management.yaml:535-537`.

And the **DESIGN application-architecture (ratified, finalized) already
modeled J-002 as the owner**: the `project-context` projection carries
`context.pending_project_name, context.project_validation_error`,
"Populated when `creating_project` / `error_recoverable`", "Consumed by:
Composer state preservation for US-201 retry" —
`application-architecture.md:1081`.

**Side 2 — Wave-decision D6: J-002 does NOT carry create-project
internal state.**

D6's OUT-of-scope list states project create/delete/rename are
"single-step CRUD … stay use-case-direct … J-002 *observes* their
completion via the projection … but J-002 does NOT carry validation,
naming, or deletion-confirmation state internally" —
`wave-decisions.md:160-166`. Restated in the binding-decisions summary:
"D6: Project create/delete/rename are NOT flows; J-002 observes their
completion but does not encode their state" — `wave-decisions.md:467`.

### 2.2 Where and why it arose

This is a **DISCUSS-internal contradiction**, authored in the same wave
by the same author (Luna, 2026-05-13 — `wave-decisions.md:1-7`,
`US-201.md:1-4`). D6's carve-out **over-generalized from delete/rename
to create**. The valid kernel of D6 is true for delete and rename: those
have no in-flight state worth preserving across `FREEZE`, so they stay
single-step backend CRUD (`wave-decisions.md:186-189`). But **create is
materially different**: it is the *only* exit transition out of
`no_projects_empty_state` (`journey-…​.yaml:71-86`), and the journey
YAML the same wave produced models its in-flight + validation +
recoverable states explicitly. D6's prose swept create into the same
clause as delete/rename without reconciling against the journey YAML it
shipped alongside.

The decisive tell: **DESIGN never propagated D6's carve-out.** DESIGN
followed the journey YAML and US-201, not D6 — the ratified
application-architecture projection table provisions
`pending_project_name` / `project_validation_error` on
`creating_project` / `error_recoverable` precisely "for US-201 retry"
(`application-architecture.md:1081`). D6 is the lone, never-propagated
outlier; the journey SSOT, US-201 AC, IC-J002-2, and the ratified DESIGN
artifact form one coherent side.

### 2.3 RCA consequence today

The RCA had to split the create-project tests on this unreconciled seam
(`j002-mr123-rca-triage.md:252-262`): the observe→`project_selected`
end-state is GENUINE-UNIMPLEMENTED (`test_creating_first_project`,
`test_ic_j002_2_*`); the J-002-internal validation / recoverable-error
assertions are DEFERRED-BY-DESIGN under D6's carve-out
(`test_empty_project_name`, `test_transient_create_project_failure`) —
RCA per-test table `j002-mr123-rca-triage.md:125-126`, with a secondary
TEST-OVER-SPEC dissent recorded. This split is unstable until D6 vs
US-201 is reconciled.

### 2.4 Options matrix — CONFLICT-A

| Option | Precise edit | RCA-bucket effect | Iron-Rule implication | Effort |
|---|---|---|---|---|
| **A1 — Amend D6 to align with the journey SSOT (RECOMMENDED)** | Amend `wave-decisions.md:160-166` + the D6 summary line `:467`: scope the carve-out to **delete/rename + backend-use-case ownership**, explicitly **excepting** the create-project in-flight/validation/recoverable sub-flow that the journey YAML models. No US-201, journey-YAML, IC-J002-2, or DESIGN edit (they are already consistent). | `test_empty_project_name` + `test_transient_create_project_failure`: **DEFERRED → GENUINE-UNIMPLEMENTED** (+2 GENUINE, −2 DEFERRED). `test_creating_first_project` + `test_ic_j002_2_*` already GENUINE; unchanged. | Iron Rule **holds**: all 4 create-path tests now encode in-contract behavior to drive GREEN via TDD. No spec is left wrong; no test must be modified to pass. | **S** (one wave-decision amendment block; zero downstream doc churn). |
| A2 — Amend US-201 + journey YAML to drop internal create-state; uphold D6 | Strike `US-201.md:179-184` (validation + recoverable AC); amend journey YAML `:88-106, :316-324, :535-537` to remove `creating_project` validation/recoverable transitions; skip-mark the 2 tests with the D6 citation; reconcile DESIGN `application-architecture.md:1081` (remove the provisioned context fields). | 2 tests **DEFERRED → skip-marked** (permanent). `test_creating_first_project`/`IC-J002-2` stay GENUINE. DEFERRED 3→1. | Iron Rule holds *only after* a large multi-artifact rewrite; risk of a residual unreconciled DESIGN field. Skips a journey the SSOT models — degrades the US-201 onboarding arc. | **L** (touches US-201, journey YAML, DESIGN, 2 tests; contradicts the promoted SSOT + ratified DESIGN). |
| A3 — Keep US-201 AC; defer internal states to a follow-up slice | Leave US-201 + journey YAML intact; add a wave-decision note that create-validation/recoverable lands in a *later* slice; skip-mark the 2 tests pending that slice's story. | 2 tests **DEFERRED → skip (time-boxed)**; revert to GENUINE when the follow-up slice opens. DEFERRED 3→1. | Iron Rule holds (tests cleanly skipped with a tracked re-entry). But defers committed onboarding value and adds a slice the carpaccio plan did not budget. | **M** (one wave-decision note + 2 skip-marks + a new slice brief later). |

### 2.5 Recommendation — CONFLICT-A: **A1 (amend D6)**

**Rationale, grounded in SSOT + ADRs:**

1. **The journey YAML is the SSOT and it models the create sub-flow.**
   `nw-discuss` promotes the journey YAML to
   `docs/product/journeys/` as the canonical journey contract; it
   declares `creating_project` with `validation_failed` /
   `transient_failure` transitions (`journey-…​.yaml:88-106`) and the
   `j002_create_project_validation_failed` failure mode
   (`:535-537`). Amending D6 makes the audit-trail document agree with
   the SSOT it shipped beside; amending US-201 (A2) would require
   *also* rewriting the SSOT journey — a far larger, lower-integrity
   change that contradicts what DESIGN already built against.

2. **DESIGN already ratified J-002 ownership.** The finalized
   application-architecture provisions `pending_project_name` /
   `project_validation_error` on `creating_project` / `error_recoverable`
   "for US-201 retry" (`application-architecture.md:1081`). D6 is the
   only artifact that ever said otherwise and it was never propagated
   downstream. Reconciling toward the three coherent artifacts (journey
   SSOT + US-201 + DESIGN) and away from the lone outlier is the
   minimum-blast-radius, highest-integrity resolution.

3. **JTBD / journey arc.** US-201 maps to J002-Job-1 (Resume — degraded
   form) plus "the implicit J-002 invariant that entry into J-002 always
   settles in a coherent state" (`US-201.md:6-12`). Empty-name and
   transient-failure are the two ways the *only* exit from
   `no_projects_empty_state` can fail; if J-002 does not own those
   sub-states the first-time-in-org user lands in an incoherent shell —
   the exact orphaning US-201 exists to retire (`US-201.md:32-40`).
   D6's carve-out, taken literally, defeats the story's own job.

4. **ADR-027 / ADR-029 projection-as-SSOT.** ADR-027:27,123 requires the
   harness and FE to read the *same* projection with "no
   FE-internal-only field"; ADR-029:20,25 makes the projection the
   single source of truth the harness asserts against. The validation /
   recoverable state must therefore be *in the machine projection* (not
   FE-local) for the contract to be testable at all — which is exactly
   what DESIGN provisioned. A1 keeps this coherent; A2 would have to
   delete a ratified projection field.

D6's legitimate intent is preserved: J-002 still does **not**
re-implement the backend `create_project` use case, and still does
**not** own delete/rename confirmation flows. A1 narrows the carve-out
to what D6 actually needed to say.

---

## 3. CONFLICT-B — `most_recent_session_per_project` read-shape (OQ-J002-5)

### 3.1 The contradiction, evidenced

**DISCUSS marked OQ-J002-5 non-blocking, deferred to DESIGN.**

- "OQ-J002-5 (read shape) tracked for DESIGN" — `dor-validation.md:58`.
- "Other OQs (… J002-5 projection read shape for
  most-recent-session-per-project) are non-blocking — DESIGN owns them
  but they don't gate any slice" — `dor-validation.md:267-270`.
- US-202 technical note: "The last-used resolution algorithm needs the
  projection to carry `most_recent_session_per_project` OR the
  orchestrator's machine context to query it on entry. DESIGN owns the
  read shape (OQ-J002-5)" — `US-202.md:206-208`.

**DESIGN then specified the field as in-contract.**

The ratified, finalized application-architecture places
`context.most_recent_session_per_project` in the `project-context`
projection context-field table: "Populated when: `resolving_initial_scope`
exit", "Consumed by: Last-used resolution (US-202); FE Projects grid
sort hint" — `application-architecture.md:1078`.

### 3.2 Where and why it arose

This is a **DISCUSS↔DESIGN delta**, not an internal contradiction.
DISCUSS correctly deferred the *read-shape choice* to DESIGN (the OQ
offered two options: projection-carries vs orchestrator-queries —
`US-202.md:206-208`). **DESIGN resolved it** by choosing
"projection-carries" and writing the field into the projection contract
table with a defined population point (`application-architecture.md:1078`).
The delta is only that the RCA, reading DISCUSS's "non-blocking /
deferred" language literally, classified the failing assertion
DEFERRED-BY-DESIGN while recording a GENUINE dissent because DESIGN had
in fact closed the OQ in favor of in-contract
(`j002-mr123-rca-triage.md:127`, `:264-269`). OQ-J002-5 is **resolved**;
what is missing is a *closure note* making that ruling explicit so the
Iron Rule can hold.

### 3.3 RCA consequence today

`test_us202…::test_resolution_picks_project_carrying_most_recent_session`
splits: the core resolution assertion (`:126` `selected==q4_id`)
**passes**; the read-shape assertion (`:133` `q4_id in
context.most_recent_session_per_project`) **fails** (`keys=[]`) and was
bucketed DEFERRED-BY-DESIGN with a GENUINE dissent
(`j002-mr123-rca-triage.md:127`). The exact map shape (keyed by
`project_id`, value = recent-session descriptor) is not pinned at
`application-architecture.md:1078`; US-202's narrative example shows it
illustratively name-keyed (`{"Q4 Analytics": "T+0"}` —
`US-202.md:73-76`) while the test asserts `project_id`-keyed
(`test_us202…:133`). The Iron Rule needs the shape pinned, not just the
field's existence.

### 3.4 Options matrix — CONFLICT-B

| Option | Precise edit | RCA-bucket effect | Iron-Rule implication | Effort |
|---|---|---|---|---|
| **B1 — Ratify DESIGN's closure + pin the shape (RECOMMENDED)** | Add an OQ-J002-5 **closure note**: OQ-J002-5 is RESOLVED by `application-architecture.md:1078` → projection-carries; pin the shape to a map **keyed by `project_id`**, value = `{ session_id, last_active_at }` (the descriptor US-202 resolution needs). No DESIGN edit (it already says projection-carries); the note pins the sub-shape so the assertion is unambiguous. | `test_us202…most_recent_session` read-shape assertion: **DEFERRED → GENUINE-UNIMPLEMENTED** (+1 GENUINE, −1 DEFERRED). | Iron Rule **holds**: the field is in-contract with a pinned shape; the assertion encodes real unimplemented behavior to drive GREEN. | **S** (one closure note; zero artifact churn — DESIGN already chose projection-carries). |
| B2 — Uphold the DISCUSS deferral; declare the field DEVOPS-instrumentation-only / non-contract | Add a note that `most_recent_session_per_project` is observability-only; amend `application-architecture.md:1078` to mark it non-contract / DEVOPS; skip-mark the read-shape assertion. | Assertion stays **DEFERRED → skip-marked** (permanent). DEFERRED unchanged by B; one permanent skip. | Iron Rule holds only by skipping. But this **violates ADR-027:27,123** ("no FE-internal-only field"; harness reads the same projection as the FE) and contradicts `application-architecture.md:1078` which lists US-202 as a *functional* consumer, not instrumentation. | **M** (amends ratified DESIGN; introduces an ADR-027 tension + a permanent skip). |
| B3 — Ratify in-contract but defer the precise sub-shape to DELIVER | Closure note: field in-contract; sub-shape (key/value) "DELIVER's call". Leave the assertion as-is. | Assertion stays **DEFERRED** (shape unpinned → ambiguous). | Iron Rule **does NOT hold**: an unpinned shape means the remediation engineer still cannot tell if `project_id`-keyed vs name-keyed is the contract — the exact ambiguity that blocks TDD today. | S, but **fails the objective** of this pass. |

### 3.5 Recommendation — CONFLICT-B: **B1 (ratify closure + pin shape)**

**Rationale, grounded in SSOT + ADRs:**

1. **DESIGN already resolved the OQ.** `application-architecture.md:1078`
   chose projection-carries and named US-202 a functional consumer. B1
   simply *records* that ruling and pins the residual sub-shape; it does
   not re-litigate a resolved decision. B2 would *reverse* a ratified
   DESIGN artifact.

2. **ADR-027 / ADR-029 forbid B2's framing.** ADR-027:27,123 — the
   harness and FE read the *same* projection, "no FE-internal-only
   field"; ADR-029:25,189 — the harness asserts against the same SSOT
   projection as the FE. A field DESIGN placed in the projection
   context table *is*, by these ADRs, an in-contract field the harness
   may assert. Declaring it instrumentation-only (B2) creates a standing
   ADR-027 violation.

3. **US-202's job needs the map.** US-202 maps to J002-Job-1 (Resume —
   `US-202.md:6`); the last-used resolution *is* the job. The DESIGN
   table names `most_recent_session_per_project` the input to that
   resolution (`application-architecture.md:1078`). It is behavioral,
   not decorative — B3's "defer the shape" leaves the job's contract
   ambiguous and fails this reconciliation's whole purpose (RCA §6.2
   step 1 — unblock correct RED interpretation,
   `j002-mr123-rca-triage.md:287-291`).

4. **Pinning the shape is the deliverable.** The Iron Rule blocks
   precisely because the shape is unpinned (§3.3). B1 pins it to
   `project_id`-keyed (stable per US-202's own tie-break rationale:
   "ids are stable", `US-202.md:209-211`) so the remediation engineer
   has an unambiguous target.

---

## 4. PROPOSED amendment blocks (for overseer ratification)

> **These are PROPOSED. They are NOT applied to the ratified files.**
> The overseer ratifies (or rejects/edits) each block; only then does it
> land in `docs/evolution/2026-05-16-project-and-chat-session-management/`.

### 4.1 PROPOSED — wave-decisions.md D6 amendment (CONFLICT-A / Option A1)

> Insert as an `### D6 — AMENDMENT (2026-05-17, reconciliation pass)`
> block immediately after `wave-decisions.md:189`, and append the
> cross-reference to the summary line `wave-decisions.md:467`.

```markdown
### D6 — AMENDMENT (2026-05-17, J-002 D6/OQ reconciliation; PROPOSED)

D6's OUT-of-scope clause "project create/delete/rename are single-step
CRUD … J-002 does NOT carry validation, naming, or deletion-confirmation
state internally" (this document :160-166) is hereby NARROWED.

WHAT D6 STILL ASSERTS (unchanged):
- J-002 does NOT re-implement the backend create/delete/rename use cases
  (`backend/app/use_cases/project/{create,delete,update}_project.py`).
- J-002 does NOT own project DELETE or RENAME as multi-step flows, and
  carries no deletion-confirmation or rename-edit state internally.

WHAT D6 NO LONGER ASSERTS (the over-generalization, corrected):
- The create-project sub-flow IS owned by J-002. The journey SSOT
  (`discuss/journey-project-and-chat-session-management.yaml:88-106,
  316-324, 535-537`) models `creating_project` as an in-flight state
  with `validation_failed → no_projects_empty_state` and
  `transient_failure → error_recoverable`; DESIGN provisioned
  `context.pending_project_name` / `context.project_validation_error`
  for it (`design/application-architecture.md:1081`). `creating_project`
  is the ONLY exit from `no_projects_empty_state`; its empty-name
  validation state and transient-failure recoverable state are
  J-002-internal and in-contract, exactly as US-201 AC requires
  (`discuss/stories/US-201.md:175-184`) and IC-J002-2 asserts
  (`tests/acceptance/project-and-chat-session-management/test_journey_invariants_j002.py:204-225`).

RATIONALE: D6 is the only artifact in the DISCUSS set that excluded
create-project internal state; the journey SSOT, US-201 AC, IC-J002-2,
and the ratified DESIGN application-architecture all model J-002 as the
owner and were never reconciled to D6. This amendment removes the lone
contradiction with minimum blast radius and no SSOT/DESIGN churn.
```

> And at `wave-decisions.md:467`, append: "— **AMENDED 2026-05-17**: the
> carve-out covers delete/rename only; the create-project
> in-flight/validation/recoverable sub-flow IS J-002-owned (see D6
> AMENDMENT)."

### 4.2 PROPOSED — US-201 AC clarifying footnote (CONFLICT-A / Option A1)

> US-201's AC needs **no change** under A1 (it is already correct). A
> one-line provenance footnote is proposed for traceability only.
> Append after `US-201.md:188`:

```markdown
> **Reconciliation note (2026-05-17, PROPOSED)**: AC bullets for
> `creating_project` / empty-name / transient-failure were transiently
> in tension with wave-decision D6's CRUD carve-out. Reconciled in
> favor of these AC (and the journey SSOT + DESIGN, which already agree)
> via the D6 AMENDMENT in `discuss/wave-decisions.md`. No AC text
> changed.
```

### 4.3 PROPOSED — OQ-J002-5 closure note (CONFLICT-B / Option B1)

> Insert as a new closure subsection in `dor-validation.md` after
> `:270`, and append a back-reference at `US-202.md:208`.

```markdown
### OQ-J002-5 — CLOSURE (2026-05-17, reconciliation pass; PROPOSED)

OQ-J002-5 ("projection read shape for most-recent-session-per-project",
flagged non-blocking at :58 and :267-270) is **RESOLVED**.

RESOLUTION: DESIGN chose **projection-carries** (not
orchestrator-queries). `context.most_recent_session_per_project` is an
IN-CONTRACT field of the `project-context` projection, "Populated when
`resolving_initial_scope` exit", functional consumer US-202 last-used
resolution (`design/application-architecture.md:1078`). Per ADR-027:27,123
and ADR-029:25,189 a field in the projection context table is read by
the harness and the FE identically — it is in-contract, not
instrumentation-only.

PINNED SHAPE (residual sub-shape, pinned here so the contract is
unambiguous for TDD): a map **keyed by `project_id`** (ids are stable
per US-202.md:209-211; names are not), value =
`{ session_id: string, last_active_at: string }` — the descriptor the
US-202 last-used resolution and the FE Projects grid sort hint consume.
US-202's narrative example (`US-202.md:73-76`) is name-keyed for
readability only and is NOT the wire shape.

EFFECT: the `test_us202…test_resolution_picks_project_carrying_most_recent_session`
read-shape assertion (`:133`, `q4_id in
context.most_recent_session_per_project`) is IN-CONTRACT →
GENUINE-UNIMPLEMENTED, not DEFERRED.
```

> And at `US-202.md:208`, append: "— **CLOSED 2026-05-17**: OQ-J002-5
> resolved projection-carries, `project_id`-keyed; see
> `discuss/dor-validation.md` OQ-J002-5 CLOSURE."

---

## 5. Net RCA-bucket movement if BOTH recommendations are accepted

Baseline (RCA §6.1, `j002-mr123-rca-triage.md:277-283`): GENUINE 23 ·
DEFERRED 3 · ENVIRONMENTAL 6 · TEST-OVER-SPEC 0 · total 32.

| Move | Test(s) | Δ |
|---|---|---|
| A1 | `test_us201…test_empty_project_name_keeps_machine_in_no_projects` | DEFERRED → GENUINE |
| A1 | `test_us201…test_transient_create_project_failure_lands_in_error_recoverable…` | DEFERRED → GENUINE |
| B1 | `test_us202…test_resolution_picks_project_carrying_most_recent_session` (read-shape assertion) | DEFERRED → GENUINE |

**Resulting buckets**: **GENUINE 26 · DEFERRED 0 · ENVIRONMENTAL 6 ·
TEST-OVER-SPEC 0 · total 32 (unchanged).**

The DEFERRED-BY-DESIGN bucket **empties to zero**. No permanent skips are
introduced. Every previously-ambiguous test now encodes in-contract
behavior to drive GREEN via Outside-In TDD — the spec is unambiguous, so
the Iron Rule holds for the entire downstream remediation. The 6
ENVIRONMENTAL (`tsx` not installed) are untouched by this pass (RCA §6.2
step 2 — separate, zero-product-code fix).

Downstream effort note (informational, not part of this pass): the two
A1 transient/fault-injection tests additionally depend on the
`X-Force-Create-Project-Failure` fault-injection contract that was never
built (`j002-mr123-rca-triage.md:126`); B1 needs the resolver to emit
the map on `resolving_initial_scope` exit. These are DELIVER scope; the
bucket reclassification (DEFERRED→GENUINE) is correct regardless because
they are now unambiguously in-contract.

---

## 6. Reviewer verdict

> Populated after dispatching `nw-product-owner-reviewer` (the nw-discuss
> hard gate) on this proposal. See §6.1.

### 6.1 nw-product-owner-reviewer findings

**Grade: A (Excellent).** CRITICAL: none. MAJOR: none. The reviewer
independently verified all load-bearing citations against source
artifacts and found the conflict logic sound for both A and B:

- CONFLICT-A: confirmed the journey YAML (`:88-106, :316-324,
  :535-537`), US-201 AC (`:175-184`), IC-J002-2
  (`test_journey_invariants_j002.py:204-225`), and DESIGN
  (`application-architecture.md:1081`) form one coherent side; D6 is
  "a lone, never-propagated outlier". A1 reasoning "sound".
- CONFLICT-B: confirmed `application-architecture.md:1078` places
  `most_recent_session_per_project` in the projection context table as
  a US-202 functional consumer; the ADR-027 "no FE-internal-only
  field" argument against B2 is "valid"; B1 is "the minimum-blast-radius
  resolution". Shape-pin to `project_id`-keyed correctly grounded in
  `US-202.md:209-211`.
- Options matrices: "complete and honest (no strawman alternatives)".
- §4 amendment blocks: "properly marked PROPOSED … not applied to
  files".
- §5 arithmetic: independently re-derived `23+2+1=26`, `3−2−1=0`,
  total 32 — "correct".

Two MINOR (procedural-completeness) notes, both now resolved here:

1. *ADR-027/029 line citations not re-read by the reviewer.* Resolved:
   verified directly against source. `adr-027-…​.md:27` — "The TS
   harness and the FE MUST read from the same projection. No parallel
   state. No FE-internal-only state."; `:123` — "The FE and the TS
   harness consume identical JSON. No parallel state. No
   FE-internal-only field." `adr-029-…​.md:25` — "TS harness symmetry.
   The harness reads `active_scope` from the same projection the FE
   reads."; `:189` — "The TS harness has a first-class assertion
   surface (`assert_scope({...})`) that reads from the same SSOT as the
   FE." The §2.5(4) and §3.5(2) arguments stand as cited.
2. *Journey-YAML SSOT location.* Resolved: the journey YAML exists in
   BOTH the feature-evolution copy
   (`docs/evolution/2026-05-16-…/discuss/journey-project-and-chat-session-management.yaml`)
   and the promoted product SSOT
   (`docs/product/journeys/project-and-chat-session-management.yaml`) —
   confirmed present at HEAD `707079a`. The proposal's "journey YAML is
   the SSOT" framing is accurate; the citations use the evolution copy
   (the wave's audit-trail location), whose content is the promoted
   SSOT.

**Reviewer recommendation to overseer**: accept A1 + B1 as recommended;
confirm the three §4 blocks are inserted verbatim with no edits to
existing AC/stories; after ratification the §5 reclassification (23→26
GENUINE, 3→0 DEFERRED) becomes canonical and Iron-Rule-safe DELIVER may
proceed.
