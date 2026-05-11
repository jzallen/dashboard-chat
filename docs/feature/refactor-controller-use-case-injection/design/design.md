<!-- DES-ENFORCEMENT : exempt -->
# DESIGN — Controller use-case injection refactor

**Feature slug:** `refactor-controller-use-case-injection`
**Wave:** DESIGN
**Status:** Proposed (reviewer-validated path α)
**Companion:** ADR-023, `c4-diagrams.md`, `wave-decisions.md`, `upstream-changes.md`

## §0 Confirmation checklist

- [x] Source signal traced: `docs/research/tech-debt-hotspot-review.md` Finding 2 (RPP L2 / L4).
- [x] Per-aggregate controllers enumerated: `report`, `project`, `query_engine`, `sql_access`, `organization`, `view`, `dataset`, `conversation` (eight under `backend/app/controllers/`).
- [x] Router call-pattern verified: direct staticmethod calls, never via `Depends`. See §7.
- [x] Test-patch count measured: 105 occurrences across 7 files (reviewer estimated 40–60). See §5.
- [x] Iron Rule binding: zero existing assertion changes; tests are **rewritten** (patch → kwarg) in bulk, not modified to fit a new implementation.
- [x] Behaviour preservation: 41 router call-sites untouched; JSON:API responses byte-identical.
- [x] No file overlap with `refactor-metadata-repository-split`, `extract-dataset-query-port`, `refactor-upload-pipeline-modularity`.

## §1 Problem statement

`http_controller.py` (32 commits over repo lifetime) carries an 18-line module-level alias block (lines 26–41) whose **sole purpose** is to host `unittest.mock.patch` targets:

```python
from app.use_cases import dataset as dataset_use_cases  # noqa: F401
from app.use_cases import organization as organization_use_cases  # noqa: F401
# ... eight aliases ...
```

Each per-aggregate controller bridges to the alias via a deferred-import getter (`def _uc(): from app.controllers import http_controller; return http_controller.report_use_cases`). The deferred import exists for a real reason — eager import would re-introduce the cycle `http_controller` → `<aggregate>_use_cases` → repositories → controllers (via decorator-time `RepositoryContainer` resolution).

The hotspot review classifies this as RPP L2 (symptom: indirection) over an L4 root cause (test-patchability debt). The file's own docstring (lines 5–24) names the problem: "Do NOT remove any of the module-level aliases until the tests that patch them are rewritten." That is debt with a self-aware comment.

105 test sites across `backend/tests/controllers/` patch these aliases (`@patch("app.controllers.http_controller.report_use_cases")`). The patch target couples tests to module-system layout, not to the controller's actual contract.

## §2 Architectural options

### α — Argument injection with default factory (kwarg-only). **Chosen.**

Each controller defines a private factory and accepts the use-case module as a keyword-only argument:

```python
# report_controller.py
def _default_uc():
    from app.use_cases import report
    return report

class ReportController:
    @staticmethod
    async def list_reports(project_id, project=None, *, _use_cases=_default_uc):
        result = await _use_cases().list_reports(project_id, project=project)
        ...
```

Tests pass `_use_cases=lambda: fake_uc`. Routers don't pass it; default wins.

### β — Module-level rebind (per-aggregate alias on each controller).

Move the alias from `http_controller.py` into each controller module; tests patch `report_controller.report_use_cases` instead. **Rejected:** keeps the patch pattern, doesn't address the L4 root cause, and re-introduces the import cycle the deferred getter was added to break.

### γ — Constructor injection with FastAPI `Depends(...)`.

Convert controllers to instance classes; wire via `Depends`. **Rejected:** routers call controllers directly (41 call-sites; see §7), so γ rewrites the entire router layer for a refactor whose scope is six controller files. Reviewer green-lit α specifically to keep blast radius bounded.

## §3 Reuse Analysis

| Asset | Current shape | Reuse / extend / replace | Note |
|---|---|---|---|
| `HTTPController` facade class | 60 lines, all `staticmethod` re-exports | **Reuse unchanged** | Routers call into it; touching it expands blast radius. |
| Per-aggregate controllers (8 files) | `_uc()` getter + `@staticmethod` methods | **Extend** | Replace `_uc()` with `_default_<agg>_uc` factory; add `*, _use_cases=...` kwarg. |
| `_serialize` / `_error_response` re-exports | Top of `http_controller.py` | **Reuse unchanged** | Tests still import them. Migrating those imports is a follow-up. |
| Module-level alias block (lines 26–41) | 18 lines | **Replace then delete** | Default factories supersede; alias block deleted at DWD-2 phase 2. |
| Router call-sites (41 lines across 11 files) | `await HTTPController.<m>(...)` | **Reuse unchanged** | Iron Rule on routers; zero diffs. |
| `@patch("app.controllers.http_controller.<alias>")` (105 sites) | Test infrastructure | **Replace** | Bulk rewrite to `_use_cases=fake_factory` argument. |
| `pytest-archon` framework | Already used by ADR-020 / ADR-022 | **Reuse** | Same harness, new rule file. |

## §4 Recommendation

**Adopt α (argument injection with default factory).** Rationale:

1. **Addresses the L4 root cause directly.** Tests stop coupling to module-system mechanics; they pass dependencies as arguments. Future controller renames / file moves don't break tests.
2. **Preserves the deferred-import constraint** — the body of `_default_<agg>_uc` does the lazy import, identical to the current `_uc()` getter behaviour.
3. **Bounded blast radius** — six controller files modified, 41 router call-sites untouched, zero use-case files touched. The reviewer accepted α specifically because γ would expand the refactor to the entire router layer.
4. **Mechanical test rewrite** — every `@patch(...)` becomes a `_use_cases=` kwarg. No assertion changes, no fixture restructuring.
5. **CI-enforceable** — a `pytest-archon` rule prevents future re-introduction of module-level aliases (Principle 11).

## §5 Migration / call-site impact + test-migration scope decision

### Surface impact

- **Controllers:** eight files modified (~10 lines per file: replace `_uc()` with `_default_<agg>_uc`, add `*, _use_cases=...` to each public method). Total ~80 net lines changed.
- **Routers:** zero. The 41 `HTTPController.<m>(...)` call-sites in `backend/app/routers/` are not touched.
- **`http_controller.py`:** alias block retained during phase 1 (so existing patches keep working); deleted at phase 2.
- **Tests:** 105 patch-call rewrites in 7 files (`test_http_controller.py` + six `test_*_controller_char.py`). Mechanical:

```python
# Before
@patch("app.controllers.http_controller.report_use_cases")
async def test_x(self, mock_uc):
    mock_uc.list_reports = AsyncMock(return_value=Success([]))
    body, status = await HTTPController.list_reports(...)

# After
async def test_x(self):
    mock_uc = MagicMock()
    mock_uc.list_reports = AsyncMock(return_value=Success([]))
    body, status = await HTTPController.list_reports(..., _use_cases=lambda: mock_uc)
```

### Test-migration scope decision (**bundled, single feature**)

The reviewer flagged this as a binary call. **Bundled** is chosen. Rationale:

- **Deferring leaves dead-on-arrival code.** If the alias block stays, the `_default_<agg>_uc` factories *and* the `_uc()` getters coexist temporarily — and the alias block becomes its own self-justifying reason to never delete. Brownfield experience: temporary debt becomes permanent.
- **The rewrite is mechanical and small.** 105 sites, one pattern. A senior author completes the bulk rewrite in well under a day. Splitting it across two PRs doubles review cost without reducing risk.
- **Iron Rule discipline survives bundling.** Tests are *rewritten* (a known transform from patch-based to argument-based fixture), not edited to make a new implementation pass. `nw-test-refactoring-catalog` L1 (rewrite test infrastructure without changing assertions) covers this case.
- **One-shot deletion of the alias block.** The terminal Mikado step is `git rm` of 18 lines + the eight `_uc()` getters. Atomic.

**Exit criterion (DWD-2):** the feature is COMPLETE only when (a) all 105 patches are rewritten, (b) the alias block on `http_controller.py` is deleted, (c) the eight `_uc()` getters are deleted, and (d) the `pytest-archon` rule passes.

The trade-off is a larger PR. Mitigation: Mikado-ordered seven-step sequence, each step independently green-and-revertable, alias block deletion sequenced last so reverts are cheap.

## §6 Quality attributes (ISO 25010)

| Attribute | Impact | Notes |
|---|---|---|
| Maintainability — testability | **+** | Patches eliminated. Test fixtures pass dependencies in. |
| Maintainability — modifiability | **+** | Renaming a controller no longer breaks 15+ unrelated tests. |
| Maintainability — analyzability | **+** | Each method's dependency surface is explicit in its signature. |
| Functional suitability | **=** | JSON:API responses unchanged. 41 router call-sites unchanged. |
| Reliability | **=** | No new failure modes. Default factory cannot raise differently than the prior getter. |
| Performance efficiency | **=** | One additional kwarg lookup per call (negligible). |
| Security | **=** | No auth surface change. |
| Portability | **=** | No deployment / runtime change. |

## §7 Risks + mitigations

### Risk 1 — FastAPI `Depends` interaction with the `_use_cases` kwarg (reviewer concern #2)

**Concern:** could FastAPI try to resolve `_use_cases` as a dependency, causing 422s or startup failures?

**Analysis:** **No interaction.** FastAPI inspects route handler signatures (the functions decorated with `@router.get`, `@router.post`, etc.) for `Depends(...)` parameters and request-body / query / path parameters. It does **not** introspect functions that are *called from* a route handler. In this codebase, every router calls its controller method **directly as a static method**:

- `backend/app/routers/reports.py:21` — `body, status_code = await HTTPController.list_reports(project["id"], project=project)`
- `backend/app/routers/reports.py:32` — `await HTTPController.post_report(project["id"], project=project, **data.model_dump())`
- `backend/app/routers/reports.py:43` — `await HTTPController.get_report(report_id, project=project)`
- `backend/app/routers/reports.py:56` — `await HTTPController.patch_report(report_id, project=project, **report_kwargs)`
- `backend/app/routers/reports.py:67` — `await HTTPController.delete_report(report_id, project=project)`

The same direct-call pattern holds across `routers/datasets.py` (lines 25, 36, 54, 66), `routers/projects.py` (27, 37, 50, 95, 111, 121), `routers/views.py` (21, 32, 43, 56, 67), `routers/sql_access.py` (20, 30, 42, 52, 62), `routers/organizations.py` (29, 39), `routers/query_engines.py` (19, 27, 35), `routers/sessions.py` (26, 36, 48, 66, 82, 105), `routers/transforms.py` (34, 61, 79), `routers/uploads.py` (47, 60, 92). 41 sites; zero use `Depends(HTTPController.<m>)`.

FastAPI therefore never sees `_use_cases`. The kwarg is part of the **callee's** signature, not the **route handler's** signature. No 422 risk; no startup failure; no `Depends` shadowing. This is *also* the load-bearing reason to reject γ — γ would force `Depends` adoption, which would force every router call-site to rewrite, which would expand the refactor scope by 6×.

**Mitigation:** documented here and in ADR-023 §γ rejection. The `pytest-archon` rule additionally enforces that controllers are not wired via `Depends` (negative grep on `Depends(.*Controller`) — captured in the architecture test.

### Risk 2 — `_use_cases` kwarg accidentally collides with a use-case parameter

**Concern:** could a future use case introduce a parameter named `_use_cases`?

**Mitigation:** keyword-only (the `*` separator) + single-underscore prefix is a strong convention against collision. The architectural rule forbids `_use_cases` as a parameter name on use-case functions (negative grep). Captured in DWD-3.

### Risk 3 — Test rewrite missed sites

**Concern:** 105 patches are easy to miscount.

**Mitigation:** the `pytest-archon` rule fails if any `@patch` call still references `app.controllers.http_controller.<x>_use_cases`. CI catches drift.

### Risk 4 — Future contributor removes `_use_cases` thinking it's unused private kwarg

**Mitigation:** docstring on each controller method documents `_use_cases` as injection-point-for-tests. Architectural rule asserts every public method on per-aggregate controllers has a `_use_cases` keyword-only parameter. Captured in DWD-3.

### Risk 5 — Iron Rule violation during bulk test rewrite

**Mitigation:** the rewrite is a known L1 test-refactoring transform (`nw-test-refactoring-catalog`): substitute fixture mechanism without altering assertions. A pre-flight `git diff --stat` audit confirms zero assertion edits before merge. Any deviation triggers the after-3-attempts revert rule.

---

**Effort estimate:** **M** — controllers (~half day) + test rewrite (~half to one day for 105 sites, mechanical) + architectural rule (~hour). Single working day for a senior author; two-day budget for review + CI cycles.

**Word count:** ~1170.
