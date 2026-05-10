<!-- DES-ENFORCEMENT : exempt -->
# Upstream Issues — `refactor-metadata-repository-split` — DISTILL

**Feature:** refactor-metadata-repository-split
**Wave:** DISTILL
**Date:** 2026-05-10
**Author:** Quinn (nw-acceptance-designer)

## Findings

**No upstream issues surfaced during DISTILL.**

ADR-020 (Proposed 2026-05-10) and DESIGN's companion artifacts
(`design.md`, `c4-diagrams.md`, `wave-decisions.md`) were sufficient to
derive every acceptance scenario without a single back-propagation
question. The decision drivers are well-documented; the migration
phases (A → B → C) decompose cleanly into 4 DISTILL phases (00 → 03);
the behaviour-preservation contract (§0 of `distill/distill.md`)
enumerates exactly what the scenarios must pin.

Specifically:

1. **Driving port is concrete.** `RepositoryContainer` is the entry
   point every use case already accesses; no ambiguity about where
   the acceptance scenarios should drive in.
2. **Aggregate boundary is empirically validated.** Eight per-aggregate
   test files at `backend/tests/repositories/test_*_repository.py`
   already match the proposed eight-class split (DESIGN §0
   confirmation checklist). The aggregate decomposition is not
   speculative.
3. **Facade contract is fully enumerated.** The 35 methods on
   `MetadataRepository` (DESIGN §1) and the 8 dict-mapper functions in
   `metadata/_mappers.py` give a complete observable surface to assert
   parity against.
4. **Failure modes are listed.** DESIGN §7 risks-and-mitigations
   table maps directly to milestone scenarios:
     - "Facade drift — a use case bypasses container property" →
       milestone-2 archon-rule scenario.
     - "Migration stalls between phases B and C" → DWD-2 in this
       wave-decisions.md authorises the deprecation-warning emission
       scenario in milestone-1.
     - "Use case touching multiple aggregates becomes verbose" →
       acceptance scenarios do not test this; it is a design
       trade-off, not a behaviour change.
     - "Test-conftest fixtures need updating" → roadmap Phase 00 +
       Phase 01 exit criteria require zero test-body edits and the
       conftest swap at fixture level only.
     - "Concurrent `extract-dataset-query-port` design dispatch" →
       parallel feature; orthogonal layers per ADR-020 §Cross-decision
       composition; verified at this distill's authoring time by
       grepping for `Dataset` in the parallel feature's `walking-skeleton.feature`
       (it lives in the model layer; this feature lives in the
       repository layer).
     - "Phase 2 dbt-test-validation in-flight code" → read-only fence
       honoured at DESIGN; this distill does not touch
       `backend/app/use_cases/project/_dbt/` or `tests/acceptance/dbt-test-validation/`.

## Skipped waves

The DISCUSS-skip routing per CLAUDE.md brownfield (refactor with cause
known → DESIGN entry) did NOT cost anything in DISTILL. Every
acceptance criterion derives from ADR-020 §"Decision drivers" + the
behaviour-preservation contract enumerated in `distill/distill.md` §0.
There are no user stories to trace (no story IDs exist for this
feature); skipping Dim 8 Check A traceability for that reason is
acknowledged in the wave-decisions.md self-review checklist and
documented here as the audited trail.

DEVOPS was empty (DWD-9 in DESIGN's wave-decisions: "no new external
integration; no DEVOPS contract-test annotation needed"). The
acceptance suite's environment is "in-process aiosqlite" — a single
substrate, no compose stack, no env-vars-with-defaults parameter
matrix needed. Dim 8 Check B (Environment-to-Scenario mapping) reduces
to one environment ("in-memory SQLite"), trivially covered by every
scenario's Background.

## Format note

This file exists as a placeholder for the DESIGN→DISTILL contract:
"if DISTILL surfaces any gap or contradiction in upstream waves,
record it here so DELIVER and future architects can trace the
back-propagation." For this feature, the file is empty by design.

If a gap surfaces during DELIVER's TDD cycle, the software-crafter
should append findings here rather than silently re-interpreting the
ADR.
