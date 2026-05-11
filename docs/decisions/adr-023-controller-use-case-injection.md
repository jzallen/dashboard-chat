<!-- DES-ENFORCEMENT : exempt -->
# ADR-023: Replace controller use-case getters with kwarg injection (default factory)

**Status:** Proposed
**Date:** 2026-05-10
**Originating wave:** DESIGN (entered directly per CLAUDE.md brownfield routing; refactor with cause known)
**Bead:** TBD (assigned at DELIVER kickoff)
**Companion artifacts:**
- DESIGN proposal: `docs/feature/refactor-controller-use-case-injection/design/design.md`
- C4 diagrams: `docs/feature/refactor-controller-use-case-injection/design/c4-diagrams.md`
- Wave decisions: `docs/feature/refactor-controller-use-case-injection/design/wave-decisions.md`
- Upstream-changes record: `docs/feature/refactor-controller-use-case-injection/design/upstream-changes.md`
- Source signal: `docs/research/tech-debt-hotspot-review.md` Finding 2 (RPP L2 symptom / L4 root cause); user-initiated; reviewer-validated path forward.

## Context and problem statement

Per `docs/research/tech-debt-hotspot-review.md` Finding 2, `backend/app/controllers/http_controller.py` (32 commits over repo lifetime) carries an 18-line block of module-level use-case aliases (`dataset_use_cases`, `report_use_cases`, `organization_use_cases`, etc.) plus `_serialize` / `_error_response` re-exports. Each per-aggregate controller re-fetches its use-case module through a deferred-import getter:

```python
# report_controller.py — current
def _uc():
    from app.controllers import http_controller
    return http_controller.report_use_cases  # tests patch this alias

class ReportController:
    @staticmethod
    async def list_reports(project_id, project=None):
        result = await _uc().list_reports(...)
```

Tests across `backend/tests/controllers/*_char.py` and `backend/tests/controllers/test_http_controller.py` rely on `unittest.mock.patch("app.controllers.http_controller.<alias>")` to swap the use case at call time (105 occurrences across 7 files; reviewer's estimate of 40–60 was low — the alias is patched roughly twice per behavioural assertion).

Two problems compound:

1. **Test-patchability debt (RPP L4).** The alias block exists *only* to host monkeypatch targets. The file header (lines 5–24) explicitly notes removal is blocked until the patches migrate. Because the module is the patch target, any extraction that breaks the alias name silently breaks every test that names it.
2. **Indirection without value (RPP L2).** The deferred getter (`_uc()` → re-import → attribute lookup) has one motivation: bridge tests that haven't moved. The runtime cost is negligible, but the indirection obscures the actual dependency: each controller depends on its use-case module, full stop.

Independent of this, the controllers themselves are thin (a `match`/`case` over `Result[...]`, then envelope wrapping) and entirely composed of `@staticmethod`s. The routers call them directly: `HTTPController.list_reports(project["id"], project=project)` — never via FastAPI's `Depends(...)` mechanism. This shape constrains the solution space.

## Decision drivers

- **Maintainability — testability (ISO 25010 §7).** Test fixtures should pass dependencies into the controller, not patch a module symbol. Patching is brittle to file moves and naming churn; explicit injection is invariant.
- **Maintainability — modifiability.** The alias block is a long-lived "DO NOT TOUCH" hazard (per its own docstring). Removing the structural reason for it removes the hazard.
- **Behaviour preservation.** All routers continue to call `HTTPController.list_reports(...)` (and 38 sibling call-sites across `backend/app/routers/`) without modification. JSON:API responses unchanged.
- **Deferred import preservation.** The `app.use_cases.<aggregate>` modules are imported lazily today (the getter does `from app.use_cases import report` inside `_uc()`). The replacement must preserve lazy import — eager import at module load would re-introduce the cycle the deferred getter was added to break.
- **Architectural enforcement (Principle 11).** A `pytest-archon` rule prevents future controllers from re-introducing module-level use-case aliases on `http_controller`.
- **Earned Trust (Principle 12).** No new substrate dependency. Controllers remain pure adapters between FastAPI's HTTP layer and use-case modules; no probe required (DWD-7).
- **Iron Rule.** No existing characterization test is modified to make the refactor pass. Tests migrate as a bulk **rewrite** (not assertion-edit) at a defined exit criterion (DWD-2).
- **CLAUDE.md constraints.** `@handle_returns` + `@with_repositories` + `RepositoryContainer` decorator stack on use cases is untouched. Use cases stay pure.

## Considered options

### α — Argument injection with default factory (kwarg-only). **Chosen.**

Each per-aggregate controller defines a private default factory and accepts the use-case module as a keyword-only argument with that factory as default:

```python
# report_controller.py — proposed
def _default_uc():
    from app.use_cases import report
    return report

class ReportController:
    @staticmethod
    async def list_reports(project_id, project=None, *, _use_cases=_default_uc):
        result = await _use_cases().list_reports(project_id, project=project)
        ...
```

Tests pass `_use_cases=fake_factory` directly — no patching. Routers do not pass the kwarg; the default factory wins in production. Lazy import is preserved (the body of `_default_uc` does the import). The alias block on `http_controller.py` becomes deletable once tests migrate.

**Pros:** explicit dependency surface; one kwarg per controller method; trivially unit-testable; deferred import preserved verbatim; no FastAPI interaction (kwargs starting with `_` are conventionally private and not part of the FastAPI signature contract — see §7); the alias block becomes deletable; pattern is already idiomatic Python for swap-in-tests-without-DI-framework.

**Cons:** every public method on six controllers gets a `_use_cases` kwarg — small surface bloat; 105 test sites must rewrite from `@patch("app.controllers.http_controller.report_use_cases")` to passing `_use_cases=lambda: fake_uc` (mitigated: the rewrite is mechanical, see §5); naming `_use_cases` (single underscore prefix) is a convention, not a hard guarantee — a future contributor could mistake it for "private" and remove it (mitigated: architectural enforcement rule, §below).

### β — Module-level rebind (Option A: per-aggregate alias on each controller). **Rejected.**

Move the alias into each controller module:

```python
# report_controller.py — alternative β
from app.use_cases import report as report_use_cases  # tests patch THIS

class ReportController:
    @staticmethod
    async def list_reports(...):
        result = await report_use_cases.list_reports(...)
```

**Pros:** smallest mechanical change; tests rewrite the patch target string only (`http_controller.report_use_cases` → `report_controller.report_use_cases`); deletes the alias block on `http_controller.py`.

**Rejected because:** preserves the patch-based test pattern verbatim. The L4 root cause (tests patch a module symbol rather than receive a dependency) survives untouched. The next time a controller is renamed or split, every test breaks. Also, eager module-level import re-introduces the import cycle the deferred getter was specifically added to break (`http_controller` → `report_use_cases` → ... → controllers indirectly via `RepositoryContainer` resolution at decorator time). β trades the alias-block hazard for an import-cycle hazard.

### γ — Constructor injection with FastAPI `Depends(...)`. **Rejected.**

Convert each controller from a class of `@staticmethod`s to an instance class with `__init__(self, use_cases: Module)`. Wire via FastAPI:

```python
# router — alternative γ
def get_report_controller() -> ReportController:
    return ReportController(use_cases=report_use_cases)

@router.get("")
async def list_reports(controller: ReportController = Depends(get_report_controller), ...):
    body, status_code = await controller.list_reports(...)
```

**Rejected because:** routers in this codebase call controllers **directly**, not via `Depends`. Forty-one router call-sites would need rewriting (see `backend/app/routers/reports.py:21,32,43,56,67`; `backend/app/routers/datasets.py:25,36,54,66`; `backend/app/routers/projects.py:27,37,50,95,111,121`; `backend/app/routers/views.py:21,32,43,56,67`; `backend/app/routers/sql_access.py:20,30,42,52,62`; `backend/app/routers/organizations.py:29,39`; `backend/app/routers/query_engines.py:19,27,35`; `backend/app/routers/sessions.py:26,36,48,66,82,105`; `backend/app/routers/transforms.py:34,61,79`; `backend/app/routers/uploads.py:47,60,92`; `backend/app/routers/datasets.py:25,36,54,66`). Each rewrite changes from a static call to a `Depends`-resolved instance method. The blast radius is the *entire* router layer; the refactor would expand from 6 controller files to ~12 router files and would require revalidating end-to-end behaviour for every endpoint. The reviewer green-lit α specifically to keep the blast radius bounded. γ also forces every new endpoint to author and wire a `Depends` factory, increasing the marginal cost of adding endpoints.

## Decision outcome

**Option α — argument injection with default factory.**

### Mechanism

Six per-aggregate controller files (`report_controller.py`, `project_controller.py`, `query_engine_controller.py`, `sql_access_controller.py`, `organization_controller.py`, `view_controller.py`, plus `dataset_controller.py` and `conversation_controller.py` for completeness — eight total under `backend/app/controllers/`) each gain:

1. A module-private `_default_<aggregate>_uc()` factory whose body performs the existing deferred `from app.use_cases import <aggregate>` import.
2. A keyword-only `_use_cases=_default_<aggregate>_uc` parameter on every public method.

`http_controller.py` retains:
- The `HTTPController` class with its `staticmethod` re-exports (used by every router).
- The `_serialize` / `_error_response` re-exports (test imports — covered by the test-migration scope decision in DWD-2).

`http_controller.py` deletes (after test migration completes — DWD-2):
- The 18-line module-level alias block (lines 26–41).
- All `_uc()` getters in the per-aggregate controller files (replaced by `_default_<aggregate>_uc` factories).

### Architectural enforcement (Principle 11)

A new `pytest-archon` test under `backend/tests/architecture/` declares two import-graph rules:

> **Rule 1.** `app.controllers.http_controller` MUST NOT import from `app.use_cases` (transitive imports through controller modules are allowed and unavoidable).
>
> **Rule 2.** Each per-aggregate controller module (`app.controllers.<aggregate>_controller`) MAY import `app.use_cases.<aggregate>` lazily inside a `_default_*_uc` factory ONLY. The rule scans for a top-level `from app.use_cases import` statement in each controller module and fails if one is found.

Single-layer enforcement is sufficient — the constraint is purely import-graph (mirrors ADR-020 / ADR-022 pattern). Controllers do not implement a Protocol, so the multi-layer pattern (ADR-019) does not apply. No substrate dependency, so no behavioural-layer requirement.

### Earned-Trust contract (Principle 12)

No probe required. Controllers are HTTP-layer adapters delegating to in-process use-case modules. The use-case modules' decorator stack (`@handle_returns` + `@with_repositories`) already covers the only substrate boundary (the database session). The `_default_*_uc` factory has one job: import a Python module. There is no substrate that can lie. Captured in DWD-7.

### Behaviour preservation guarantees

- All 41 router call-sites compile and run unchanged. `HTTPController.list_reports(...)` etc. resolve to the same per-aggregate controller methods.
- All 105 test patches stay green during the migration window (DWD-2 phase 1) because the alias block stays. Phase 2 of DWD-2 deletes both the patches and the alias block in one bulk PR.
- `_serialize` / `_error_response` re-exports remain on `http_controller.py` until `test_result_mapper_char.py` and `tests/integration/test_upload_pipeline.py` migrate to import directly from `app.controllers._result_mapper` (captured as a follow-up note; out of scope for ADR-023).
- JSON:API response shapes are byte-identical (controller body unchanged except for the kwarg injection).

## Consequences

### Positive

- The structural reason for the alias block disappears. After test migration, the 18-line "DO NOT TOUCH" hazard is deleted.
- Controllers gain explicit dependency surface; new readers see what each method depends on without chasing a module-level alias.
- Tests stop coupling to module-system mechanics (`unittest.mock.patch` on a module attribute); they pass dependencies as arguments. Future controller renames / file moves do not break tests.
- `pytest-archon` rule prevents regression at CI time.

### Negative / accepted trade-offs

- Every public controller method gains a `_use_cases` kwarg. Surface bloat is small (one kwarg per method, keyword-only, defaulted) but visible.
- 105 test sites rewrite. Mechanical, but bulk. Captured in DWD-2; estimate **M** effort (1 working day for a senior author).
- The `_use_cases` naming convention (single-underscore-prefix "private") is convention, not language-enforced. A future contributor could remove it. Mitigated: the `pytest-archon` rule + a review checklist in `docs/feature/refactor-controller-use-case-injection/design/upstream-changes.md`.

### Operational

- No new runtime dependency. No new external integration. No DEVOPS contract-test annotation.
- No deployment-topology change. ADR-016 5-service compose stack untouched.
- No database migration; no ORM changes.
- No new FastAPI lifespan invariant; no probe.

## Cross-decision composition (intentional)

- **ADR-023 ↔ ADR-019.** Independent. Phase 2 dbt-test-validation surface fully fenced; controllers do not call eject/dbt code.
- **ADR-023 ↔ ADR-020.** Independent. ADR-020 splits `MetadataRepository`; ADR-023 refactors controllers. Controllers consume use cases (which consume repositories) — the boundary is two layers below this refactor.
- **ADR-023 ↔ ADR-021.** Independent. ADR-021 extracts `QueryEnginePort` from `Dataset`. Controllers do not import `Dataset` directly; merge order unconstrained.
- **ADR-023 ↔ ADR-022.** Independent. ADR-022 refactors `create_dataset_from_upload` use case; controllers consume that use case as a black box; the new `UploadPluginDispatcher` is internal to the use case. Merge order unconstrained.

## Follow-up notes (NOT this feature)

1. **Migrate `_serialize` / `_error_response` test imports.** `test_result_mapper_char.py` and `tests/integration/test_upload_pipeline.py` import these from `app.controllers.http_controller`; should import directly from `app.controllers._result_mapper`. Trivial; bundled into a future cleanup.
2. **Consider replacing `HTTPController` facade entirely.** After test migration, `HTTPController` is a 60-line class of `staticmethod` re-exports. Routers could import per-aggregate controller classes directly. Removing the facade is structural and deserves its own ADR.

## Confirmation

After DELIVER:

- All 105 test sites under `backend/tests/controllers/` rewritten to pass `_use_cases=fake_factory` instead of `@patch(...)`. **No assertion changes.**
- `grep -n "from app.use_cases import .* as .*_use_cases" backend/app/controllers/http_controller.py` returns nothing.
- `grep -rn "@patch.*app\.controllers\.http_controller\..*_use_cases" backend/tests/` returns nothing.
- `grep -n "_default_.*_uc" backend/app/controllers/*_controller.py` returns one factory per controller module.
- `pytest-archon` rule in `backend/tests/architecture/test_controller_imports.py` passes.
- `mypy backend/app` passes.
- All 41 router call-sites unchanged (verified by `git diff backend/app/routers/`).
- Backend test suite (`./tools/test/test.sh --backend`) green.

## Related

- ADR-005 — Frozen dataclasses over Pydantic. Preserved.
- ADR-006 — Result monad over exceptions. Preserved (`Result[...]` unwrap pattern in controllers unchanged).
- ADR-013 — nwave-ai SDLC adoption. This refactor follows brownfield DESIGN-entry routing.
- ADR-019 — Eject-then-test validation. Surface-fenced; no overlap.
- ADR-020 — Metadata-repository split (Proposed, parallel). Independent layer.
- ADR-021 — Extract dataset query port (Proposed, parallel). Independent layer.
- ADR-022 — Upload-pipeline modularity (Proposed, parallel). Independent layer.
- `docs/research/tech-debt-hotspot-review.md` Finding 2 — Source signal.
- `backend/app/controllers/http_controller.py` — alias block being eliminated.
- `backend/app/controllers/{report,project,query_engine,sql_access,organization,view,dataset,conversation}_controller.py` — files modified.
- `backend/app/routers/reports.py:21,32,43,56,67` (and 36 other router lines listed in §γ rejection above) — direct-call pattern that justifies γ rejection.
