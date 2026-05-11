# <!-- DES-ENFORCEMENT : exempt -->
"""Step glue for the refactor-controller-use-case-injection acceptance suite.

DISTILL scaffold — every step body raises
``pytest.fail("DISTILL scaffold — DELIVER implements: <intent>")``.
DELIVER replaces each body with a real implementation that drives the
per-aggregate controller class as a static method (the driving port:
the controller method itself, exactly as routers/<aggregate>s.py calls
it today) and asserts on the tuple[dict, int] envelope returned.

Driving-port discipline (Mandate 1):
    @when bindings invoke per-aggregate controller staticmethods (e.g.
    ``OrganizationController.get_my_organization(...)``) with an
    optional ``_use_cases=fake_factory`` keyword argument. Internal
    helpers (``_default_*_uc``, ``_serialize``, ``_error_response``)
    are NEVER imported into step bodies — the controller method is
    the entry point.

The ``__SCAFFOLD__`` sentinel exists so that the DELIVER reviewer can
grep this file and confirm zero scaffold bodies remain after Phase 03;
when DELIVER implements the last step body, the sentinel flips to
``False`` (or the ``__SCAFFOLD__`` line is deleted entirely).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest
from pytest_bdd import given, parsers, then, when

__SCAFFOLD__ = True


# ---------------------------------------------------------------------------
# Capture object — observable state collected per scenario
# ---------------------------------------------------------------------------


@dataclass
class ControllerCapture:
    """Per-scenario capture of driving-port outputs.

    Holds only return values from controller-method invocations,
    raised exceptions, and the synthetic-violator artefacts the
    architectural-enforcement scenarios construct in tmp_path. Never
    holds internal state of the controller classes under refactor.
    """

    fake_use_cases: Any = None
    response_body: dict | None = None
    response_status: int | None = None
    fake_call_log: list[dict] = field(default_factory=list)
    raised_error: BaseException | None = None
    inspected_signature: Any = None
    inspected_factory: Any = None
    architectural_violation: str | None = None
    pre_migration_assertions: list[str] = field(default_factory=list)
    migrated_assertions: list[str] = field(default_factory=list)
    extras: dict[str, Any] = field(default_factory=dict)


@pytest.fixture
def capture() -> ControllerCapture:
    return ControllerCapture()


# ---------------------------------------------------------------------------
# Walking skeleton — get_my_organization with fake injected
# ---------------------------------------------------------------------------


@given(
    parsers.parse(
        'a fake organization use-cases module returning a single organization named "{org_name}"'
    )
)
def given_fake_organization_uc(capture: ControllerCapture, org_name: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: build a MagicMock with "
        "get_organization = AsyncMock(return_value=Success({'id': 'org-1', "
        "'name': org_name})); store it on capture.fake_use_cases. The "
        "fake_use_cases_factory helper in conftest.py composes this."
    )


@when("the engineer calls get_my_organization with the fake factory injected")
def when_call_get_my_organization_with_fake(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: from "
        "app.controllers.organization_controller import OrganizationController; "
        "body, status = await OrganizationController.get_my_organization("
        "user='engineer-user-id', _use_cases=lambda: capture.fake_use_cases); "
        "store in capture.response_body / capture.response_status. NOTE: this "
        "is the driving port — the controller method itself, called the "
        "same way routers/organizations.py:39 calls it (plus the new kwarg)."
    )


@then(parsers.parse('the response envelope identifies the organization as "{org_name}"'))
def then_response_envelope_names_org(capture: ControllerCapture, org_name: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.response_body['data']['attributes']['name'] == org_name (or "
        "the equivalent envelope shape per response_wrapper.wrap_jsonapi_single — "
        "this is what the controller method returns from its Success branch)."
    )


@then("the response status indicates a successful read")
def then_response_status_success(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.response_status == 200."
    )


@then("the fake's get_organization function received the engineer's user identity")
def then_fake_received_user(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.fake_use_cases.get_organization.assert_awaited_once_with("
        "user='engineer-user-id'). This pins that the kwarg actually wired "
        "through to the call expression — if `_use_cases` were silently "
        "ignored, this assertion would fail."
    )


# ---------------------------------------------------------------------------
# Milestone 1 — kwarg-injection mechanism (six simple controllers)
# ---------------------------------------------------------------------------


@given(parsers.parse('the per-aggregate controller module for "{aggregate}"'))
def given_per_aggregate_module(capture: ControllerCapture, aggregate: str) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: importlib.import_module("
        f"f'app.controllers.{{aggregate}}_controller'); store on "
        f"capture.extras['module']. For aggregate='{aggregate}'."
    )


@when(parsers.parse('the engineer inspects the signature of "{method}"'))
def when_inspect_signature(capture: ControllerCapture, method: str) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: locate the controller "
        f"class on capture.extras['module']; getattr the static method "
        f"'{method}'; store inspect.signature(method) on "
        f"capture.inspected_signature."
    )


@then(parsers.parse('the parameter "{param_name}" is keyword-only'))
def then_param_is_keyword_only(capture: ControllerCapture, param_name: str) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: assert "
        f"capture.inspected_signature.parameters['{param_name}'].kind == "
        f"inspect.Parameter.KEYWORD_ONLY."
    )


@then(parsers.parse('the parameter\'s default callable is the module-private factory "{factory}"'))
def then_default_is_factory(capture: ControllerCapture, factory: str) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: assert "
        f"capture.inspected_signature.parameters['_use_cases'].default is "
        f"getattr(capture.extras['module'], '{factory}'); store the factory "
        f"on capture.inspected_factory."
    )


@then(parsers.parse('calling "{factory}" returns the real "{aggregate}" use-cases module'))
def then_factory_returns_real_module(
    capture: ControllerCapture, factory: str, aggregate: str
) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: invoke capture.inspected_factory(); "
        f"assert the returned object is `app.use_cases.{aggregate}` (compare "
        f"by `is` to importlib.import_module). This proves the factory body "
        f"performs the deferred import correctly."
    )


@given("a fake use-cases module that records every method invocation")
def given_recording_fake(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: build a recording MagicMock "
        "where every method is an AsyncMock(return_value=Success({})); store "
        "on capture.fake_use_cases; record each invocation into "
        "capture.fake_call_log."
    )


@when(
    "the engineer calls each simple per-aggregate controller method with the fake injected via `_use_cases`"
)
def when_call_each_simple_controller_with_fake(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: iterate over the six simple "
        "per-aggregate controllers (report, project, query_engine, sql_access, "
        "organization, view); for each, call one representative method "
        "with `_use_cases=lambda: capture.fake_use_cases` and minimal "
        "valid arguments. Every invocation MUST hit "
        "capture.fake_use_cases.<method>, never the real module."
    )


@then("every recorded invocation came through the fake module")
def then_every_invocation_via_fake(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "len(capture.fake_call_log) == 6 and every entry's `module_id` "
        "matches id(capture.fake_use_cases) (proves no fall-through to "
        "the real module)."
    )


@then("no recorded invocation came through the real module")
def then_no_invocation_via_real(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert no entry in "
        "capture.fake_call_log carries a module_id matching any of the "
        "real `app.use_cases.<aggregate>` module identities."
    )


@given("a router-style call to a simple per-aggregate controller method that omits `_use_cases`")
def given_router_style_call(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: prepare the call expression "
        "exactly as routers/<aggregate>s.py spells it (positional + named "
        "kwargs the router passes), but do not include `_use_cases`. Stash "
        "the call args/kwargs in capture.extras for the @when step."
    )


@when("the call resolves")
def when_call_resolves(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: monkey-patch the real "
        "use_cases module's representative method to a recording wrapper; "
        "invoke the controller method without `_use_cases`; restore the "
        "real method; record whether the wrapper was called."
    )


@then("the default factory is invoked")
def then_default_factory_invoked(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.extras['default_factory_called'] is True (proves the "
        "default kwarg value resolved when the caller omitted it)."
    )


@then("the real use-cases module's method was the one called")
def then_real_module_method_called(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the recording "
        "wrapper from the prior step recorded exactly one call (proves "
        "the production path resolves to the real module when no kwarg "
        "is supplied)."
    )


@when("the engineer inspects the module's factory functions")
def when_inspect_factory_functions(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: introspect "
        "capture.extras['module'] for every name starting with "
        "'_default_' and ending in '_uc'; store them on "
        "capture.extras['factories'] as a dict {name: callable}."
    )


@then(
    parsers.parse(
        'a factory "{factory}" is defined and returns the real "{module_path}" {kind}'
    )
)
def then_factory_returns_real(
    capture: ControllerCapture, factory: str, module_path: str, kind: str
) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: assert factory '{factory}' "
        f"in capture.extras['factories']; invoke it; assert the returned "
        f"object is the real `{module_path}` {kind} (compare by `is` to "
        f"importlib.import_module)."
    )


@then(
    "every public method on DatasetController accepts a `_use_cases` keyword-only parameter whose default is one of the three factories"
)
def then_dataset_methods_accept_uc(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: from "
        "app.controllers.dataset_controller import DatasetController; for "
        "every public staticmethod, assert _use_cases is keyword-only and "
        "its default is one of {_default_dataset_uc, _default_upload_uc, "
        "_default_search_uc}."
    )


@then(
    "a factory exists for each of the five submodule aliases — get_project_memory, create_session, list_sessions, list_session_events, update_session"
)
def then_conversation_factories_exist(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert capture.extras["
        "'factories'] contains at least {_default_get_project_memory_uc, "
        "_default_create_session_uc, _default_list_sessions_uc, "
        "_default_list_session_events_uc, _default_update_session_uc}."
    )


@then(
    "every public method on ConversationController accepts a `_use_cases` keyword-only parameter whose default is the matching factory"
)
def then_conversation_methods_accept_uc(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: from "
        "app.controllers.conversation_controller import ConversationController; "
        "build the method→factory mapping per upstream-changes.md §3 and "
        "assert each method's `_use_cases` default is the matching factory."
    )


@given("a fake use-cases factory that raises a domain exception when invoked")
def given_failing_fake(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: build a MagicMock whose "
        "representative method returns Failure(ExternalServiceError(...)); "
        "store on capture.fake_use_cases."
    )


@when(
    "the engineer calls a per-aggregate controller method with that factory injected via `_use_cases`"
)
def when_call_with_failing_fake(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: pick a representative "
        "controller method (e.g. OrganizationController.post_organization); "
        "invoke with `_use_cases=lambda: capture.fake_use_cases`; store "
        "(body, status) on capture.response_body / capture.response_status."
    )


@then("the controller's response envelope describes the domain exception")
def then_envelope_describes_domain_error(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.response_body['errors'][0]['title'] mentions the domain "
        "exception's category (per _error_response mapping in "
        "_result_mapper.py)."
    )


@then("the response status is the mapped error status")
def then_status_is_mapped(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.response_status == 502 (ExternalServiceError → 502 per "
        "the existing _result_mapper mapping)."
    )


@given(
    "a fake use-cases factory whose returned module is missing the method the controller calls"
)
def given_method_missing_fake(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: build a MagicMock with "
        "spec=[] (no methods); store on capture.fake_use_cases."
    )


@when(
    "the engineer calls the per-aggregate controller method with that factory injected via `_use_cases`"
)
def when_call_with_method_missing_fake(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: try/except around the "
        "controller call with the spec-empty fake; store the exception on "
        "capture.raised_error."
    )


@then("an attribute error is raised naming the missing method")
def then_attribute_error_names_method(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "isinstance(capture.raised_error, AttributeError) and the method "
        "name appears in str(capture.raised_error)."
    )


# ---------------------------------------------------------------------------
# Milestone 2 — Test migration completed; alias debt removed
# ---------------------------------------------------------------------------


@given(parsers.parse('the production source tree under "{path}"'))
def given_source_tree(capture: ControllerCapture, path: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: capture.extras['scan_path'] "
        "= absolute path to the given subtree under the repo root."
    )


@when(
    "the engineer scans for `@patch(\"app.controllers.http_controller.<aggregate>_use_cases\")` occurrences"
)
def when_scan_for_legacy_patches(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: walk capture.extras["
        "'scan_path'], grep every .py file for "
        "r'@patch\\(\"app\\.controllers\\.http_controller\\..*_use_cases\"'; "
        "collect occurrences in capture.architectural_violation (None if "
        "clean)."
    )


@then("no occurrence remains in any file under that subtree")
def then_no_legacy_patches(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.architectural_violation is None — zero hits in the grep."
    )


@when(parsers.parse('the engineer reads the contents of "{filename}"'))
def when_read_file(capture: ControllerCapture, filename: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: read the file at "
        "capture.extras['scan_path'] / filename; store the contents in "
        "capture.extras['file_contents']."
    )


@then(parsers.parse('no line imports a use-case module under the name "{alias_pattern}"'))
def then_no_use_case_alias_imports(capture: ControllerCapture, alias_pattern: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: scan "
        "capture.extras['file_contents'] for "
        "r'from app\\.use_cases import .* as .*_use_cases'; assert zero "
        "matches (the entire 18-line alias block is gone)."
    )


@then(parsers.parse('no line imports a use-case submodule under the name "{alias_pattern}"'))
def then_no_use_case_submodule_imports(
    capture: ControllerCapture, alias_pattern: str
) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: scan "
        "capture.extras['file_contents'] for "
        "r'from app\\.use_cases\\.(session|memory|dataset) import .* as "
        ".*_uc'; assert zero matches (submodule aliases like "
        "create_session_uc, get_project_memory_uc, search_datasets_uc are "
        "gone too)."
    )


@then(parsers.parse('the file\'s docstring no longer warns "{warning_text}"'))
def then_docstring_warning_removed(capture: ControllerCapture, warning_text: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert warning_text not in "
        "capture.extras['file_contents'] (the 'Do NOT remove' docstring "
        "block at the top of http_controller.py is gone or rewritten)."
    )


@when(
    parsers.parse(
        'the engineer scans every "{pattern}" file for `def _uc()`'
    )
)
def when_scan_for_uc_getters(capture: ControllerCapture, pattern: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: glob "
        "capture.extras['scan_path'] / pattern; for each match, grep for "
        "r'def _uc\\(\\)'; collect any hits on "
        "capture.architectural_violation."
    )


@then("no per-aggregate controller defines an `_uc()` getter")
def then_no_uc_getters(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.architectural_violation is None — zero `def _uc()` "
        "occurrences across all per-aggregate controller files."
    )


@then("every per-aggregate controller defines at least one `_default_*_uc` factory in its place")
def then_every_controller_has_default_factory(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: for each "
        "<aggregate>_controller.py file, grep for "
        "r'def _default_.*_uc'; assert ≥1 match per file. Per "
        "upstream-changes.md §6 the aggregate counts are: 1 each for "
        "report/project/query_engine/sql_access/organization/view; 3 for "
        "dataset; 5 for conversation."
    )


@given(parsers.parse('the pre-migration assertion lines captured for "{filename}"'))
def given_premigration_assertions(capture: ControllerCapture, filename: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: at the start of the "
        "DELIVER PR, capture every line in <filename> matching "
        "r'^\\s*(assert |.*\\.assert_(awaited|called)_)' and store as "
        "capture.pre_migration_assertions. Practical mechanism: a "
        "git-show against origin/main extracts the original file."
    )


@when(parsers.parse('the engineer reads the migrated assertion lines for the same file'))
def when_read_migrated_assertions(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: capture every line in the "
        "post-migration version of the file matching the same regex; store "
        "on capture.migrated_assertions."
    )


@then(
    "every `assert` line, every `assert_awaited_once_with` line, and every `assert_called_with` line is byte-identical to its pre-migration counterpart"
)
def then_assertions_byte_identical(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.pre_migration_assertions == capture.migrated_assertions "
        "(list equality on byte-identical strings; preserves DWD-6 Iron "
        "Rule)."
    )


@then(
    "the only diffs in the file are removed `@patch(...)` decorators, removed `mock_uc` parameter names from method signatures, added local `mock_uc = MagicMock()` constructions, and added `_use_cases=lambda: mock_uc` arguments on controller calls"
)
def then_only_allowed_diffs(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: run unified diff between "
        "the pre-migration and post-migration text; classify every "
        "non-context line into one of the four allowed categories per "
        "DWD-6; assert the residual category is empty."
    )


@given(parsers.parse('the migrated state of "{path}"'))
def given_migrated_state(capture: ControllerCapture, path: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: capture.extras["
        "'migrated_path'] = absolute path to the post-migration test "
        "subtree (typically just the working-copy state on the DELIVER "
        "PR's tip commit)."
    )


@when("the engineer runs the backend characterization suite")
def when_run_backend_char_suite(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: subprocess.run(['uv', "
        "'run', 'pytest', capture.extras['migrated_path']], cwd='backend', "
        "capture_output=True); store returncode + stdout/stderr on "
        "capture.extras['pytest_result']."
    )


@then(parsers.parse('every test under "{path}" passes'))
def then_every_test_passes(capture: ControllerCapture, path: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.extras['pytest_result'].returncode == 0 and that the "
        "summary line reports zero failures and zero errors."
    )


@then(parsers.parse('no test under that subtree skips for "patch target missing" reasons'))
def then_no_patch_target_missing_skips(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert no SKIPPED line in "
        "capture.extras['pytest_result'].stdout mentions "
        "'app.controllers.http_controller' (would indicate a stale patch "
        "target slipped through review)."
    )


@given(
    parsers.parse(
        'a characterization test for "{controller_method}" that previously patched the legacy alias to return Failure(ExternalServiceError)'
    )
)
def given_premigration_char_test(
    capture: ControllerCapture, controller_method: str
) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: locate the pre-migration "
        f"test for {controller_method} in test_*_char.py; capture its "
        f"assertion bytes on capture.pre_migration_assertions."
    )


@when(
    parsers.parse(
        'the engineer runs the migrated test using `_use_cases=lambda: mock_uc` instead of the patch'
    )
)
def when_run_migrated_test_with_kwarg(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: invoke pytest against the "
        "single migrated test by node id (e.g. "
        "'tests/controllers/test_organization_controller_char.py::TestGet"
        "MyOrganizationCharacterization::test_failure_routes_through_error"
        "_response'); store the result on capture.extras['pytest_result']."
    )


@then(parsers.parse('the assertion `{assertion}` holds'))
def then_assertion_holds(capture: ControllerCapture, assertion: str) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: assert "
        f"capture.extras['pytest_result'].returncode == 0 (the test that "
        f"contains `{assertion}` passed)."
    )


@then("the assertion line text is byte-identical to the pre-migration line")
def then_single_assertion_byte_identical(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: locate the matching "
        "assertion line in the migrated file; assert string equality "
        "with its pre-migration counterpart on "
        "capture.pre_migration_assertions."
    )


@given(
    parsers.parse(
        'a characterization test for "{controller_method}" that previously patched "{alias}"'
    )
)
def given_premigration_char_test_named_alias(
    capture: ControllerCapture, controller_method: str, alias: str
) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: locate the pre-migration "
        f"test for {controller_method} that contained "
        f"@patch('app.controllers.http_controller.{alias}'); capture "
        f"assertions for migration comparison."
    )


@when(
    parsers.parse(
        'the engineer runs the migrated test using `_use_cases=lambda: mock_uc` against the controller method'
    )
)
def when_run_migrated_submodule_test(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: same as the prior @when, "
        "scoped to the submodule-aliased test (post_session, etc.)."
    )


@when(
    parsers.parse(
        'the engineer runs the migrated test using `_use_cases=lambda: mock_upload_uc` against the controller method'
    )
)
def when_run_migrated_multifactory_test(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: same as above, scoped to "
        "the multi-factory test (DatasetController.post_upload uses the "
        "_default_upload_uc factory; the kwarg name is still `_use_cases` "
        "but the injected factory targets upload, not dataset)."
    )


@then("the assertion lines are byte-identical to the pre-migration lines")
def then_test_assertions_byte_identical(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.migrated_assertions == capture.pre_migration_assertions "
        "for the scoped test."
    )


@then("the test passes")
def then_test_passes(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.extras['pytest_result'].returncode == 0."
    )


# ---------------------------------------------------------------------------
# Milestone 3 — Architectural enforcement (pytest-archon rules)
# ---------------------------------------------------------------------------


@given(
    parsers.parse(
        'a synthetic candidate version of "{filename}" that imports "{import_stmt}" at module level'
    )
)
def given_synthetic_alias_violator(
    capture: ControllerCapture, filename: str, import_stmt: str, tmp_path
) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: write a copy of the "
        "production filename to tmp_path, prepended with the import "
        "statement; record the path on capture.extras['violator_path']."
    )


@when("the architectural rule is evaluated against the production source tree augmented with the candidate")
def when_run_arch_rule_with_violator(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: invoke the pytest-archon "
        "rule machinery (the same harness "
        "backend/tests/architecture/test_controller_imports.py uses) "
        "against the source tree augmented with "
        "capture.extras['violator_path']; capture the rule's failure "
        "message on capture.architectural_violation."
    )


@then("the rule fails naming the candidate file")
def then_rule_fails_names_file(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.architectural_violation is not None and the violator "
        "filename appears in it."
    )


@then(parsers.parse('the failure message identifies "{token}" as the offending alias'))
def then_failure_names_alias(capture: ControllerCapture, token: str) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: assert '{token}' in "
        f"capture.architectural_violation."
    )


@given(parsers.parse('the legitimate post-refactor "{filename}"'))
def given_legitimate_postrefactor_file(
    capture: ControllerCapture, filename: str
) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: capture.extras["
        "'target_path'] = absolute path to the file as it stands at HEAD."
    )


@when("the architectural rule is evaluated")
def when_run_arch_rule_clean(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: invoke the rule against "
        "the unmodified production source tree; store result on "
        "capture.architectural_violation (None if clean)."
    )


@then("the rule passes with zero violations")
def then_rule_passes_clean(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.architectural_violation is None."
    )


@given(
    parsers.parse(
        'a synthetic candidate version of "{filename}" with no `_default_{aggregate}_uc` factory defined'
    )
)
def given_synthetic_factory_violator(
    capture: ControllerCapture, filename: str, aggregate: str, tmp_path
) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: write a copy of the "
        "production controller to tmp_path with the _default_*_uc "
        "definition deleted; record path on capture.extras['violator_path']."
    )


@then("the failure message identifies the missing factory function")
def then_failure_names_missing_factory(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the missing "
        "factory name appears in capture.architectural_violation."
    )


@given(
    parsers.parse(
        'a synthetic candidate version of "{filename}" where "{method}" was edited to drop the `_use_cases` parameter'
    )
)
def given_synthetic_kwarg_violator(
    capture: ControllerCapture, filename: str, method: str, tmp_path
) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: write a copy of the "
        "production controller to tmp_path where method's signature has "
        "the `_use_cases` parameter removed; record path on "
        "capture.extras['violator_path']."
    )


@then(parsers.parse('the failure message identifies "{method}" as the offending method'))
def then_failure_names_method(capture: ControllerCapture, method: str) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: assert '{method}' in "
        f"capture.architectural_violation."
    )


@given(parsers.parse('the legitimate post-refactor controllers in "{path}"'))
def given_legitimate_controllers(capture: ControllerCapture, path: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: capture.extras["
        "'target_path'] = absolute path to the controllers subtree."
    )


@then(
    "the rule passes with zero violations across all eight per-aggregate controller modules"
)
def then_rule_passes_eight_controllers(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.architectural_violation is None and that the rule "
        "evaluated all eight per-aggregate controller modules (per "
        "upstream-changes.md §1's enumeration: report, project, "
        "query_engine, sql_access, organization, view, dataset, "
        "conversation)."
    )


@given(
    parsers.parse(
        'a synthetic candidate router that contains `Depends({controller})` in a route handler signature'
    )
)
def given_synthetic_depends_violator(
    capture: ControllerCapture, controller: str, tmp_path
) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: write a synthetic router "
        "file to tmp_path containing `def handler(c = Depends("
        f"{{controller}})): ...`; record the path on "
        "capture.extras['violator_path']."
    )


@then(parsers.parse('the failure message identifies "{controller}" as the controller wired via Depends'))
def then_failure_names_controller_via_depends(
    capture: ControllerCapture, controller: str
) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: assert '{controller}' in "
        f"capture.architectural_violation and 'Depends' in "
        f"capture.architectural_violation."
    )


@when(
    "the architectural rule scans every router file for `Depends(<X>Controller`"
)
def when_scan_routers_for_depends(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: walk "
        "capture.extras['scan_path'] (= backend/app/routers/); grep each "
        "file for r'Depends\\([A-Z]\\w+Controller'; record any hits."
    )


@then("no router contains `Depends(<X>Controller` for any controller class")
def then_no_router_uses_depends_controller(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert zero matches "
        "across all 11 router files. Per DWD-3 (DESIGN), this pins the "
        "FastAPI Depends non-interaction guarantee that load-bears the "
        "γ rejection."
    )


@then(
    "every controller invocation in every router resolves through a direct static-method call"
)
def then_routers_use_static_call(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: re-scan every router "
        "for r'await HTTPController\\.\\w+\\('; assert >= 41 hits (per "
        "DESIGN §7's audit)."
    )


@when(
    "the architectural rule scans every use-case function signature for a `_use_cases` parameter"
)
def when_scan_use_cases_for_use_cases_param(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: walk "
        "capture.extras['scan_path'] (= backend/app/use_cases/); for "
        "every async/sync function definition, AST-introspect the "
        "parameter list; record any function declaring a `_use_cases` "
        "parameter."
    )


@then("no use-case function declares a parameter named `_use_cases`")
def then_no_use_case_uses_use_cases_param(capture: ControllerCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert zero matches. "
        "Per Risk 2 in DESIGN §7, this prevents an accidental "
        "name-collision between the controller's injection kwarg and a "
        "use-case parameter."
    )
