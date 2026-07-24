<!-- DES-ENFORCEMENT : exempt -->
# Upstream Issues — `normalize-view-report-operations` — DISTILL

**Feature:** normalize-view-report-operations
**Wave:** DISTILL
**Date:** 2026-07-24
**Author:** Quinn (nw-acceptance-designer)

## Findings

**One back-propagation overturn — the characterization / walking-skeleton gate is superseded (RESOLVED: upstream artifacts amended).**

A product-owner decision overturned a DESIGN-time assumption: there is **no legacy/production View or Report data** (View/Report are display-only in the UI; the Agent→View/Report generation path is untested). Therefore the "render-equivalence characterization test pinning byte-identical SQL of existing/seeded relations, authored as a brownfield **walking-skeleton** gate before the renderer merge" is no longer valid. It is replaced by a **self-contained in-test pre-vs-post equivalence** (for a fixture built in the test, the consolidated renderer must produce the same SQL as the separate compilers), and there is **no walking skeleton** — the gate is a RED acceptance test per scenario (DISTILL DWD-1).

The render-equivalence *property* is unchanged; only its framing (characterization-of-legacy + walking-skeleton gate) was dropped. The upstream artifacts have been **amended to match** (ADR-052 was `Proposed`; the property is preserved, the characterization/walking-skeleton gate removed):

- `docs/decisions/adr-052-normalize-view-report-operations-ir.md` — §Negative trade-offs, §Acceptance Criteria (render equivalence), and §Earned Trust (render-equivalence probe) reframed to a self-contained in-test pre-vs-post equivalence.
- `docs/feature/normalize-view-report-operations/design/wave-decisions.md` (DISTILL hand-off) and `design/evaluation.md` (Option 4B cons + reliability row): same reframe.

Everything else: DISCUSS (`user-stories.md`, `story-map.md`, `prioritization.md`, `wave-decisions.md`) and DESIGN (`domain-model.md`, `c4-component.md`) were sufficient to derive every acceptance scenario without further back-propagation.

## Checks run

1. **Story ↔ slice ↔ Linear mapping.** DISCUSS defined the carpaccio slices and
   grouped stories onto them in `story-map.md` — a Release Slice groups one or
   more stories, not inherently 1:1 — tracking to Linear stories DC-81..DC-88. The
   render-characterization walking-skeleton slice (slice 00 / DC-80) was DROPPED:
   the product owner directs a RED acceptance test per scenario as the DELIVER
   gate (not a vertical walking-skeleton slice), and render-equivalence survives
   as a self-contained in-test pre-vs-post property rather than a golden snapshot,
   since there is NO legacy/production View/Report data and View/Report are
   display-only. The remaining 8 stories (01–08) each own one acceptance
   `.feature`. Verified each story brief's `Traces:` line against the matching
   story `Traces:` line in `story-map.md` and against the acceptance `.feature`
   tags. No drift. (DELIVER maps one roadmap step per scenario; the roadmap does
   not exist yet.)

2. **AC/probe coverage closure.** `user-stories.md` §"Requirements completeness"
   asserts every ADR-052 AC1–AC7 and probe P1–P5 maps to ≥1 story. Cross-checked
   against ADR-052 §"Acceptance Criteria" + §"Earned Trust" and against the 27
   scenarios: every AC/probe has ≥1 acceptance scenario. AC1 (reproducible render)
   is covered by story 02's pre-vs-post in-test equivalence scenario (the
   consolidated renderer produces the same SQL as the separate compilers for the
   same in-test relation), not by a characterization snapshot. No orphan AC, no
   orphan scenario.

3. **Dependency-chain consistency.** The `blocked by` lines across
   `prioritization.md`, `story-map.md`, and each story brief agree: 01 + 03 gate
   04; 03 gates 05, 06; 04 + 06 gate 07; 03–07 gate 08. This is the ordering
   DISTILL surfaces for the DELIVER roadmap to encode. Story 02 (renderer
   consolidation) depends on story 01's typed columns. These are genuine data/code
   dependencies between stories, not characterization gates. Recorded here for the
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
   render-equivalence baseline story 02's in-test pre-vs-post comparison asserts.

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
&& uv lock` (uv 0.x, CPython 3.11.15; 75 packages resolved). The suite was synced
and collects cleanly — 27 scenarios, all `@pending`, deselected by default under
`-m "not pending"`; every milestone step binds to a `pytest.fail` DISTILL
scaffold, so scenarios are RED-by-assertion, not BROKEN. No uv unavailability to
report.

## Format note

If a gap surfaces during DELIVER's TDD cycle, the software-crafter should append
findings here rather than silently re-interpreting ADR-052 or the slice briefs.
