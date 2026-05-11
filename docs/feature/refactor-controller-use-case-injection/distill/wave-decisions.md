<!-- DES-ENFORCEMENT : exempt -->
# Distill-Wave Decisions (DWDs) — Controller use-case injection refactor

**Feature slug:** `refactor-controller-use-case-injection`
**Wave:** DISTILL
**Status:** Proposed
**Companion:** `roadmap.json`, `upstream-issues.md`, `tests/acceptance/refactor-controller-use-case-injection/{walking-skeleton,milestone-1-kwarg-injection,milestone-2-test-migration,milestone-3-architectural-enforcement}.feature`
**Inherits binding constraints from DESIGN:** ADR-023 + `docs/feature/refactor-controller-use-case-injection/design/wave-decisions.md` (DWD-1 through DWD-9).

DWDs are binding for downstream waves (DELIVER). Any deviation requires an amendment recorded against the DWD by number.

---

## DWD-1 — `_use_cases` is the canonical kwarg name (back-propagated to DESIGN)

**Decision.** The keyword-only injection parameter on every per-aggregate controller method is named **`_use_cases`** (full word, leading underscore). The leading underscore preserves the "test-seam, not public API" signal; the full word `use_cases` improves readability over the original `_uc` sketch.

**Authority.** User-ratified during DISTILL; back-propagated to DESIGN docs (ADR-023, `design.md`, `c4-diagrams.md`, `wave-decisions.md`, `upstream-changes.md`) so DESIGN and DISTILL agree on the canonical name before DELIVER reads either.

**Rationale.** User-ratified compromise between `_uc` (original sketch in early DESIGN drafts — terse, matched the existing `_uc()` getter convention) and `use_cases` (alternative — readable, but missing the underscore-prefix-as-test-seam convention). The chosen name `_use_cases` keeps the underscore-prefix-as-test-seam convention while improving readability for new readers who haven't internalised the `_uc()` shorthand.

**Disambiguation rule (carried forward from the rename mechanic).** The rename applies only to **kwarg-position** references:

- `_uc=` / `_uc:` (parameter position, describing the NEW kwarg) → `_use_cases=` / `_use_cases:`
- `_default_<aggregate>_uc` (factory function name) → **KEEP AS-IS** (factory naming is separate from kwarg naming; user's intent was to rename the parameter only)
- `_uc()` (call expression in CURRENT code being replaced) → **KEEP AS-IS** (describes what exists today)
- `_uc` mentioned in narrative prose as "the existing getter" → **KEEP AS-IS**

**Back-propagation status (recorded as a process artefact in `upstream-issues.md`).**

- Files inspected: 5 (ADR-023, design.md, c4-diagrams.md, wave-decisions.md, upstream-changes.md).
- Kwarg-position substitutions applied to DESIGN: 0. The DESIGN docs as written already use `_use_cases=` in every kwarg-position reference. Every remaining `_uc` token in DESIGN falls into the KEEP-AS-IS buckets above (factory names, current-code call expressions, narrative prose about the existing getter). The rename was therefore already in effect at DESIGN authoring time; this DWD records the convention so DELIVER does not regress it.
- DISTILL acceptance artefacts (the four `.feature` files + `steps/controller_di_steps.py` + `conftest.py`) already use `_use_cases=` exclusively in kwarg position.

**Concrete test for compliance (CI-checkable, hand-off to DELIVER).** After DELIVER:

```bash
# Every public method on a per-aggregate controller declares `_use_cases=`.
grep -rn "_use_cases" backend/app/controllers/*_controller.py | grep -v "^#" | wc -l   # ≥ 35 (one per public method across 8 controllers)

# No kwarg named `_uc` survives in production code.
grep -rn ", *_uc=" backend/app/controllers/   # → empty
grep -rn ", *_uc:" backend/app/controllers/   # → empty

# Factory names are unchanged.
grep -rn "def _default_.*_uc(" backend/app/controllers/*_controller.py | wc -l   # ≥ 14 (1×report, 1×project, 1×query_engine, 1×sql_access, 1×organization, 1×view, 3×dataset, 5×conversation)
```

**Out of scope.** Renaming the existing `_uc()` getter mechanism (it is being deleted, not renamed); renaming the `_default_<aggregate>_uc` factory functions; renaming any `mock_uc` / `fake_uc` test-local variable names (they are caller-side identifiers, not part of the contract).

---

## DWD-2 — Walking-skeleton scope: `OrganizationController.get_my_organization`

**Decision.** The walking-skeleton scenario (Phase 00 in `roadmap.json`) targets a single controller method end-to-end: **`OrganizationController.get_my_organization`**. The scenario invokes the production controller class with `_use_cases=lambda: fake` and asserts the returned envelope reflects the fake's data.

**Authority.** This DISTILL DWD-2; consistent with DESIGN DWD-2 step 1 ("start with the smallest surface").

**Rationale.**

- `OrganizationController` is the smallest aggregate controller (2 public methods total: `get_my_organization` + `post_organization`).
- `get_my_organization` is the smallest method on that controller — one input (`user`), one happy path, no kwargs to thread through.
- The existing characterization test file `backend/tests/controllers/test_organization_controller_char.py` is the lightest of the seven char-test files (7 patches across 7 tests; smallest blast radius for a Phase 00 demo migration).
- Choosing the smallest aggregate first matches DESIGN DWD-2 step 1.

**Driving port.** `OrganizationController.get_my_organization` (the controller method itself, called as a static method, exactly as `routers/organizations.py:39` calls it today). **Observable.** The `tuple[dict, int]` envelope the method returns. The fake injected via `_use_cases=` lets the scenario assert that what the controller emits is what the fake returned — i.e. the kwarg actually wired through instead of being silently ignored.

**Litmus test (Mandate 1, Dim 9d).** "If I deleted the real `_default_<aggregate>_uc` default-binding mechanism, would this WS still pass?" **NO** — without the kwarg threading through to the call expression, the production controller would fall back to its own default factory and the fake's data would never appear in the response. WS proves real wiring, not a stub.

---

## DWD-3 — Real-IO strategy: the Python kwarg-default-binding mechanism IS the adapter

**Decision.** This refactor's "driving adapter" is the Python language's keyword-only-default-binding mechanism on the production controller classes. There is no compose stack, no SQLite, no MinIO, no auth-proxy, no subprocess. Every scenario imports the production controller class from `app.controllers.<aggregate>_controller` and invokes its public staticmethods directly — exactly as `backend/app/routers/<aggregate>s.py` calls them today, plus the new `_use_cases=` keyword argument that DELIVER introduces.

**Authority.** This DISTILL DWD-3; consistent with DESIGN DWD-7 (no probe required; no substrate that can lie).

**Implication for fixtures.** The acceptance suite's `conftest.py` declares `fake_use_cases_factory` as the only nontrivial fixture. There are no `tmp_path`-based environment fixtures, no `@pytest.fixture(params=[...])` matrices, no parametrisation across "clean / with-pre-commit / with-stale-config" environments — those concepts do not apply when the only adapter is in-process Python call mechanics. (Mandate 4 satisfied trivially: there is no impure code to extract behind an adapter; the controller body is pure orchestration over a use-case module reference.)

**Compliance with Mandate 1 (Hexagonal Boundary).** Every `@when` step invokes the controller method as a staticmethod call. No step body imports `_default_<aggregate>_uc`, `_serialize`, `_error_response`, or any other internal helper.

---

## DWD-4 — Iron Rule binding for the bundled test rewrite (inherited from DESIGN DWD-6)

**Decision.** The acceptance suite's milestone-2 scenarios encode DESIGN DWD-6's Iron Rule contract. No assertion in `backend/tests/controllers/test_*_char.py` or `test_http_controller.py` is modified to make the refactor pass. The "byte-identical assertion lines" scenario in `milestone-2-test-migration.feature` is the executable test of that contract.

**Authority.** Inherits from DESIGN DWD-6; this DISTILL DWD-4 records how the contract is encoded in the acceptance suite.

**Mechanism.** A scenario captures the assertion bytes for `test_organization_controller_char.py` from the pre-migration commit (origin/main at DELIVER kickoff), then asserts the post-migration assertion bytes are equal. Allowed diffs are restricted to four categories per DESIGN DWD-6: removed `@patch(...)` decorators, removed `mock_uc` parameter names, added local `mock_uc = MagicMock()` lines, added `_use_cases=lambda: mock_uc` kwarg arguments. Any line outside those four categories that is not a context line is a violation.

---

## DWD-5 — Architectural-enforcement scenarios use a synthetic-violator harness

**Decision.** Milestone-3 scenarios validate the `pytest-archon` rules (DESIGN DWD-8) by both (a) running the rule against a synthetic violator written to `tmp_path` (asserting the rule fails) and (b) running the rule against the legitimate post-refactor source tree (asserting the rule passes silently). Each rule (A: anti-regression alias block, B: positive structural assertion, C: γ-prevention `Depends`) gets both directions of test.

**Authority.** This DISTILL DWD-5; consistent with DESIGN DWD-8.

**Rationale.** A pytest-archon rule that has only ever seen passing inputs is not validated as a fence — it could be silently broken (always-pass). The synthetic-violator scenarios prove the rule fires when it should. The clean-tree scenarios prove the rule does not fire spuriously. Together they guarantee the rule is an active fence, not a no-op.

**Out of scope.** Validating the rule's behaviour against deep edge cases (e.g. pyi stubs, conditional imports). Captured as a follow-up note in `upstream-issues.md` if it surfaces during DELIVER.

---

## DWD-6 — Phase ordering follows DESIGN's Mikado sequence

**Decision.** `roadmap.json` declares four phases (00, 01, 02, 03). Phase ordering mirrors DESIGN DWD-2's Mikado sequence:

- **Phase 00 — Walking skeleton.** Migrate `OrganizationController` (the smallest controller) end-to-end: factory + kwarg + test rewrite for that one controller. Acceptance suite's `walking-skeleton.feature` unskips. Production tests for `test_organization_controller_char.py` rewrite to use `_use_cases=`.
- **Phase 01 — Milestone 1.** Roll out kwarg injection to the remaining 5 simple controllers (report, project, query_engine, sql_access, view) AND the two multi-factory controllers (dataset's 3 factories, conversation's 5 submodule factories). Delete the 18-line alias block from `http_controller.py` and the 8 `_uc()` getters. Acceptance suite's `milestone-1-kwarg-injection.feature` unskips.
- **Phase 02 — Milestone 2.** Bundled test rewrite: rewrite all 105 patches in `backend/tests/controllers/` to `_use_cases=lambda: mock_uc`. The byte-identical-assertions invariant must hold. Acceptance suite's `milestone-2-test-migration.feature` unskips.
- **Phase 03 — Milestone 3.** Add `pytest-archon` rules A/B/C in `backend/tests/architecture/test_controller_imports.py`. Acceptance suite's `milestone-3-architectural-enforcement.feature` unskips.

**Authority.** This DISTILL DWD-6; consistent with DESIGN DWD-2's step ordering. Note: Phase 01 absorbs DESIGN DWD-2 steps 1–3 (per-controller transformations) AND step 5 (alias-block deletion) because the alias block becomes deletable as soon as every controller has its kwarg + factory in place AND every test patches via `_use_cases=` (which Phase 02 enforces). The ordering 01 → 02 → 03 deliberately puts test rewrite AFTER controller rollout: production controllers stay green throughout because the alias block remains until Phase 02 finishes its rewrite.

**Wait — that contradicts the previous paragraph.** Resolved: Phase 01 deletes the alias block at the END of Phase 01, AFTER all controllers have their factories AND all tests have been migrated to `_use_cases=`. In practice, Phase 01 and Phase 02 interleave per DESIGN DWD-2's Mikado mechanism (each controller's kwarg-rollout commit is followed by its test-rewrite commit). The alias block deletion is the terminal commit of the combined Phase 01 + Phase 02 work. `roadmap.json` separates them logically (one tracks production-code shape, the other tracks test-code shape) but the DELIVER crafter executes them in interleaved Mikado order per DESIGN DWD-2 step 1 → step 2 → repeat.

**Forbidden ordering.** Deleting the alias block before all 105 tests migrate. Deleting any `_uc()` getter before its corresponding controller has the new factory. (Both are caught by `./tools/test/test.sh --backend` going red.)

---

## DWD-7 — KPI contracts intentionally absent (refactor; no observability surface)

**Decision.** No `@kpi` scenarios are emitted because no KPI contracts exist for this feature. The refactor introduces no new observable user behaviour — JSON:API responses are byte-identical, no new metrics emit, no new latency profile.

**Authority.** This DISTILL DWD-7. Soft gate per `nw-acceptance-designer` Phase 1 step 3: "If KPI contracts are missing, skip with a warning."

**Status of `docs/product/kpi-contracts.yaml`.** Not present in this repo (brownfield project, KPI SSOT not yet introduced). No warning emitted because the absence is structural, not a missed handoff.

---

## DWD-8 — Cross-feature isolation (inherited from DESIGN DWD-9)

**Decision.** This DISTILL bundle has zero file overlap with the three sibling DESIGN-wave features in flight (`refactor-metadata-repository-split`, `extract-dataset-query-port`, `refactor-upload-pipeline-modularity`). Acceptance-suite path is dedicated: `tests/acceptance/refactor-controller-use-case-injection/`. Feature-doc path is dedicated: `docs/feature/refactor-controller-use-case-injection/`.

**Authority.** Inherits from DESIGN DWD-9; this DISTILL DWD-8 records that the DISTILL artefacts respect that isolation.

**Concrete check before DELIVER kickoff.** `git diff --stat origin/main..HEAD` should show changes only under:

- `tests/acceptance/refactor-controller-use-case-injection/`
- `docs/feature/refactor-controller-use-case-injection/`
- (DELIVER additionally touches `backend/app/controllers/`, `backend/tests/controllers/`, `backend/tests/architecture/test_controller_imports.py` per DESIGN.)

Any change outside that set in the DISTILL deliverable is out-of-scope drift and must be reverted or split into a separate PR.

---

## DWD-9 — DoD-A binding (Definition of Done)

**Decision.** Handoff to DELIVER is gated on:

1. All four `.feature` files written with passing step scaffolds (every step body raises `pytest.fail("DISTILL scaffold — DELIVER implements: ...")`).
2. `__SCAFFOLD__ = True` sentinel present in `steps/controller_di_steps.py`.
3. `roadmap.json` declares phases 00, 01, 02, 03 with `scenarios_to_unskip`, `files_changed_estimate`, `exit_criteria`, `blocks`, `estimated_size`, `ac_references`, `polecat_command: "/nw-deliver"` for each.
4. `wave-decisions.md` (this file) records DWD-1 (kwarg-rename canonicalisation) plus the eight downstream DWDs.
5. `upstream-issues.md` records the back-propagation as a documented process event.
6. Mandate compliance evidence assembled (CM-A: driving-port-only imports in step bodies — verified by grep of `steps/controller_di_steps.py` for any internal helper import; CM-B: zero technical jargon in `.feature` files — verified by grep for HTTP/REST/JSON/database tokens; CM-C: walking skeleton + 21 focused scenarios across 4 features; CM-D: trivial — no impure code to extract because the only adapter is Python call mechanics).

**Authority.** This DISTILL DWD-9 + `nw-acceptance-designer` Definition of Done checklist.
