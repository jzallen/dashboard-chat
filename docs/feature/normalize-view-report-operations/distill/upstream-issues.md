<!-- DES-ENFORCEMENT : exempt -->
# Upstream Issues — `normalize-view-report-operations` — DISTILL

**Feature:** normalize-view-report-operations
**Wave:** DISTILL
**Date:** 2026-07-24
**Author:** Quinn (nw-acceptance-designer)

## Findings

**None — reconciliation passed, 0 contradictions.**

DISCUSS (`user-stories.md`, `story-map.md`, `prioritization.md`,
`wave-decisions.md`) and DESIGN (`domain-model.md`, `c4-component.md`,
`wave-decisions.md`, ADR-052) were sufficient to derive every acceptance
scenario without a single back-propagation question. No DISCOVER/DESIGN
assumption was overturned in DISTILL.

## Checks run

1. **Story ↔ slice ↔ Linear mapping.** DISCUSS defined 9 carpaccio slices
   (`slices/slice-00..slice-08`) and grouped stories onto them in `story-map.md`
   — a Release Slice groups one or more stories, not inherently 1:1 — tracking to
   Linear stories DC-80..DC-88. Verified each slice brief's `Traces:` line against
   the matching story `Traces:` line in `story-map.md` and against the acceptance
   `.feature` tags. No drift. (DELIVER will map roadmap steps to scenarios; the
   roadmap does not exist yet.)

2. **AC/probe coverage closure.** `user-stories.md` §"Requirements completeness"
   asserts every ADR-052 AC1–AC7 and probe P1–P5 maps to ≥1 story. Cross-checked
   against ADR-052 §"Acceptance Criteria" + §"Earned Trust" and against the
   scenario set: every AC/probe has ≥1 acceptance scenario. No orphan AC, no
   orphan scenario.

3. **Dependency-chain consistency.** The `blocked by` lines across
   `prioritization.md`, `story-map.md`, and each slice brief agree: 00 gates 02;
   01 + 03 gate 04; 03 gates 05, 06; 04 + 06 gate 07; 03–07 gate 08. This is the
   ordering DISTILL surfaces for the DELIVER roadmap to encode. The one nuance —
   02 is `blocked by 00, 01` in the story/prioritization but only `blocked by 00`
   in the story-map slice table — is not a contradiction: story-map lists the hard
   render-safety gate (00), the story lists both the gate and the typed-column
   prerequisite (01). Both are surfaced for DELIVER (slice 02 depends on slice 01's
   typed columns; slice 00 is the hard manual-review gate). Recorded here for the
   audit trail.

4. **Open-question routing honoured.** OQ-1 (normalize `source_refs`) is a
   non-goal/follow-on and correctly out of scope. OQ-2 (`report_type`
   structural-vs-label) and OQ-3 (`relation_grain` cardinality) were routed to
   DISTILL and are RESOLVED here (wave-decisions DWD-2, DWD-3) with `file:line`
   grounding. OQ-4 (polymorphic-cascade enforcement mechanism) was routed to
   DELIVER and is left to DELIVER with a mechanism-agnostic acceptance scenario
   pinning the observable outcome (DWD-6). No open question was resolved in the
   wrong wave.

5. **Driving-port concreteness.** Every AC names a concrete driving port that
   exists today: `RepositoryContainer.metadata` (view/report persistence — the
   facade's `__getattr__` routes `create_view`/`get_view`/`create_report`/
   `get_report` to `MetadataRepository`, confirmed at
   `backend/app/repositories/metadata/_legacy_facade.py:90` +
   `repository.py:979,1013,1067,1099`); the `create_view` / `create_report`
   use-case functions; the public compiler entry points. No ambiguity about
   where scenarios drive in.

6. **Code-map grounding.** Every code-map target in the dispatch brief
   (compilers, validation, exceptions, models, ORM records, repo methods, use
   cases) was spot-checked against the actual files. All line references
   resolve; the `report_ibis_compiler.py` entity-only branch (l108–113) and the
   `ViewIbisCompiler.generate_executable` path (l124–152) confirm the
   render-equivalence baseline the walking skeleton pins.

## Skipped waves

JTBD was intentionally skipped (DISCUSS D1 — internal backend refactor). There
are no `journeys/*.yaml` for this feature; traceability anchors to ADR-052 ACs +
probes, which are the validated behavioral specs. Skipping journey traceability
for that reason is acknowledged in `wave-decisions.md` §Reconciliation and
documented here as the audited trail. No `kpi-contracts.yaml` applies (no
user-facing metric — soft gate warned and skipped). No DEVOPS handoff (DESIGN
recorded no external integration / no new runtime dependency / no topology
change); the acceptance environment reduces to one substrate (in-process
aiosqlite + in-process ibis), trivially covered by every scenario's setup.

## uv.lock

Generated successfully via `cd tests/acceptance/normalize-view-report-operations
&& uv lock` (uv 0.x, CPython 3.11.15; 75 packages resolved). The suite was
synced and the walking-skeleton scenario executed — it is RED-by-assertion at the
`render_characterization` scaffold, not BROKEN. No uv unavailability to report.

## Format note

If a gap surfaces during DELIVER's TDD cycle, the software-crafter should append
findings here rather than silently re-interpreting ADR-052 or the slice briefs.
