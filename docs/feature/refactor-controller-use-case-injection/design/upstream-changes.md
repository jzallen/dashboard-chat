<!-- DES-ENFORCEMENT : exempt -->
# Upstream Changes — Controller use-case injection refactor

**Feature slug:** `refactor-controller-use-case-injection`
**Wave:** DESIGN
**Status:** Proposed
**Companion:** ADR-023, `design.md`, `c4-diagrams.md`, `wave-decisions.md`

This document records the upstream impact of the refactor — which files change, which files must NOT change, what reviewers should look for, and the public-contract surface visible to other waves and to other features in flight.

## §1 Files modified (in scope)

| File | Change type | Lines changed (estimate) | Notes |
|---|---|---|---|
| `backend/app/controllers/http_controller.py` | DELETE alias block (L26–41); preserve `HTTPController` class + `_serialize` / `_error_response` re-exports | −18, +0 | DWD-2 phase 2 (atomic with `_uc()` getter deletions). |
| `backend/app/controllers/report_controller.py` | Replace `_uc()` with `_default_uc`; add `*, _use_cases=_default_uc` to 5 methods | −5, +12 | Smallest controller; lead with this in Mikado order. |
| `backend/app/controllers/project_controller.py` | Same transformation; 5 methods | −5, +12 | |
| `backend/app/controllers/query_engine_controller.py` | Same transformation; 3 methods | −5, +9 | |
| `backend/app/controllers/sql_access_controller.py` | Same transformation; 5 methods | −5, +12 | |
| `backend/app/controllers/organization_controller.py` | Same transformation; 2 methods | −5, +7 | |
| `backend/app/controllers/view_controller.py` | Same transformation; 5 methods | −5, +12 | |
| `backend/app/controllers/dataset_controller.py` | Same transformation; **3 factories** (`_default_dataset_uc`, `_default_upload_uc`, `_default_search_uc`) for 10 methods | −12, +25 | Largest controller; multi-alias case (see §3). |
| `backend/app/controllers/conversation_controller.py` | Same transformation; 5 methods | −5, +12 | Includes `get_project_memory` (uses `get_project_memory_uc` submodule alias — see §3). |
| `backend/tests/controllers/test_http_controller.py` | Rewrite 25 patches to `_use_cases=` kwarg | varies | Iron Rule: zero assertion changes. |
| `backend/tests/controllers/test_dataset_controller_char.py` | Rewrite 16 patches | varies | Multi-alias case. |
| `backend/tests/controllers/test_organization_controller_char.py` | Rewrite 7 patches | varies | |
| `backend/tests/controllers/test_project_controller_char.py` | Rewrite 9 patches | varies | |
| `backend/tests/controllers/test_analytics_controller_char.py` | Rewrite 25 patches | varies | Covers both view + report controllers (Seam 5a/5b). |
| `backend/tests/controllers/test_sql_access_controller_char.py` | Rewrite 14 patches | varies | |
| `backend/tests/controllers/test_query_engine_controller_char.py` | Rewrite 9 patches | varies | |
| `backend/tests/controllers/test_conversation_controller_char.py` | Rewrite N patches | varies | Submodule-alias case (`create_session_uc`, `list_sessions_uc`, etc.). |
| `backend/tests/architecture/test_controller_imports.py` | **NEW FILE** — `pytest-archon` rule (DWD-8) | +60 (new) | Three rules (A, B, C in DWD-8). |

**Total estimate.** ~150 net LOC change in controllers; ~105 patch-call rewrites in tests; one new ~60-line architectural-rule file. **No use-case files touched. No router files touched. No model files touched. No repository files touched.**

## §2 Files explicitly NOT modified (out of scope)

The following are **load-bearing on the assumption they don't change**. Any reviewer seeing diffs in these files during DELIVER should reject the change.

| File / directory | Why NOT touched |
|---|---|
| `backend/app/routers/*.py` (11 files) | DWD-4: the `HTTPController` facade is preserved precisely to keep router call-sites zero-diff. 41 call-sites unchanged. |
| `backend/app/use_cases/**/*.py` | Use cases are downstream of controllers. The kwarg-injection refactor doesn't touch them. |
| `backend/app/repositories/**/*.py` | Two layers below the controller boundary. Out of scope. |
| `backend/app/models/*.py` | Domain models. Out of scope. |
| `backend/app/main.py` | FastAPI lifespan. No new probe; no startup-invariant change. |
| `backend/tests/use_cases/**/*.py` | Use-case tests don't depend on controller patches. |
| `backend/tests/integration/*.py` | Integration tests use real use-case modules and don't patch controllers. |
| `backend/tests/repositories/*.py` | Below the controller boundary. |
| `frontend/**/*` | No frontend impact. Response envelopes are byte-identical. |
| `worker/**/*` | No worker impact. |
| `shared/chat/**/*` | No chat-event-schema impact. |
| Migrations (`backend/migrations/versions/*`) | No DB change. |

## §3 Multi-alias and submodule-alias cases

Two controllers have non-trivial alias structure that requires care during the rewrite:

### `dataset_controller.py` — three factories

The current file has three `_uc()` getters: `_dataset_uc()`, `_upload_uc()`, `_search_uc()`. The proposed shape has three corresponding factories:

```python
def _default_dataset_uc():
    from app.use_cases import dataset
    return dataset

def _default_upload_uc():
    from app.use_cases import upload
    return upload

def _default_search_uc():
    from app.use_cases.dataset import search_datasets
    return search_datasets
```

Methods take the kwarg matching their use-case domain. Tests pass the appropriate kwarg(s):

```python
# Multi-dependency test
await DatasetController.post_upload(
    file_content=..., file_name=..., project_id=...,
    _use_cases=lambda: fake_upload_uc,
)
```

A method that depends on **two** use cases (none currently does, but `post_dataset` could plausibly grow there) would take two kwargs of the `_use_cases`-shape, suffixed by the dependency role (e.g. `_dataset_use_cases=...`, `_upload_use_cases=...`). The convention is one kwarg per distinct use-case dependency, named after the dependency, all preserving the `_use_cases`-style suffix.

### `conversation_controller.py` — submodule aliases

The current `http_controller.py` re-exports several **submodules**, not packages: `create_session_uc`, `list_sessions_uc`, `list_session_events_uc`, `update_session_uc`, `get_project_memory_uc`. These are individual function-bearing modules, not whole packages.

Each submodule alias becomes its own factory:

```python
def _default_create_session_uc():
    from app.use_cases.session import create_session
    return create_session
```

The conversation controller therefore has 5 factories (one per submodule), each method takes the relevant kwarg. Tests pass the matching kwarg.

## §4 Public contracts preserved

The following surfaces are byte-identical before and after this refactor:

1. **Router call-sites.** All 41 invocations of `await HTTPController.<method>(...)` in `backend/app/routers/` resolve identically.
2. **JSON:API response envelopes.** Every controller method returns `tuple[dict, int]` with identical body and status code.
3. **`HTTPController` class.** Every staticmethod re-export is preserved. External code importing `from app.controllers import HTTPController` is unaffected.
4. **Use-case external API.** No use-case module signature changes. Decorators `@handle_returns` + `@with_repositories` untouched.
5. **`_serialize` / `_error_response` re-exports.** Tests that import these from `app.controllers.http_controller` continue to work (DWD-5 — out of scope to migrate now).
6. **`from app.controllers.http_controller import HTTPController`.** Continues to work; class membership unchanged.

## §5 Public contracts changing

1. **Per-aggregate controller method signatures gain `_use_cases=...` kwarg.** Callers that don't pass it (every router; every production caller) are unaffected. Tests passing `_use_cases=fake_factory` is the new injection mechanism.
2. **Module-level alias `app.controllers.http_controller.<x>_use_cases` is REMOVED.** This is a breaking change for any external consumer that imports those aliases by name. Audit (`grep -rn "http_controller.*_use_cases" --include="*.py"`) confirms only `backend/tests/controllers/` and `backend/app/controllers/` reference these aliases. **No production code outside the rewrite scope depends on the alias names.**
3. **`_uc()` getters in per-aggregate controllers are REMOVED.** Same audit: not referenced outside the controller files themselves.

## §6 Reviewer checklist (DELIVER kickoff)

Before approving the DELIVER PR(s), confirm:

- [ ] `git diff --stat origin/main..HEAD` shows changes ONLY in the file population listed in §1.
- [ ] `git diff backend/app/routers/` is empty.
- [ ] `git diff backend/app/use_cases/` is empty.
- [ ] `git diff backend/app/repositories/` is empty.
- [ ] `git diff backend/app/models/` is empty.
- [ ] No `assert` line in `backend/tests/controllers/*.py` is modified (assertion bytes identical before/after; only mock-construction lines change).
- [ ] `grep -rn "@patch.*app\.controllers\.http_controller\..*_use_cases" backend/tests/` returns nothing.
- [ ] `grep -n "from app.use_cases import .* as .*_use_cases" backend/app/controllers/http_controller.py` returns nothing.
- [ ] `grep -n "def _uc()" backend/app/controllers/*_controller.py` returns nothing.
- [ ] `grep -n "_default_.*_uc" backend/app/controllers/*_controller.py` returns one factory per controller-aggregate (≥10 total: 1×report, 1×project, 1×query_engine, 1×sql_access, 1×organization, 1×view, 3×dataset, 5×conversation).
- [ ] `backend/tests/architecture/test_controller_imports.py` exists; `pytest-archon` rules A, B, C all green.
- [ ] `./tools/test/test.sh --backend` green (gastown queue gate).
- [ ] `mypy backend/app` green.
- [ ] No frontend, worker, or shared/chat changes.

## §7 Cross-feature concurrency

Three sibling DESIGN-wave features are in flight:

| Sibling | Their files | Overlap with this refactor |
|---|---|---|
| `refactor-metadata-repository-split` (ADR-020) | `backend/app/repositories/metadata/` | **None.** Repository layer is two layers below controller layer. |
| `extract-dataset-query-port` (ADR-021) | `backend/app/models/dataset.py`, `backend/app/query_engine/` | **None.** Model layer; controllers don't import models directly. |
| `refactor-upload-pipeline-modularity` (ADR-022) | `backend/app/use_cases/dataset/create_dataset_from_upload.py`, `backend/app/use_cases/dataset/_pipeline/plugin_dispatch.py` | **None.** Use-case layer. The `DatasetController.post_dataset` method calls `create_dataset_from_upload` as a black box; whether that use case has been internally refactored is invisible to the controller. |

Merge order: **unconstrained**. This feature can land before, after, or interleaved with any sibling. Verified by file-population disjointness.

## §8 Downstream wave handoff

### To DISTILL

DISTILL needs:

- This DESIGN bundle (5 files in `docs/feature/refactor-controller-use-case-injection/design/` + ADR-023).
- **No new acceptance scenarios.** This is a pure refactor; no new HTTP behaviour to spec. The existing 105 controller characterization tests **are** the acceptance contract; they must stay green byte-for-byte (assertions) while their fixture mechanism rewrites.
- **`roadmap.json` shape suggestion.** Mikado-ordered 5 steps (one per phase in DWD-2 mechanism), each independently committable and revertable. Steps 1–3 are per-controller transformations; step 4 is the architectural rule; step 5 is the atomic deletion of the alias block + `_uc()` getters.

### To DELIVER

DELIVER needs:

- ADR-023 + this `upstream-changes.md` as the canonical "what is in / out of scope" reference.
- The 9 DWDs as binding constraints.
- The reviewer checklist (§6) to gate the merge PR.

### To DEVOPS / Platform Architect

**No platform-architect handoff required.** This refactor introduces no new external integrations, no new substrate dependencies, no new lifespan invariants, no new probes, no new infrastructure. The existing CI pipeline (`./tools/test/test.sh --backend`) suffices to validate the change. No contract-test annotations needed.

## §9 Earned-Trust note

This refactor introduces **no new substrate dependency**. The architectural-enforcement rules (DWD-8) carry the long-tail risk: if a future change adds a substrate dependency to a controller (e.g., direct HTTP client, direct filesystem access), DWD-7 would require amendment and a `probe()` would become mandatory. Captured here so the next reader knows to look for it.

The probe contract from ADR-019 (subtype + structural + behavioural for driven adapters) does not apply to this refactor's components — controllers are HTTP-layer adapters, not driven adapters. They have no substrate that can lie. The single-layer `pytest-archon` enforcement is the correct rigor for this surface.
