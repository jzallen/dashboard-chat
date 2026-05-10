# <!-- DES-ENFORCEMENT : exempt -->
"""Step glue for the refactor-metadata-repository-split acceptance suite.

DISTILL scaffold — every step body raises `pytest.fail("DISTILL scaffold —
DELIVER implements: <intent>")`. DELIVER replaces each body with a real
implementation that drives the `RepositoryContainer` (driving port) and
asserts on the dictionary returned by the public method (observable
outcome). No internal state is to be inspected; no production class
under refactor is to be imported into the step bodies.

Driving-port discipline (Mandate 1):
    @when bindings invoke methods on `RepositoryContainer.<aggregate>`
    properties or `RepositoryContainer.metadata` / `['metadata_repository']`
    only. Per-aggregate repository classes (`ProjectRepository`, etc.) are
    NEVER imported in this module — the container is the entry point.
"""
from __future__ import annotations

import asyncio
import uuid
from collections.abc import Coroutine
from dataclasses import dataclass, field
from typing import Any, TypeVar

import pytest
import pytest_asyncio
from pytest_bdd import given, parsers, then, when

# Fields generated per-row that are expected to differ between the two
# parallel create_project calls in the walking-skeleton scenario.
_GENERATED_PROJECT_FIELDS = frozenset({"id", "created_at", "updated_at"})

_T = TypeVar("_T")


# ---------------------------------------------------------------------------
# Capture object — observable state collected per scenario
# ---------------------------------------------------------------------------


@dataclass
class RefactorCapture:
    """Per-scenario capture of driving-port outputs.

    Holds only return values from container-property invocations and
    raised exceptions. Never holds internal state of the repos under
    refactor.
    """

    container: Any = None
    legacy_facade: Any = None
    new_repo_results: dict[str, Any] = field(default_factory=dict)
    legacy_repo_results: dict[str, Any] = field(default_factory=dict)
    raised_error: BaseException | None = None
    deprecation_warning: Any | None = None
    architectural_violation: str | None = None
    extras: dict[str, Any] = field(default_factory=dict)


@pytest_asyncio.fixture
async def capture() -> RefactorCapture:
    """Per-scenario capture; pins to the session loop pytest-asyncio drives.

    pytest-bdd 8.x does not auto-await async step functions, so step bodies
    stay synchronous and drive async work via
    ``loop.run_until_complete(...)`` through :func:`_run`. The loop is
    captured here while the fixture is awaited.
    """
    cap = RefactorCapture()
    cap.extras["_loop"] = asyncio.get_running_loop()
    return cap


def _run(capture: RefactorCapture, coro: Coroutine[Any, Any, _T]) -> _T:
    """Drive a coroutine on the session loop pinned by the capture fixture."""
    loop: asyncio.AbstractEventLoop = capture.extras["_loop"]
    return loop.run_until_complete(coro)


# ---------------------------------------------------------------------------
# Background steps — shared by walking-skeleton + milestone-1
# ---------------------------------------------------------------------------


@given("a fresh SQLite-backed repository container")
def given_fresh_container(capture: RefactorCapture, repository_container) -> None:
    """Bind the session-scoped container fixture into the capture object."""
    capture.container = repository_container


# ---------------------------------------------------------------------------
# Walking skeleton — Project parity through both entry points
# ---------------------------------------------------------------------------


@given(parsers.parse('an organization "{org_name}" exists in the database'))
def given_organization_exists(capture: RefactorCapture, db_session, org_name: str) -> None:
    """Seed an OrganizationRecord and record its id for downstream steps."""
    from app.repositories.metadata import OrganizationRecord

    org_id = str(uuid.uuid4())

    async def _seed() -> None:
        db_session.add(OrganizationRecord(id=org_id, name=org_name))
        await db_session.flush()

    _run(capture, _seed())
    capture.extras["org_id"] = org_id


@when(
    parsers.parse(
        'the engineer creates a project "{project_name}" through the new projects repository'
    )
)
def when_create_project_via_new_repo(capture: RefactorCapture, project_name: str) -> None:
    """Drive create_project through the new ``.projects`` container property."""
    result = _run(
        capture,
        capture.container.projects.create_project(
            name=project_name,
            description="initial",
            org_id=capture.extras["org_id"],
            created_by="acceptance-user",
        ),
    )
    capture.new_repo_results["create"] = result


@when(
    parsers.parse(
        'the engineer creates a project "{project_name}" through the legacy metadata facade'
    )
)
def when_create_project_via_facade(capture: RefactorCapture, project_name: str) -> None:
    """Drive create_project through the legacy ``.metadata`` facade.

    The facade's ``create_project`` delegates to a ``ProjectRepository``
    bound to the same session, so both routes hit the same SQLite engine.
    """
    result = _run(
        capture,
        capture.container.metadata.create_project(
            name=project_name,
            description="initial",
            org_id=capture.extras["org_id"],
            created_by="acceptance-user",
        ),
    )
    capture.legacy_repo_results["create"] = result


@then("both projects carry the same observable dictionary shape")
def then_projects_match_shape(capture: RefactorCapture) -> None:
    new = capture.new_repo_results["create"]
    legacy = capture.legacy_repo_results["create"]
    assert set(new.keys()) == set(legacy.keys()), (
        f"keysets diverge: new={set(new.keys())} legacy={set(legacy.keys())}"
    )
    for key in new.keys() & legacy.keys():
        if key in _GENERATED_PROJECT_FIELDS:
            continue
        assert new[key] == legacy[key], f"value for {key!r} diverged: new={new[key]!r} legacy={legacy[key]!r}"


@then("both projects are readable through their respective entry points")
def then_projects_readable(capture: RefactorCapture) -> None:
    new_id = capture.new_repo_results["create"]["id"]
    legacy_id = capture.legacy_repo_results["create"]["id"]

    new_read = _run(capture, capture.container.projects.get_project(new_id))
    legacy_read = _run(capture, capture.container.metadata.get_project(legacy_id))

    assert new_read is not None and new_read["id"] == new_id
    assert legacy_read is not None and legacy_read["id"] == legacy_id


@then("updating each project's description through its entry point persists identically")
def then_updates_persist(capture: RefactorCapture) -> None:
    new_id = capture.new_repo_results["create"]["id"]
    legacy_id = capture.legacy_repo_results["create"]["id"]

    _run(capture, capture.container.projects.update_project(new_id, {"description": "via-new"}))
    _run(capture, capture.container.metadata.update_project(legacy_id, {"description": "via-legacy"}))

    new_read = _run(capture, capture.container.projects.get_project(new_id))
    legacy_read = _run(capture, capture.container.metadata.get_project(legacy_id))

    assert new_read["description"] == "via-new"
    assert legacy_read["description"] == "via-legacy"


@then("deleting each project through its entry point removes it from the database")
def then_deletes_remove(capture: RefactorCapture) -> None:
    new_id = capture.new_repo_results["create"]["id"]
    legacy_id = capture.legacy_repo_results["create"]["id"]

    assert _run(capture, capture.container.projects.delete_project(new_id)) is True
    assert _run(capture, capture.container.metadata.delete_project(legacy_id)) is True

    assert _run(capture, capture.container.projects.get_project(new_id)) is None
    assert _run(capture, capture.container.metadata.get_project(legacy_id)) is None
    assert _run(capture, capture.container.projects.project_exists(new_id)) is False
    assert _run(capture, capture.container.metadata.project_exists(legacy_id)) is False


# ---------------------------------------------------------------------------
# Milestone 1 — Parameterised parity for the seven remaining aggregates
# ---------------------------------------------------------------------------


@given(parsers.parse('the database is seeded for the "{aggregate}" aggregate'))
def given_seeded_for_aggregate(capture: RefactorCapture, aggregate: str) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: seed FK preconditions for "
        f"the '{aggregate}' aggregate (the seed shape mirrors the "
        f"corresponding repo_with_<aggregate> fixture in "
        f"backend/tests/repositories/conftest.py)."
    )


@when(
    parsers.parse(
        'the engineer invokes "{create_method}" through the new "{aggregate}" repository property'
    )
)
def when_invoke_via_new_property(
    capture: RefactorCapture, create_method: str, aggregate: str
) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: getattr(capture.container, "
        f"'{aggregate}').{create_method}(...) with arguments shaped like the "
        f"existing per-aggregate test in "
        f"backend/tests/repositories/test_{aggregate.rstrip('s')}_repository.py; "
        f"store result in capture.new_repo_results[create_method]."
    )


@when(parsers.parse('the engineer invokes "{create_method}" through the legacy metadata facade'))
def when_invoke_via_facade(capture: RefactorCapture, create_method: str) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: getattr("
        f"capture.container.metadata, '{create_method}')(...) with the same "
        f"arguments used in the new-property invocation; store result in "
        f"capture.legacy_repo_results[create_method]."
    )


@then("both invocations return dictionaries with the same domain fields populated")
def then_invocations_match_fields(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert keysets equal and "
        "non-generated values equal between capture.new_repo_results and "
        "capture.legacy_repo_results for the create_method just invoked."
    )


@then("both records are retrievable through their respective entry points")
def then_records_retrievable(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: read each record back via "
        "the matching get_<aggregate>(id) method on each entry point and "
        "assert non-None."
    )


@when("the engineer first accesses the legacy metadata facade")
def when_first_access_facade(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: wrap the first "
        "capture.container.metadata access in warnings.catch_warnings(); "
        "store the captured warning in capture.deprecation_warning."
    )


@then("a deprecation warning is emitted naming the new container properties")
def then_deprecation_warning_emitted(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.deprecation_warning.category is DeprecationWarning and that "
        "the message text mentions at least one new property name (e.g. "
        "'projects', 'datasets')."
    )


@given("the database is seeded with three sessions for one memory")
def given_seeded_three_sessions(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: seed Org+Project+Memory then "
        "insert three SessionRecord rows with deterministic last_active_at "
        "ordering."
    )


@when("the engineer pages through sessions with limit 2 through the new sessions repository")
def when_page_sessions_new(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: call "
        "capture.container.sessions.list_sessions(memory_id, org_id, "
        "limit=2); store (items, cursor, has_more) in "
        "capture.new_repo_results['page1']; then call again with "
        "cursor=cursor; store as capture.new_repo_results['page2']."
    )


@when("the engineer pages through sessions with limit 2 through the legacy metadata facade")
def when_page_sessions_legacy(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: same as above through "
        "capture.container.metadata.list_sessions(...); store as "
        "capture.legacy_repo_results['page1' / 'page2']."
    )


@then("both pagings return the same items in the same order")
def then_pagings_same_items(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "[i['id'] for i in new_page1] == [i['id'] for i in legacy_page1] "
        "and likewise for page2."
    )


@then("both pagings return identical cursor strings")
def then_pagings_identical_cursors(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the cursor STRING "
        "from new_page1 equals the cursor STRING from legacy_page1 (proves "
        "_encode_session_cursor produces identical bytes after relocation "
        "to SessionRepository)."
    )


@given(
    "the database is in a state where a transform insert violates a foreign key"
)
def given_fk_violation_setup(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: ensure no DatasetRecord "
        "with the test dataset_id exists, so a TransformRecord insert with "
        "that FK fails at flush()."
    )


@when("the engineer attempts to create a transform through the new transforms repository")
def when_create_transform_violating_fk(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: try/except around "
        "capture.container.transforms.create_transform(...) with a missing "
        "dataset FK; store exception in capture.raised_error."
    )


@then("a metadata repository error is raised carrying the SQLAlchemy error message")
def then_metadata_error_raised(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "isinstance(capture.raised_error, MetadataRepositoryError) and that "
        "the message text contains a SQLAlchemy-originated substring."
    )


@given("a project with one dataset and one transform exists")
def given_project_dataset_transform(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: seed Org+Project+Dataset+"
        "Transform via the test db_session (mirrors the cascade test in "
        "test_project_repository.py)."
    )


@when("the engineer deletes the project through the new projects repository")
def when_delete_project_new(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: "
        "capture.container.projects.delete_project(project_id)."
    )


@then("the dataset is gone from the database")
def then_dataset_gone(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.container.datasets.dataset_exists(dataset_id) is False."
    )


@then("the transform is gone from the database")
def then_transform_gone(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert no TransformRecord "
        "remains with the seeded id (read via "
        "capture.container.transforms.get_transform / find_transform_by_sql "
        "depending on which observability surface DELIVER chooses)."
    )


# ---------------------------------------------------------------------------
# Milestone 2 — Facade removal
# ---------------------------------------------------------------------------


@given(parsers.parse('the production source tree under "{path}"'))
def given_production_source_tree(capture: RefactorCapture, path: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: capture.extras['scan_path'] "
        "= absolute path to the given subtree; later step walks it for "
        "imports."
    )


@when("the engineer scans for legacy metadata repository imports")
def when_scan_for_legacy_imports(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: walk capture.extras["
        "'scan_path'], parse Python imports (ast or grep equivalent), "
        "collect modules that import 'MetadataRepository' or "
        "'_LegacyMetadataFacade' from app.repositories(.metadata); store "
        "the offenders list in capture.architectural_violation (None if "
        "clean)."
    )


@then("no module imports MetadataRepository or LegacyMetadataFacade")
def then_no_legacy_imports(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.architectural_violation is None — no offending modules."
    )


@given("a fresh SQLite-backed repository container with the facade removed")
def given_container_facade_removed(capture: RefactorCapture, repository_container) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: bind the post-Phase-03 "
        "container (no .metadata property, no 'metadata_repository' key); "
        "this fixture only resolves once Phase 03 lands."
    )


@when("the engineer accesses the legacy metadata property on the container")
def when_access_legacy_metadata_property(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: try/except around "
        "capture.container.metadata; store AttributeError in "
        "capture.raised_error."
    )


@then("an attribute error is raised")
def then_attribute_error(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "isinstance(capture.raised_error, AttributeError)."
    )


@when('the engineer requests the legacy "metadata_repository" key from the container')
def when_request_legacy_key(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: try/except around "
        "capture.container['metadata_repository']; store KeyError in "
        "capture.raised_error."
    )


@then("a key error is raised naming the unknown repository")
def then_key_error(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "isinstance(capture.raised_error, KeyError) and that "
        "'metadata_repository' is in the str(KeyError)."
    )


@given("a candidate use-case module that re-introduces a MetadataRepository import")
def given_candidate_violator(capture: RefactorCapture, tmp_path) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: write a temporary Python "
        "module to tmp_path that contains 'from app.repositories.metadata "
        "import MetadataRepository'; record the path in "
        "capture.extras['violator_path']."
    )


@when("the architectural rule is evaluated against the production source tree")
def when_run_archon_rule(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: run the pytest-archon rule "
        "(per DWD-7 in DESIGN's wave-decisions) against the production "
        "tree augmented with capture.extras['violator_path']; capture the "
        "rule's failure message in capture.architectural_violation."
    )


@then("the rule fails naming the offending module")
def then_archon_rule_fails(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.architectural_violation is not None and that the violator "
        "path appears in it."
    )


@when("the engineer requests each per-aggregate property in turn")
def when_request_each_property(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: for each property name in "
        "{'projects', 'datasets', 'transforms', 'sessions', 'views', "
        "'reports', 'organizations', 'project_memories'}, getattr the "
        "property and store the instance in "
        "capture.extras['per_property'][name]."
    )


@then("each property yields a constructed repository instance bound to the same session")
def then_each_property_yields_instance(capture: RefactorCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert all eight values in "
        "capture.extras['per_property'] are non-None and that each "
        "instance's bound session attribute is the same RestrictedSession "
        "object."
    )
