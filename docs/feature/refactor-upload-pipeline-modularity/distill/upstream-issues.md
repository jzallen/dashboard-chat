<!-- DES-ENFORCEMENT : exempt -->
# Upstream Issues — `refactor-upload-pipeline-modularity` — DISTILL

**Feature:** refactor-upload-pipeline-modularity
**Wave:** DISTILL
**Date:** 2026-05-10
**Author:** Quinn (nw-acceptance-designer)

## Findings

**No upstream issues surfaced during DISTILL.**

ADR-022 (Proposed 2026-05-10) and DESIGN's companion artifacts
(`design.md`, `c4-diagrams.md`, `wave-decisions.md`,
`upstream-changes.md`) were sufficient to derive every acceptance
scenario without a single back-propagation question. The decision
drivers are well-documented; the migration phases (Mikado steps 0-6)
decompose cleanly into 4 DISTILL phases (00 → 03); the
behaviour-preservation contract is enumerated at the level of
individual existing tests (15 tests at
`backend/tests/use_cases/dataset/test_create_dataset_from_upload.py`).

Specifically:

1. **Driving port is concrete.** `create_dataset_from_upload` is the
   sole public entry point for the upload pipeline; the only in-tree
   caller is `DatasetController.post_dataset` (DESIGN §5). No
   ambiguity about where the acceptance scenarios should drive in.

2. **The asymmetry to preserve is named, characterized, and
   bounded.** DESIGN §1 problem statement bullet (2) names it (multi
   writes `dataset_ids`/`dataset_id` to outbox payload; single
   does NOT). DESIGN §7 Risks #1 categorizes it as **Critical** and
   prescribes the absence-assertion test as the mitigation. ADR-022
   §Behaviour-preservation-guarantees + §Confirmation lists it as a
   required deliverable. DWD-2 in DESIGN's wave-decisions.md binds
   it as a HARD GATE. THIS DISTILL's `milestone-2-asymmetry-preservation.feature`
   pins both halves at the acceptance level.

3. **Existing characterization layer is enumerated.** The 15 tests
   at `test_create_dataset_from_upload.py` (6 base + 4 plugin + 5
   characterization) cover the existing observable surface; ADR-022
   §Confirmation requires they stay byte-for-byte green. The Iron
   Rule fence is mechanically verifiable (`git diff` exit criterion
   in `roadmap.json`'s Phase 00 manual review gate).

4. **Failure modes are listed and mapped to scenarios.** DESIGN §7
   Risks table maps directly to milestone scenarios:
   - "Outbox payload asymmetry inadvertently aligned" → milestone-2
     all three scenarios.
   - "MultiProcessingResult validator change breaks an out-of-tree
     caller" → unit-test-layer concern (covered by the negative
     test in `roadmap.json` Phase 00 exit criteria, not by an
     acceptance scenario).
   - "Plugin-protocol stability" → exercised indirectly by every
     milestone-1 scenario (the existing mock plugins must continue
     to satisfy the protocol).
   - "_converted_content ducktype misfires" → out of acceptance
     scope; covered by dispatcher unit tests in
     `roadmap.json` Phase 01 (per ADR-022 §Confirmation).
   - "120s timeout moves into the dispatcher" → out of acceptance
     scope; covered by dispatcher unit tests (timeout firing
     scenario).
   - "CSV fallback path moves into the dispatcher" → milestone-1
     no-registry CSV fallback scenario.
   - "Iron-Rule violation during refactor" → DWD-9 in this distill's
     wave-decisions; mechanically verified.
   - "Latent HTTP-controller bug for multi-dataset uploads" →
     milestone-3 multi-upload scenario pins today's TypeError as
     the preserved observable (out-of-scope to fix; in-scope to
     characterize).
   - "Parallel work collision" → DWD-9 in DESIGN's wave-decisions:
     zero file overlap with `refactor-metadata-repository-split`
     and `extract-dataset-query-port`. Verified at this DISTILL's
     authoring time by grepping for the targeted files in the
     parallel features' scaffolds — none match.
   - "Phase-2 dbt-test-validation collision" → read-only fence
     honoured at DESIGN; this DISTILL does not touch
     `backend/app/use_cases/project/_dbt/`,
     `tests/integration/dataset_layer/eject/`,
     `tests/integration/dataset_layer/harness.py`, or
     `tests/acceptance/dbt-test-validation/`.

## Skipped waves

The DISCUSS-skip routing per CLAUDE.md brownfield (refactor with cause
known — proactive modularity → DESIGN entry) did NOT cost anything in
DISTILL. Every acceptance criterion derives from ADR-022's
behaviour-preservation contract + DESIGN's binding decisions + the
existing characterization tests' enumerated surface. There are no
user stories to trace (no story IDs exist for this feature; recorded
as DWD-10 in this distill's wave-decisions.md); skipping Dim 8 Check
A traceability for that reason is acknowledged in the wave-decisions
self-review checklist and documented here as the audited trail.

DEVOPS was empty (DWD-9 in DESIGN's wave-decisions: "no new external
integration; no DEVOPS contract-test annotation needed"). The
acceptance suite's environment is "in-process aiosqlite +
boto3.Stubber" — a single substrate, no compose stack, no env-vars-
with-defaults parameter matrix needed. Dim 8 Check B
(Environment-to-Scenario mapping) reduces to one environment, trivially
covered by every scenario's Background ("a fresh SQLite-backed
repository container" + "a stubbed object-store client wired into the
lake repository").

## Reconciliation with existing-test convention

One point of light tension worth recording — not a contradiction, but a
deliberate choice this DISTILL makes about how the acceptance suite
relates to the existing `test_create_dataset_from_upload.py`:

- **The 15 existing tests use `boto3.stub.Stubber` directly** (per
  `s3_read_write_stubber` and the inline Stubber constructions at
  lines 33-49 + 264-274 + 313-323 + 467-475 + 522-532 + 579-589 +
  645-658 + 768-799 + 848-855 + 968-974 + 1025-1031 of that file).
- **The new acceptance suite mirrors the same pattern** — the
  `given_stubbed_object_store` step constructs the same kind of
  Stubber and the use-case override `partial(MinIOLakeRepository,
  s3_client=stubber.client)` is the same shape.

This alignment is intentional. It means:
- DELIVER's Phase 00 conftest implementation can lift fixture code
  directly from `test_create_dataset_from_upload.py`'s Stubber
  patterns; no novel infrastructure.
- A reviewer reading both files sees the same pattern; the
  acceptance suite is not introducing a new style or substrate.
- If the existing test file's substrate pattern ever needs to change
  (e.g., to a real MinIO container in CI), this acceptance suite
  changes in lockstep without producing a divergent style.

The mild risk is that someone reads the acceptance suite and assumes
"this is how all acceptance tests should drive S3 — through a Stubber
pattern lifted from the unit-ish tests." That risk is mitigated by
DWD-1's strategy declaration in this distill's wave-decisions: the
choice is justified by the substrate the existing tests pin behaviour
against, NOT by a general "always use Stubber" principle. Other
features may legitimately drive against a real MinIO container if
their behaviour-preservation contract requires it (the
`refactor-metadata-repository-split` distill made the equivalent
choice for SQLAlchemy + aiosqlite for the same reason).

## Format note

This file exists as a placeholder for the DESIGN→DISTILL contract:
"if DISTILL surfaces any gap or contradiction in upstream waves,
record it here so DELIVER and future architects can trace the
back-propagation." For this feature, the file documents the
deliberate alignment-with-existing-tests choice (the only point of
non-trivial DISTILL discretion) and is otherwise an empty placeholder
by design.

If a gap surfaces during DELIVER's TDD cycle, the software-crafter
should append findings here rather than silently re-interpreting the
ADR.
