# <!-- DES-ENFORCEMENT : exempt -->
"""Step glue for the refactor-upload-pipeline-modularity acceptance suite.

Phase 00 of DELIVER wires the walking-skeleton step bodies; milestone-1
+ milestone-2 + milestone-3 step bodies remain `pytest.fail` scaffolds
behind their `@pending` markers and are unpended per the roadmap.

Driving-port discipline (Mandate 1):
    @when bindings invoke `create_dataset_from_upload(...)` (use-case
    function, the public driving port for milestones 1 and 2) or
    `DatasetController.post_dataset(...)` (milestone 3). The new
    `UploadPluginDispatcher` class is NEVER imported in @when steps —
    it is a use-case-internal coordinator (DWD-8). The single exception
    is `then_dispatcher_used`, which performs an import-graph proof
    rather than a use-case invocation.

Iron Rule (per CLAUDE.md): the 15 existing tests at
backend/tests/use_cases/dataset/test_create_dataset_from_upload.py
stay green byte-for-byte. The acceptance suite is parallel to those
characterization tests, not a replacement.
"""
from __future__ import annotations

import asyncio
import io
from dataclasses import asdict, dataclass, field
from functools import partial
from typing import Any

import boto3
import pytest
import pytest_asyncio
from botocore.stub import Stubber
from pytest_bdd import given, parsers, then, when
from returns.result import Success

# Mandate 7 marker — every step body for milestones 1/2/3 is still a
# DISTILL scaffold. The walking-skeleton steps below are implemented.
# DELIVER must keep flipping this to False (or remove it) as each
# milestone unpends.
__SCAFFOLD__ = True


# ---------------------------------------------------------------------------
# Capture object — observable state collected per scenario
# ---------------------------------------------------------------------------


@dataclass
class UploadCapture:
    """Per-scenario capture of driving-port outputs.

    Holds only the use-case return value, the controller (envelope,
    status) tuple, persisted outbox record state, and raised exceptions.
    Never holds internal state of the dispatcher under refactor; that
    class is observable only through the public function it serves
    (Mandate 1).
    """

    container: Any = None
    use_case_result: Any = None
    controller_envelope: Any = None
    controller_status: int | None = None
    raised_error: BaseException | None = None
    upload_id: str | None = None
    secondary_upload_id: str | None = None
    plugin_registry: Any = None
    s3_stubber: Any = None
    sample_csv: bytes | None = None
    raw_content: bytes | None = None
    project_id: str | None = None
    recording_plugin_named: Any = None
    recording_plugin_ext: Any = None
    dispatcher_canonical_lengths: dict[str, int] = field(default_factory=dict)
    extras: dict[str, Any] = field(default_factory=dict)


@pytest_asyncio.fixture
async def capture(repository_container) -> UploadCapture:
    """Per-scenario capture; pins to the session loop the engine fixture uses.

    pytest-bdd does not auto-await async step bodies, so step functions
    stay sync and drive async work through
    ``capture.extras["_loop"].run_until_complete(...)``. Depending on
    ``repository_container`` (an async fixture bound to the session
    aiosqlite engine) forces pytest-asyncio to evaluate this fixture on
    the same session loop the engine was created on — using a different
    loop in the step would raise "Future attached to a different loop"
    on the next aiosqlite touch.
    """
    cap = UploadCapture()
    cap.container = repository_container
    cap.extras["_loop"] = asyncio.get_running_loop()
    return cap


# ---------------------------------------------------------------------------
# Background — shared across all milestones
# ---------------------------------------------------------------------------


@given("a fresh SQLite-backed repository container")
def given_fresh_container(capture: UploadCapture) -> None:
    """Bind the session-scoped container fixture into capture.container.

    The container fixture has already populated ``capture.container``
    via the autoload in the ``capture`` fixture itself. This step's
    presence in the Background just asserts that the container is bound
    so subsequent steps can rely on it.
    """
    assert capture.container is not None


@given("a stubbed object-store client wired into the lake repository")
def given_stubbed_object_store(capture: UploadCapture) -> None:
    """Construct a fresh boto3 S3 ``Stubber`` and stash it on capture.

    The lake-repository override passed to ``create_dataset_from_upload``
    in the @when step uses ``partial(MinIOLakeRepository,
    s3_client=stubber.client)`` — same shape as the existing 15 tests at
    backend/tests/use_cases/dataset/test_create_dataset_from_upload.py.
    """
    capture.s3_stubber = Stubber(boto3.client("s3"))


# ---------------------------------------------------------------------------
# Project + outbox seed steps
# ---------------------------------------------------------------------------


@given(parsers.parse('a project "{project_name}" exists in the database'))
def given_project_exists(capture: UploadCapture, project_name: str) -> None:
    from app.repositories.metadata import ProjectRecord
    from tests.uuidv7_fixtures import ORG_1, PROJECT_1

    loop: asyncio.AbstractEventLoop = capture.extras["_loop"]
    db_session = capture.container._session

    async def _seed() -> None:
        db_session.add(ProjectRecord(id=PROJECT_1, name=project_name, org_id=ORG_1))
        await db_session.commit()

    loop.run_until_complete(_seed())
    capture.project_id = PROJECT_1


@given(parsers.parse('an upload event is recorded for "{filename}" against that project'))
def given_upload_event(capture: UploadCapture, filename: str) -> None:
    from app.repositories.outbox import OutboxRecord
    from app.repositories.outbox.events import UploadFileReceived

    loop: asyncio.AbstractEventLoop = capture.extras["_loop"]
    db_session = capture.container._session

    capture.sample_csv = b"name,age,active\nAlice,30,true\nBob,25,false\nCharlie,35,true"
    upload_id = "upload-ws-001"
    raw_storage_path = f"uploads/{capture.project_id}/{filename}"

    async def _seed() -> None:
        db_session.add(
            OutboxRecord(
                id=upload_id,
                aggregate_id=capture.project_id,
                aggregate_type="project",
                event_type="UploadFileReceived",
                payload=asdict(
                    UploadFileReceived(
                        project_id=capture.project_id,
                        dataset_id=None,
                        raw_storage_path=raw_storage_path,
                        original_filename=filename,
                        file_size=len(capture.sample_csv),
                    )
                ),
            )
        )
        await db_session.commit()

    loop.run_until_complete(_seed())
    capture.upload_id = upload_id
    capture.extras["raw_storage_path"] = raw_storage_path


@given(
    parsers.parse(
        'an upload event is recorded for "{filename}" against that project with plugin name "{plugin_name}"'
    )
)
def given_upload_event_with_plugin(capture: UploadCapture, filename: str, plugin_name: str) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 01.")


@given(parsers.parse('an upload event is recorded for "{filename}" against that project with no plugin name'))
def given_upload_event_no_plugin(capture: UploadCapture, filename: str) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 01.")


@given("the dataset controller is bound to the use cases")
def given_controller_bound(capture: UploadCapture) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 03.")


# ---------------------------------------------------------------------------
# Object-store priming steps
# ---------------------------------------------------------------------------


@given("the stubbed object store will return a 3-row CSV when the raw upload is read")
def given_stub_returns_csv(capture: UploadCapture) -> None:
    capture.s3_stubber.add_response(
        "get_object",
        {"Body": io.BytesIO(capture.sample_csv)},
        {
            "Bucket": "dashboard-chat.datalake",
            "Key": capture.extras["raw_storage_path"],
        },
    )
    # One put_object per partition value (age: 25, 30, 35).
    for _ in range(3):
        capture.s3_stubber.add_response("put_object", {})


@given("the stubbed object store will return raw upload bytes when the file is read")
def given_stub_returns_raw_bytes(capture: UploadCapture) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 01.")


@given("the stubbed object store will return non-CSV binary bytes when the raw upload is read")
def given_stub_returns_garbage(capture: UploadCapture) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 03.")


@given(
    "the stubbed object store will return raw upload bytes for the read but raise on the second parquet write"
)
def given_stub_second_write_fails(capture: UploadCapture) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 03.")


# ---------------------------------------------------------------------------
# Plugin-registry steps
# ---------------------------------------------------------------------------


@given(parsers.parse('the plugin registry contains a mock single-result plugin named "{name}"'))
def given_registry_single(capture: UploadCapture, name: str) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 01.")


@given(parsers.parse('the plugin registry contains a recording mock single-result plugin named "{name}"'))
def given_registry_recording_single(capture: UploadCapture, name: str) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 01.")


@given('the plugin registry also contains a different plugin claiming the ".unknown" extension')
def given_registry_extra_unknown_plugin(capture: UploadCapture) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 01.")


@given(
    parsers.parse(
        'the plugin registry contains a mock multi-result plugin named "{name}" producing two datasets'
    )
)
def given_registry_multi(capture: UploadCapture, name: str) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 01.")


@given("no plugin registry is provided to the use case")
def given_no_registry(capture: UploadCapture) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 01.")


# ---------------------------------------------------------------------------
# Dispatcher canonicalization staging steps (milestone-2 boundary scenario)
# ---------------------------------------------------------------------------


@given("the dispatcher will canonicalize the pipeline result with exactly one entry for one upload")
def given_canonical_single(capture: UploadCapture) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 02.")


@given("the dispatcher will canonicalize the pipeline result with exactly two entries for another upload")
def given_canonical_multi(capture: UploadCapture) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 02.")


# ---------------------------------------------------------------------------
# When — drive through the use case (milestones 1 + 2) or the controller (milestone 3)
# ---------------------------------------------------------------------------


@when("the engineer runs the upload-to-dataset use case for that upload")
def when_run_use_case(capture: UploadCapture) -> None:
    from app.repositories.lake import MinIOLakeRepository
    from app.use_cases.dataset import create_dataset_from_upload

    loop: asyncio.AbstractEventLoop = capture.extras["_loop"]

    async def _invoke():
        with capture.s3_stubber:
            return await create_dataset_from_upload(
                upload_id=capture.upload_id,
                partition_fields=["age"],
                plugin_registry=capture.plugin_registry,
                repositories={
                    "lake_repository": partial(MinIOLakeRepository, s3_client=capture.s3_stubber.client),
                },
            )

    capture.use_case_result = loop.run_until_complete(_invoke())


@when("the engineer runs the upload-to-dataset use case for both uploads")
def when_run_use_case_twice(capture: UploadCapture) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 02.")


@when("the engineer posts the dataset through the controller for that upload")
def when_post_through_controller(capture: UploadCapture) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 03.")


# ---------------------------------------------------------------------------
# Then — observable outcomes (return values from driving port; persisted state)
# ---------------------------------------------------------------------------


@then("the use case returns a single dataset")
def then_returns_single_dataset(capture: UploadCapture) -> None:
    from app.models.dataset import Dataset

    assert isinstance(capture.use_case_result, Success), (
        f"Expected Success, got {capture.use_case_result!r}"
    )
    payload = capture.use_case_result.unwrap()
    assert isinstance(payload, Dataset), f"Expected single Dataset, got {type(payload).__name__}"


@then("the use case returns a list of datasets")
def then_returns_list_of_datasets(capture: UploadCapture) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 01.")


@then(parsers.parse("the returned dataset's row count is {expected_rows:d}"))
def then_returned_row_count(capture: UploadCapture, expected_rows: int) -> None:
    assert capture.use_case_result.unwrap().row_count == expected_rows


@then("the returned dataset's column names are name, age, active")
def then_returned_columns(capture: UploadCapture) -> None:
    fields = capture.use_case_result.unwrap().schema_config["fields"]
    assert set(fields.keys()) == {"name", "age", "active"}


@then(parsers.parse("the returned dataset's name is \"{expected_name}\""))
def then_returned_name(capture: UploadCapture, expected_name: str) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 01.")


@then(parsers.parse("the returned dataset's name defaults to \"{expected_name}\""))
def then_returned_name_default(capture: UploadCapture, expected_name: str) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 01.")


@then(parsers.parse("the list of returned datasets has length {expected_len:d}"))
def then_list_length(capture: UploadCapture, expected_len: int) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 01.")


@then(parsers.parse('the returned dataset names are "{first}" and "{second}" in that order'))
def then_returned_names_in_order(capture: UploadCapture, first: str, second: str) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 01.")


@then("the dispatcher was used to produce the pipeline result")
def then_dispatcher_used(capture: UploadCapture) -> None:
    """Import-graph proof: the dispatcher module is reachable AND the use
    case no longer imports the plugin-dispatch concerns directly.

    This is the ONE step that imports outside the driving port — it is
    the dispatcher's existence assertion plus the architectural fence
    (DWD-7) at the suite level so the WS goes red if a future refactor
    re-inlines plugin-dispatch into the use case.
    """
    import inspect

    from app.use_cases.dataset import create_dataset_from_upload as ucase_module_proxy
    from app.use_cases.dataset._pipeline.plugin_dispatch import UploadPluginDispatcher

    assert UploadPluginDispatcher is not None

    use_case_source = inspect.getsource(ucase_module_proxy)
    assert "PluginRegistry" not in use_case_source.split("def create_dataset_from_upload", 1)[1], (
        "Use case body must not reference PluginRegistry — that concern lives in the dispatcher."
    )
    assert "csv_parser" not in use_case_source, (
        "Use case must not import csv_parser — the CSV fallback lives in the dispatcher."
    )


@then("the pipeline result was canonicalized as a multi-result with exactly one entry")
def then_canonical_one_entry(capture: UploadCapture) -> None:
    """Indirect proof: when the use case returns a single Dataset (not a
    list), the dispatcher's canonical-result length was exactly 1 — the
    use case unwraps a len-1 result list back to a single Dataset before
    returning. Coupling the assertion to a recording wrapper is deferred
    to Phase 01 (DWD-1 in DESIGN: dispatcher unit tests + acceptance
    layer pin the canonicalization shape directly there).
    """
    from app.models.dataset import Dataset

    payload = capture.use_case_result.unwrap()
    assert isinstance(payload, Dataset), (
        f"Single-entry canonical → use case must return a single Dataset, got {type(payload).__name__}"
    )


@then(parsers.parse("the dispatcher canonical result contained exactly {expected_count:d} entries"))
def then_canonical_n_entries(capture: UploadCapture, expected_count: int) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 01.")


@then(parsers.parse("the dispatcher canonical result contained exactly {expected_count:d} entry"))
def then_canonical_one_entry_singular(capture: UploadCapture, expected_count: int) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 01.")


@then(parsers.parse('the recording plugin named "{plugin_name}" was invoked'))
def then_recording_plugin_invoked(capture: UploadCapture, plugin_name: str) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 01.")


@then(parsers.parse('the plugin claiming the "{ext}" extension was not invoked'))
def then_extension_plugin_not_invoked(capture: UploadCapture, ext: str) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 01.")


# ---------------------------------------------------------------------------
# Outbox-payload observation (Milestone 2 — THE asymmetry preservation)
# ---------------------------------------------------------------------------


@then(parsers.parse('the outbox payload for that upload does not contain a "{key}" key'))
def then_outbox_payload_lacks_key(capture: UploadCapture, key: str) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 02.")


@then(parsers.parse('the outbox payload for the one-entry upload does not contain a "{key}" key'))
def then_outbox_one_entry_lacks_key(capture: UploadCapture, key: str) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 02.")


@then(parsers.parse('the outbox payload for the two-entry upload contains a "{key}" key'))
def then_outbox_two_entry_has_key(capture: UploadCapture, key: str) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 02.")


@then(parsers.parse('the outbox payload for that upload contains a "dataset_ids" list of length {expected_len:d}'))
def then_outbox_dataset_ids_length(capture: UploadCapture, expected_len: int) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 02.")


@then('the outbox payload\'s "dataset_id" matches the first returned dataset\'s id')
def then_outbox_dataset_id_matches_first(capture: UploadCapture) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 02.")


# ---------------------------------------------------------------------------
# Controller observations (milestone 3)
# ---------------------------------------------------------------------------


@then(parsers.parse("the controller returns status code {expected_status:d}"))
def then_controller_status(capture: UploadCapture, expected_status: int) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 03.")


@then(parsers.parse('the controller envelope\'s "data" entry has type "{expected_type}"'))
def then_envelope_data_type(capture: UploadCapture, expected_type: str) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 03.")


@then("the controller envelope's self-link references the returned dataset id")
def then_envelope_self_link(capture: UploadCapture) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 03.")


@then("the controller returns the same observable result as before the refactor for the multi-upload path")
def then_controller_multi_unchanged(capture: UploadCapture) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 03.")


@then("the controller returns a non-success status code")
def then_controller_non_success(capture: UploadCapture) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 03.")


@then("the controller envelope describes a domain failure for the upload pipeline")
def then_controller_domain_failure(capture: UploadCapture) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 03.")


@then("the controller envelope describes a storage-substrate failure on the second dataset write")
def then_controller_storage_failure(capture: UploadCapture) -> None:
    pytest.fail("DISTILL scaffold — DELIVER unpends in Phase 03.")
