<!-- DES-ENFORCEMENT : exempt -->
# C4 Diagrams — Controller use-case injection refactor

Mermaid C4 Component (L3) views of the **current** alias-shim shape and the **proposed** factory-injection shape, plus a sequence diagram for a representative call path. Scope is the `backend` container only — system-context (L1) and container (L2) views are unchanged from `docs/product/architecture/brief.md` and are not duplicated here.

## L3 — Current state (alias-shim shape)

```mermaid
C4Component
  title Component Diagram (L3) — Controller layer, CURRENT (alias shim)

  Container_Boundary(backend, "backend (FastAPI)") {
    Component(router_reports, "routers/reports.py", "FastAPI router", "5 endpoints; calls HTTPController.<m>(...) directly")
    Component(http_facade, "HTTPController class\n(http_controller.py)", "facade — staticmethod re-exports", "Re-exports per-aggregate controller methods")
    Component(alias_block, "Module alias block\n(http_controller.py L26-41)", "module-level imports", "report_use_cases, dataset_use_cases, ...\n(test patch targets ONLY)")
    Component(report_ctrl, "ReportController\n(report_controller.py)", "per-aggregate controller", "5 staticmethods + _uc() getter")
    Component(uc_module, "app.use_cases.report", "use-case module", "list_reports, create_report, ...")
    Component(test_suite, "tests/controllers/\ntest_*_char.py", "unittest + pytest", "@patch('app.controllers.http_controller.report_use_cases')")
  }

  Rel(router_reports, http_facade, "calls staticmethod\n(direct, no Depends)")
  Rel(http_facade, report_ctrl, "delegates via\nstaticmethod re-export")
  Rel(report_ctrl, alias_block, "reads alias at call time\nvia _uc() getter")
  Rel(alias_block, uc_module, "imports at module load\n(eager)")
  Rel(test_suite, alias_block, "patches symbol on module\n(brittle binding)")
  Rel(test_suite, http_facade, "calls under patch")

  UpdateRelStyle(test_suite, alias_block, $textColor="red", $lineColor="red", $offsetX="-40")
  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

**Key signal (red arrow):** the test → alias-block dependency is the L4 root cause. Tests bind to a module symbol, not to the controller's contract. The `_uc()` getter exists *only* to bridge the controller to that symbol.

## L3 — Proposed state (factory-injection shape)

```mermaid
C4Component
  title Component Diagram (L3) — Controller layer, PROPOSED (factory injection)

  Container_Boundary(backend, "backend (FastAPI)") {
    Component(router_reports2, "routers/reports.py", "FastAPI router", "5 endpoints; calls HTTPController.<m>(...) directly\n(UNCHANGED — 0 diffs)")
    Component(http_facade2, "HTTPController class\n(http_controller.py)", "facade — staticmethod re-exports", "Alias block REMOVED;\nre-exports unchanged")
    Component(report_ctrl2, "ReportController\n(report_controller.py)", "per-aggregate controller", "5 staticmethods, each with\nkw-only _use_cases=_default_uc")
    Component(default_factory, "_default_uc()\n(report_controller.py)", "module-private factory", "lazy: from app.use_cases import report")
    Component(uc_module2, "app.use_cases.report", "use-case module", "list_reports, create_report, ...")
    Component(test_suite2, "tests/controllers/\ntest_*_char.py", "unittest + pytest", "Passes _use_cases=lambda: fake_uc\nas keyword argument")
    Component(arch_rule, "pytest-archon rule\n(tests/architecture/)", "import-graph enforcement", "Forbids module-level use_cases\naliases on http_controller")
  }

  Rel(router_reports2, http_facade2, "calls staticmethod\n(direct, no Depends)")
  Rel(http_facade2, report_ctrl2, "delegates via\nstaticmethod re-export")
  Rel(report_ctrl2, default_factory, "default kwarg value\nresolved on call")
  Rel(default_factory, uc_module2, "lazy imports\nat first call")
  Rel(test_suite2, report_ctrl2, "passes _use_cases=fake_factory\n(explicit injection)")
  Rel(arch_rule, http_facade2, "asserts no use_cases\naliases at module level")

  UpdateRelStyle(test_suite2, report_ctrl2, $textColor="green", $lineColor="green", $offsetX="-40")
  UpdateRelStyle(arch_rule, http_facade2, $textColor="blue", $lineColor="blue", $lineStyle="dashed")
  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

**Key changes:**
- The alias block is **gone**. There is no module-level shared symbol for tests to patch.
- The `_uc()` getter on the controller is **replaced** by `_default_uc` (used as the default value of a keyword-only parameter). The body of `_default_uc` performs the same lazy import the old getter did.
- Tests now bind to the controller's **signature** (green arrow) — explicit, contract-level coupling — not to a module symbol.
- The `pytest-archon` rule (blue dashed arrow) is the architectural enforcement layer (Principle 11) that prevents future regression.

## Sequence — Representative call path

`POST /api/projects/{project_id}/reports` (production) — illustrates how the default factory wins when no test-time override is supplied.

```mermaid
sequenceDiagram
  autonumber
  actor Client
  participant Router as routers/reports.py
  participant Auth as authorize_project_access<br/>(Depends)
  participant Facade as HTTPController.post_report<br/>(staticmethod re-export)
  participant Ctrl as ReportController.post_report
  participant Factory as _default_uc()
  participant UC as app.use_cases.report
  participant Repo as RepositoryContainer<br/>(via @with_repositories)

  Client->>Router: POST /api/projects/p1/reports<br/>{name, ...}
  Router->>Auth: resolves project context
  Auth-->>Router: (user, project)
  Router->>Facade: HTTPController.post_report(<br/>"p1", project=project, **body)
  Note right of Router: Direct call.<br/>FastAPI does NOT see _use_cases<br/>because Router is the<br/>only handler FastAPI inspects.
  Facade->>Ctrl: ReportController.post_report(<br/>"p1", project=project, **body)
  Note right of Ctrl: Production path:<br/>caller did NOT pass _use_cases.<br/>Default factory binds.
  Ctrl->>Factory: _default_uc()
  Factory->>UC: from app.use_cases import report<br/>(lazy, first-call only)
  UC-->>Factory: <module 'app.use_cases.report'>
  Factory-->>Ctrl: report module
  Ctrl->>UC: report.create_report(<br/>project_id="p1", project=project, **body)
  UC->>Repo: @with_repositories injects<br/>RepositoryContainer
  Repo-->>UC: ProjectRepository,<br/>ReportRepository, ...
  UC-->>Ctrl: Success(Report)<br/>(or Failure(Domain))
  Ctrl-->>Facade: ({"data": {...}}, 201)
  Facade-->>Router: ({"data": {...}}, 201)
  Router-->>Client: 201 + JSON:API envelope
```

**Test-mode variant** (single line difference at step 5):

```mermaid
sequenceDiagram
  autonumber
  participant Test as test_post_report_<br/>characterization
  participant Ctrl as ReportController.post_report
  participant FakeUC as fake_uc<br/>(MagicMock)

  Test->>Test: fake_uc = MagicMock()<br/>fake_uc.create_report = AsyncMock(<br/>  return_value=Success(Report(...)))
  Test->>Ctrl: ReportController.post_report(<br/>"p1", project=p, name="X",<br/>_use_cases=lambda: fake_uc)
  Note right of Ctrl: Test-mode path:<br/>caller PASSED _use_cases.<br/>Default factory bypassed.
  Ctrl->>FakeUC: fake_uc.create_report(<br/>project_id="p1", project=p, name="X")
  FakeUC-->>Ctrl: Success(Report(...))
  Ctrl-->>Test: ({"data": {...}}, 201)
  Test->>Test: assert status == 201<br/>assert body["data"]["type"] == "reports"<br/>fake_uc.create_report.assert_awaited_once_with(...)
```

**The two flows differ by one argument.** In production, `_use_cases` defaults to `_default_uc` (lazy real-module import). In tests, `_use_cases` is a caller-supplied factory returning a `MagicMock`. Production routers never pass `_use_cases`; tests always do. This is the entire mechanism.
