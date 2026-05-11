<!-- DES-ENFORCEMENT : exempt -->
# Design-Wave Decisions (DWDs) — Controller use-case injection refactor

**Feature slug:** `refactor-controller-use-case-injection`
**Wave:** DESIGN
**Status:** Proposed
**Companion:** ADR-023, `design.md`, `c4-diagrams.md`, `upstream-changes.md`

DWDs are binding for downstream waves (DISTILL → DELIVER). Any deviation requires an amendment recorded against the DWD by number.

---

## DWD-1 — Option α (kwarg injection with default factory) is the binding decision

**Decision.** Adopt **Option α**: each per-aggregate controller gains a module-private `_default_<aggregate>_uc` factory and a keyword-only `_use_cases=_default_<aggregate>_uc` parameter on every public method. Tests pass `_use_cases=fake_factory`; routers do not pass the kwarg; the default factory wins in production.

**Authority.** ADR-023 (Proposed). Reviewer-validated path; user-stated intent ratified.

**Forbidden alternatives at DELIVER time.**
- **β (module-level rebind).** Re-introduces the import cycle `http_controller` → `*_use_cases` → repositories → controllers. Preserves the patch-based test pattern verbatim — does not address the L4 root cause.
- **γ (FastAPI `Depends` + constructor injection).** Would force rewrite of 41 router call-sites. Out of scope; reviewer green-lit α to keep blast radius bounded.

**Concrete test for compliance.** After DELIVER, every public method in `backend/app/controllers/<aggregate>_controller.py` matches the signature pattern `async def <method>(..., *, _use_cases=_default_<aggregate>_uc) -> tuple[dict, int]:`. The `pytest-archon` rule asserts this structurally.

**Out of scope.** Removing the `HTTPController` facade entirely; rewriting routers; collapsing `_serialize` / `_error_response` re-exports.

---

## DWD-2 — Test-migration scope is **bundled** into this feature

**Decision.** The 105 test sites under `backend/tests/controllers/` that use `@patch("app.controllers.http_controller.<x>_use_cases")` are **rewritten in this feature**, not deferred. The feature is COMPLETE only when:

1. All 105 patches are converted to `_use_cases=fake_factory` argument-based fixtures.
2. The 18-line module-level alias block on `http_controller.py` (lines 26–41 today) is **deleted**.
3. The eight `_uc()` deferred-import getters in `*_controller.py` files are **deleted** (replaced by `_default_<aggregate>_uc` factories).
4. The new `pytest-archon` architectural rule passes in CI.

**Authority.** ADR-023 §"Decision outcome" + design.md §5.

**Trade-off considered (deferred → rejected).** Splitting into two features (refactor controllers now, migrate tests later) was explicitly evaluated and rejected on three grounds:

- **Brownfield experience.** "Temporary" alias blocks become permanent. The current alias block already has its own self-justifying comment ("Do NOT remove until tests rewrite"); deferring would extend that comment another quarter.
- **Mechanical rewrite cost is small.** 105 sites, one transformation pattern (substitute `@patch(...)` decorator + `mock_uc` fixture for an `_use_cases=lambda: mock_uc` kwarg). One senior author completes the bulk in well under a day. Splitting into two PRs doubles review cost without reducing risk.
- **One-shot deletion property.** The terminal Mikado step is an atomic `git rm` of 18 lines from `http_controller.py` plus the eight `_uc()` getters. That deletion is the only proof the refactor "stuck"; deferring it leaves the refactor unfinished by definition.

**Iron Rule discipline preserved.** The test rewrite is an `nw-test-refactoring-catalog` L1 transformation: substitute fixture mechanism without altering assertions. A pre-merge `git diff --stat backend/tests/controllers/` audit confirms zero assertion edits. Any deviation triggers the after-3-attempts revert rule.

**Concrete exit criteria (CI-checkable).**

```bash
# All four MUST be true for the feature to merge.
grep -rn "@patch.*app\.controllers\.http_controller\..*_use_cases" backend/tests/  # → empty
grep -n "from app.use_cases import .* as .*_use_cases" backend/app/controllers/http_controller.py  # → empty
grep -n "def _uc()" backend/app/controllers/*_controller.py  # → empty
./tools/test/test.sh --backend  # → green
```

**Mikado step ordering (DELIVER reference, not authoritative here).**

1. Add `_default_<aggregate>_uc` factory + `*, _use_cases=...` kwarg to **one** controller (start with `report_controller.py` — smallest surface). All existing tests still green via the alias block, which has not yet been touched.
2. Rewrite the corresponding test file (`test_*_controller_char.py`) to pass `_use_cases=` instead of patching. Existing alias still works for any tests not yet migrated.
3. Repeat 1–2 for the remaining seven controller files.
4. Add the `pytest-archon` architectural rule to `backend/tests/architecture/test_controller_imports.py`.
5. Delete the alias block from `http_controller.py` and the eight `_uc()` getters in one atomic commit. Architectural rule confirms; backend tests green.

**Out of scope for DWD-2.** Migrating `_serialize` / `_error_response` test imports (different files, different mechanism — captured as a follow-up note in ADR-023).

---

## DWD-3 — FastAPI `Depends` non-interaction is documented and enforced

**Decision.** This refactor introduces a `_use_cases` keyword-only parameter on every public controller method. **FastAPI does not interact with `_use_cases`.** The reasoning is documented in three places:

1. ADR-023 §"Considered options" → γ rejection (with router file:line citations).
2. `design.md` §7 → Risk 1, with the full call-pattern audit and 41 router file:line citations.
3. The `pytest-archon` architectural rule (added in DWD-2 step 4) which **structurally asserts** the non-interaction.

**Why FastAPI doesn't see `_use_cases`.** FastAPI introspects route handler signatures (functions decorated with `@router.get`, `@router.post`, etc.) for `Depends(...)`, request-body, query, and path parameters. It does **not** introspect functions that are *called from* a route handler. In this codebase, every router calls its controller method **directly as a static method** — never via `Depends(HTTPController.<m>)`.

**Citations** (from `backend/app/routers/`):

- `reports.py:21` — `await HTTPController.list_reports(project["id"], project=project)`
- `reports.py:32` — `await HTTPController.post_report(project["id"], project=project, **data.model_dump())`
- `reports.py:43` — `await HTTPController.get_report(report_id, project=project)`
- `reports.py:56` — `await HTTPController.patch_report(report_id, project=project, **report_kwargs)`
- `reports.py:67` — `await HTTPController.delete_report(report_id, project=project)`

The same direct-call pattern applies at:

- `datasets.py:25, 36, 54, 66`
- `projects.py:27, 37, 50, 95, 111, 121`
- `views.py:21, 32, 43, 56, 67`
- `sql_access.py:20, 30, 42, 52, 62`
- `organizations.py:29, 39`
- `query_engines.py:19, 27, 35`
- `sessions.py:26, 36, 48, 66, 82, 105`
- `transforms.py:34, 61, 79`
- `uploads.py:47, 60, 92`

**41 sites total. Zero use `Depends(HTTPController.<m>)`.** The kwarg is part of the **callee's** signature, not the **route handler's** signature. FastAPI never sees it.

**Architectural rule** (Principle 11 enforcement, added under `backend/tests/architecture/test_controller_imports.py`):

```
RULE controller_not_used_via_Depends:
  ASSERT no source file under backend/app/routers/ contains the pattern
    'Depends(<X>Controller' for any controller class.
  ASSERT every public method in backend/app/controllers/*_controller.py
    that is referenced by HTTPController has a keyword-only `_use_cases` parameter
    with a callable default named `_default_*_uc`.
```

The first assertion is a negative grep over routers (catches "someone tried γ later"). The second assertion is an AST walk over per-aggregate controllers (catches "someone removed `_use_cases` thinking it was unused private kwarg").

**Concrete consequence.** Any future PR that wires a controller via `Depends(...)` is rejected at CI by the architectural rule, not in code review. Any future PR that drops `_use_cases` is rejected the same way.

---

## DWD-4 — `HTTPController` facade class is preserved (NOT replaced)

**Decision.** The `HTTPController` class on `http_controller.py` (lines 58–120 today, ~60 lines of `staticmethod` re-exports) is **kept**. Routers continue to import it from `app.controllers` and call its methods directly.

**Authority.** ADR-023 §"Mechanism".

**Rationale.** Removing the facade requires rewriting all 41 router call-sites (from `HTTPController.list_reports(...)` to `ReportController.list_reports(...)`). That is in scope for a separate, future refactor — not this one. The reviewer's green light for α is conditional on bounded blast radius; expanding into the router layer breaks that boundary.

**What this means at DELIVER.** The static-method re-exports in `class HTTPController` (`list_reports = staticmethod(ReportController.list_reports)`, etc.) are **untouched**.

---

## DWD-5 — `_serialize` / `_error_response` re-exports are kept (out of scope)

**Decision.** The two helper re-exports at the top of `http_controller.py` (`from ._result_mapper import error_response as _error_response` and `from ._result_mapper import serialize as _serialize`) are **preserved**.

**Authority.** ADR-023 §"Follow-up notes".

**Why.** They are imported under those names by `test_http_controller.py`, `test_result_mapper_char.py`, and `tests/integration/test_upload_pipeline.py`. Migrating those imports to `app.controllers._result_mapper` is mechanical but touches a different file population; bundling it with the use-case-injection rewrite expands scope and review burden. Captured as a follow-up.

---

## DWD-6 — Iron Rule binding for all controller characterization tests

**Decision.** No assertion in `backend/tests/controllers/test_*_char.py` or `test_http_controller.py` is modified to make the refactor pass. The only allowed test edits are:

- Removing `@patch("app.controllers.http_controller.<x>_use_cases")` decorators.
- Removing the corresponding `mock_uc` parameter from method signatures.
- Replacing in-test mock construction so that the mock is passed via `_use_cases=lambda: mock_uc` keyword argument to the controller call.
- Adding a local `mock_uc = MagicMock()` line where the patch decorator was previously injecting it.

**Authority.** Iron Rule (CLAUDE.md). `nw-test-refactoring-catalog` L1.

**Pre-merge audit.** Run

```bash
git diff --stat backend/tests/controllers/
```

and visually inspect: line-additions should heavily outweigh line-deletions only because each test gains the `mock_uc = MagicMock()` line; assertion lines (`assert status == ...`, `assert body[...] == ...`, `mock_uc.<method>.assert_awaited_once_with(...)`) must be **byte-identical** before and after.

**After 3 failed attempts** to keep a single test green during rewrite: revert the change for that test, escalate, do not modify the assertion.

---

## DWD-7 — Earned-Trust contract: no probe required

**Decision.** Per-aggregate controllers do not ship with `probe()` methods. They are not driven adapters; they are HTTP-layer adapters delegating to in-process Python use-case modules.

**Authority.** ADR-023 §"Earned-Trust contract". Principle 12.

**Rationale.** The substrate boundary in this stack is the database session (`AsyncSession`), which is covered by the use-case decorator stack (`@with_repositories`) and by the existing FastAPI lifespan invariants for `init_db`. The `_default_<aggregate>_uc` factory has one job: import a Python module. There is no substrate that can lie. Adding a probe would be ceremony without effect.

**What if someone changes that?** If a future controller change adds a substrate dependency (e.g., direct HTTP client to an external service, direct filesystem access), this DWD must be amended and the affected controller must gain a `probe()` per Principle 12. The architectural rule does not catch this directly — it is human review responsibility, captured here for the next reader.

---

## DWD-8 — Architectural enforcement: `pytest-archon` single-layer rule

**Decision.** A new file `backend/tests/architecture/test_controller_imports.py` declares two rules:

**Rule A (anti-regression).** `app.controllers.http_controller` MUST NOT import from `app.use_cases` at module level. (Detects re-introduction of the alias block.)

**Rule B (positive structural assertion).** Each per-aggregate controller module under `backend/app/controllers/` MUST define a `_default_<aggregate>_uc` callable AND every public method on its controller class MUST have a keyword-only `_use_cases` parameter with that callable as default. (Detects accidental removal of the injection point.)

**Rule C (γ-prevention).** No file under `backend/app/routers/` MUST contain the pattern `Depends(<X>Controller` for any controller class. (Prevents accidental future adoption of γ-style wiring.)

**Authority.** ADR-023 §"Architectural enforcement". Principle 11.

**Single-layer is sufficient.** The constraints are all import-graph or AST-structural. There is no Protocol (so no subtype layer), no behavioural-layer requirement (no substrate that lies), and no substrate dependency. This mirrors ADR-020's and ADR-022's pattern; differs from ADR-019 (multi-layer) because the failure modes here are not behavioural.

**Run command.** `./tools/test/test.sh --backend` includes the `tests/architecture/` directory; no separate selector needed.

---

## DWD-9 — Cross-feature isolation

**Decision.** This refactor has **zero file overlap** with the three sibling DESIGN-wave features in flight:

- `refactor-metadata-repository-split` — modifies `backend/app/repositories/metadata/`. No controller touches it directly.
- `extract-dataset-query-port` — modifies `backend/app/models/dataset.py` + adds `backend/app/query_engine/`. No controller touches model methods directly (controllers go through use cases).
- `refactor-upload-pipeline-modularity` — modifies `backend/app/use_cases/dataset/create_dataset_from_upload.py` + adds `_pipeline/plugin_dispatch.py`. The controller for that use case (`DatasetController.post_upload`, `DatasetController.post_dataset`) calls the use case as a black box; the kwarg-injection refactor doesn't change which use case is called or how.

**Merge order.** Unconstrained. This refactor can land before, after, or in parallel with any of the other three.

**Authority.** ADR-023 §"Cross-decision composition" (independence demonstrated at use-case / repository / model layers; this refactor is at the controller layer).

**Concrete check before merge.** `git diff --stat origin/main..HEAD` should show changes only under:

- `backend/app/controllers/`
- `backend/tests/controllers/`
- `backend/tests/architecture/test_controller_imports.py` (new)
- `docs/feature/refactor-controller-use-case-injection/`
- `docs/decisions/adr-023-controller-use-case-injection.md`

Any change outside that set is out-of-scope drift and must be reverted or split into a separate PR.
