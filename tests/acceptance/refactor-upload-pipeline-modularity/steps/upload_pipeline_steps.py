# <!-- DES-ENFORCEMENT : exempt -->
"""Step glue for the refactor-upload-pipeline-modularity acceptance suite.

DISTILL scaffold — every step body raises ``pytest.fail("DISTILL scaffold —
DELIVER implements: <intent>")`` per DWD-9 in distill/wave-decisions.md.
DELIVER replaces each body with a real implementation that drives
``create_dataset_from_upload`` (or ``DatasetController.post_dataset`` for
milestone-3) — never a directly-imported ``UploadPluginDispatcher``
instance — and asserts on the return value or the persisted outbox
record (observable outcomes; Mandate 1 + Dim 7).

Driving-port discipline (Mandate 1):
    @when bindings invoke ``create_dataset_from_upload(...)`` (use-case
    function, the public driving port for milestones 1 and 2) or
    ``DatasetController.post_dataset(...)`` (the HTTP-side driving
    adapter for milestone 3). The new ``UploadPluginDispatcher`` class
    is NEVER imported in this module — it is a use-case-internal
    coordinator (DWD-8 in DESIGN's wave-decisions.md) and is only
    observable through the public function it serves.

Iron Rule (per CLAUDE.md): the existing 15 tests at
backend/tests/use_cases/dataset/test_create_dataset_from_upload.py stay
green byte-for-byte. The asymmetry-preservation scenarios in
milestone-2 are the new characterization layer (DWD-2 in DESIGN's
wave-decisions.md). DELIVER MUST NOT modify any of the 15 existing
tests to make these acceptance scenarios pass.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest
from pytest_bdd import given, parsers, then, when

# Mandate 7 marker — every step body in this module is a DISTILL scaffold.
# DELIVER must replace `pytest.fail(...)` calls with real implementations
# AND remove this marker (or set it to False) once every scenario in
# every milestone is green.
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


@pytest.fixture
def capture() -> UploadCapture:
    return UploadCapture()


# ---------------------------------------------------------------------------
# Background — shared across all milestones
# ---------------------------------------------------------------------------


@given("a fresh SQLite-backed repository container")
def given_fresh_container(capture: UploadCapture, repository_container) -> None:
    """Bind the session-scoped container fixture into the capture object.

    DISTILL scaffold: until DELIVER lands Phase 00 (UploadPluginDispatcher
    + canonicalization in place), the container fixture itself is a
    pytest.skip placeholder; this step routes through it so every
    scenario errors with a clean "DELIVER implements" signal rather than
    a fixture-bind crash.
    """
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: bind the SQLite-backed "
        "RepositoryContainer fixture into capture.container so "
        "subsequent @when steps invoke create_dataset_from_upload "
        "through capture.container's wiring (mirroring the production "
        "with_repositories decorator)."
    )


@given("a stubbed object-store client wired into the lake repository")
def given_stubbed_object_store(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: construct a "
        "botocore.stub.Stubber wrapping a fresh boto3 s3 client and "
        "stash it in capture.s3_stubber. The lake_repository override "
        "passed to create_dataset_from_upload uses "
        "partial(MinIOLakeRepository, s3_client=capture.s3_stubber.client) "
        "— same shape as the existing 15 tests at "
        "backend/tests/use_cases/dataset/test_create_dataset_from_upload.py."
    )


@given("the dataset controller is bound to the use cases")
def given_controller_bound(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: bind "
        "app.controllers.dataset_controller.DatasetController and the "
        "module-level dataset_use_cases / upload_use_cases aliases that "
        "DatasetController.post_dataset reads at call time. Stash the "
        "bound controller class in capture.extras['controller'] so the "
        "@when step can invoke `await DatasetController.post_dataset(...)`."
    )


# ---------------------------------------------------------------------------
# Project + outbox seed steps — shared across milestones
# ---------------------------------------------------------------------------


@given(parsers.parse('a project "{project_name}" exists in the database'))
def given_project_exists(capture: UploadCapture, project_name: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: insert a ProjectRecord "
        "with the given name into the test database, store its id in "
        "capture.project_id (use the PROJECT_1 uuidv7 fixture from "
        "tests/uuidv7_fixtures the same way the existing test "
        "create_dataset_from_upload tests do)."
    )


@given(parsers.parse('an upload event is recorded for "{filename}" against that project'))
def given_upload_event(capture: UploadCapture, filename: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: insert an OutboxRecord "
        "with event_type='UploadFileReceived' and a payload built from "
        "asdict(UploadFileReceived(project_id=capture.project_id, "
        "raw_storage_path=f'uploads/{capture.project_id}/{filename}', "
        "original_filename=filename, file_size=...)). Store the upload "
        "id (e.g. 'upload-ws-001') in capture.upload_id."
    )


@given(
    parsers.parse(
        'an upload event is recorded for "{filename}" against that project with plugin name "{plugin_name}"'
    )
)
def given_upload_event_with_plugin(capture: UploadCapture, filename: str, plugin_name: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: insert an OutboxRecord "
        "as in given_upload_event but include plugin_name=plugin_name in "
        "the UploadFileReceived payload — the dispatcher's "
        "get_by_name(plugin_name) precedence MUST be exercised by this "
        "scenario."
    )


@given(parsers.parse('an upload event is recorded for "{filename}" against that project with no plugin name'))
def given_upload_event_no_plugin(capture: UploadCapture, filename: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: insert an OutboxRecord "
        "as in given_upload_event with plugin_name explicitly set to "
        "None in the UploadFileReceived payload — the dispatcher's "
        "no-registry CSV-fallback path MUST be exercised by this "
        "scenario."
    )


# ---------------------------------------------------------------------------
# Object-store priming steps
# ---------------------------------------------------------------------------


@given("the stubbed object store will return a 3-row CSV when the raw upload is read")
def given_stub_returns_csv(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: prime capture.s3_stubber "
        "with add_response('get_object', {'Body': io.BytesIO(SAMPLE_CSV)}, "
        "{'Bucket': 'dashboard-chat.datalake', 'Key': "
        "f'uploads/{capture.project_id}/test_data.csv'}) where SAMPLE_CSV "
        "is the 3-row CSV from "
        "backend/tests/use_cases/dataset/test_create_dataset_from_upload.py "
        "(b'name,age,active\\nAlice,30,true\\nBob,25,false\\nCharlie,35,"
        "true'); also prime three put_object responses for the partition "
        "writes."
    )


@given("the stubbed object store will return raw upload bytes when the file is read")
def given_stub_returns_raw_bytes(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: prime capture.s3_stubber "
        "with one get_object returning io.BytesIO(b'raw bytes') and the "
        "appropriate number of put_object responses for the parquet "
        "writes (1 per ProcessingResult, 0 partition_fields = 1 "
        "put_object each)."
    )


@given("the stubbed object store will return non-CSV binary bytes when the raw upload is read")
def given_stub_returns_garbage(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: prime capture.s3_stubber "
        "with one get_object returning io.BytesIO(b'\\x89PNG\\r\\n\\x1a"
        "\\n\\x00\\x00\\x00\\rIHDR') — the same PNG-magic-bytes payload "
        "the existing test_create_dataset_when_csv_is_invalid_returns_"
        "failure scenario uses."
    )


@given(
    "the stubbed object store will return raw upload bytes for the read but raise on the second parquet write"
)
def given_stub_second_write_fails(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: prime capture.s3_stubber "
        "with get_object returning io.BytesIO(b'raw multi fail file'), "
        "then ONE successful put_object response (first parquet write), "
        "then add_client_error('put_object', service_error_code="
        "'InternalError', service_message='Simulated S3 failure') for "
        "the second parquet write — same shape as the existing "
        "test_multi_dataset_partial_failure_returns_failure test."
    )


# ---------------------------------------------------------------------------
# Plugin-registry steps
# ---------------------------------------------------------------------------


@given(parsers.parse('the plugin registry contains a mock single-result plugin named "{name}"'))
def given_registry_single(capture: UploadCapture, name: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: build a "
        "PluginRegistry([MockSinglePlugin()]) where MockSinglePlugin "
        "matches the existing fixture in "
        "backend/tests/use_cases/dataset/test_create_dataset_from_upload.py "
        "(returns ProcessingResult(df=..., name='Plugin Dataset')). "
        "Stash it in capture.plugin_registry."
    )


@given(parsers.parse('the plugin registry contains a recording mock single-result plugin named "{name}"'))
def given_registry_recording_single(capture: UploadCapture, name: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: build a recording "
        "_RecordingMockSinglePlugin (mirroring the "
        "TestCreateDatasetFromUploadCharacterization helper) that flips "
        "process_called=True when invoked. Stash the instance in "
        "capture.recording_plugin_named so the precedence "
        "@then step can assert process_called is True."
    )


@given('the plugin registry also contains a different plugin claiming the ".unknown" extension')
def given_registry_extra_unknown_plugin(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: build a second plugin "
        "with extensions=['.unknown'] and a process_called recorder; "
        "include it in capture.plugin_registry alongside the named "
        "plugin. Stash the instance in capture.recording_plugin_ext so "
        "the precedence @then step can assert process_called is False."
    )


@given(
    parsers.parse(
        'the plugin registry contains a mock multi-result plugin named "{name}" producing two datasets'
    )
)
def given_registry_multi(capture: UploadCapture, name: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: build a "
        "PluginRegistry([MockMultiPlugin()]) where MockMultiPlugin "
        "matches the existing fixture (returns "
        "MultiProcessingResult(results=[ProcessingResult(df=..., "
        "name='Type A'), ProcessingResult(df=..., name='Type B')])). "
        "Stash it in capture.plugin_registry."
    )


@given(parsers.parse(
    'the plugin registry contains a mock multi-result plugin named "{name}" '
    'producing two datasets'
))
def given_registry_multi_partial_fail(capture: UploadCapture, name: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: when name == "
        "'mock_multi_fail', build a PluginRegistry([MockMultiPluginSecondFails()]) "
        "from the existing fixture — second result is named 'Bad Type' "
        "and triggers the second-write S3 failure. Stash in "
        "capture.plugin_registry."
    )


@given("no plugin registry is provided to the use case")
def given_no_registry(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: set "
        "capture.plugin_registry = None — the use case is invoked "
        "without the plugin_registry kwarg, exercising the dispatcher's "
        "no-registry CSV-fallback path."
    )


# ---------------------------------------------------------------------------
# Dispatcher canonicalization staging steps (milestone-2 boundary scenario)
# ---------------------------------------------------------------------------


@given("the dispatcher will canonicalize the pipeline result with exactly one entry for one upload")
def given_canonical_single(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: seed an OutboxRecord "
        "for a single-file upload (no plugin_name, CSV-fallback path) "
        "and stash its id in capture.upload_id. The dispatcher will "
        "wrap the single ProcessingResult as MultiProcessingResult with "
        "len(results) == 1, exercising the `len > 1` guard's FALSE arm."
    )


@given("the dispatcher will canonicalize the pipeline result with exactly two entries for another upload")
def given_canonical_multi(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: seed an OutboxRecord "
        "for a multi-file upload (plugin_name='mock_multi') and stash "
        "its id in capture.secondary_upload_id. Build the "
        "PluginRegistry([MockMultiPlugin()]). The dispatcher will "
        "return MultiProcessingResult with len(results) == 2, "
        "exercising the `len > 1` guard's TRUE arm."
    )


# ---------------------------------------------------------------------------
# When — drive through the use case (milestones 1 + 2) or the controller (milestone 3)
# ---------------------------------------------------------------------------


@when("the engineer runs the upload-to-dataset use case for that upload")
def when_run_use_case(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: with capture.s3_stubber: "
        "result = await create_dataset_from_upload("
        "upload_id=capture.upload_id, partition_fields=[...], "
        "plugin_registry=capture.plugin_registry, repositories={...}). "
        "Stash the Result in capture.use_case_result. The kwargs and "
        "repositories override match the existing 15 tests' shape."
    )


@when("the engineer runs the upload-to-dataset use case for both uploads")
def when_run_use_case_twice(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: invoke "
        "create_dataset_from_upload twice — first for "
        "capture.upload_id (single), then for "
        "capture.secondary_upload_id (multi). Stash both Results in "
        "capture.extras['result_single'] and "
        "capture.extras['result_multi']. Use one s3 stubber primed for "
        "both reads + writes (or two stubbers if the surface is too "
        "noisy)."
    )


@when("the engineer posts the dataset through the controller for that upload")
def when_post_through_controller(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: with capture.s3_stubber: "
        "envelope, status = await capture.extras['controller']."
        "post_dataset(upload_id=capture.upload_id, partition_fields="
        "[...], plugin_registry=capture.plugin_registry). Stash "
        "(envelope, status) in capture.controller_envelope, "
        "capture.controller_status. If the controller raises (pre-existing "
        "multi-upload TypeError per ADR-022 follow-up #3), capture the "
        "exception in capture.raised_error instead — the multi-upload "
        "scenario asserts on the unchanged raise behaviour."
    )


# ---------------------------------------------------------------------------
# Then — observable outcomes (return values from driving port; persisted state)
# ---------------------------------------------------------------------------


@then("the use case returns a single dataset")
def then_returns_single_dataset(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "isinstance(capture.use_case_result, Success) and "
        "isinstance(capture.use_case_result.unwrap(), Dataset). The "
        "single-dataset external return shape (NOT a list) is the "
        "core invariant of DWD-5 in DESIGN's wave-decisions.md."
    )


@then("the use case returns a list of datasets")
def then_returns_list_of_datasets(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "isinstance(capture.use_case_result, Success) and "
        "isinstance(capture.use_case_result.unwrap(), list) and "
        "all(isinstance(d, Dataset) for d in "
        "capture.use_case_result.unwrap())."
    )


@then(parsers.parse("the returned dataset's row count is {expected_rows:d}"))
def then_returned_row_count(capture: UploadCapture, expected_rows: int) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: assert "
        f"capture.use_case_result.unwrap().row_count == {expected_rows}."
    )


@then("the returned dataset's column names are name, age, active")
def then_returned_columns(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "set(capture.use_case_result.unwrap().schema_config['fields']."
        "keys()) == {'name', 'age', 'active'}."
    )


@then(parsers.parse("the returned dataset's name is \"{expected_name}\""))
def then_returned_name(capture: UploadCapture, expected_name: str) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: assert "
        f"capture.use_case_result.unwrap().name == '{expected_name}'."
    )


@then(parsers.parse("the returned dataset's name defaults to \"{expected_name}\""))
def then_returned_name_default(capture: UploadCapture, expected_name: str) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: assert "
        f"capture.use_case_result.unwrap().name == '{expected_name}' "
        f"(create_dataset_record's `name or 'New Dataset'` default for "
        f"a CSV-fallback ProcessingResult with name=None)."
    )


@then(parsers.parse("the list of returned datasets has length {expected_len:d}"))
def then_list_length(capture: UploadCapture, expected_len: int) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: assert "
        f"len(capture.use_case_result.unwrap()) == {expected_len}."
    )


@then(parsers.parse('the returned dataset names are "{first}" and "{second}" in that order'))
def then_returned_names_in_order(capture: UploadCapture, first: str, second: str) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: assert "
        f"[d.name for d in capture.use_case_result.unwrap()] == "
        f"['{first}', '{second}']."
    )


@then("the dispatcher was used to produce the pipeline result")
def then_dispatcher_used(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: import the dispatcher "
        "module ONLY for the import-graph proof — assert that "
        "app.use_cases.dataset._pipeline.plugin_dispatch."
        "UploadPluginDispatcher exists and is importable, AND that the "
        "use case body's source no longer mentions PluginRegistry/"
        "FileFormatPlugin/csv_parser (the architectural-enforcement rule "
        "from DWD-7 is the production-side proof; this acceptance "
        "scenario echoes it at the suite level so the WS goes red if "
        "the dispatcher is removed). NOTE: this is the ONE step in "
        "this module that imports outside the driving port — it is the "
        "import-graph assertion, not a use-case invocation."
    )


@then("the pipeline result was canonicalized as a multi-result with exactly one entry")
def then_canonical_one_entry(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: stash the dispatcher's "
        "canonical-result length in capture.dispatcher_canonical_lengths"
        "[capture.upload_id] from a recording wrapper around "
        "UploadPluginDispatcher.dispatch (introduced in DELIVER Phase 00 "
        "as a test-only spy decorator), then assert "
        "capture.dispatcher_canonical_lengths[capture.upload_id] == 1. "
        "If recording the call would couple this scenario to "
        "implementation, prefer the indirect proof: assert that the "
        "use case returned a single Dataset (NOT a list) — implied by "
        "len(results) == 1 from the dispatcher."
    )


@then(parsers.parse("the dispatcher canonical result contained exactly {expected_count:d} entries"))
def then_canonical_n_entries(capture: UploadCapture, expected_count: int) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: assert "
        f"capture.dispatcher_canonical_lengths[capture.upload_id] == "
        f"{expected_count}. Same recording-wrapper pattern as "
        f"then_canonical_one_entry."
    )


@then(parsers.parse("the dispatcher canonical result contained exactly {expected_count:d} entry"))
def then_canonical_one_entry_singular(capture: UploadCapture, expected_count: int) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: same as "
        f"then_canonical_n_entries but for the singular-grammar path; "
        f"expected_count is {expected_count}."
    )


@then(parsers.parse('the recording plugin named "{plugin_name}" was invoked'))
def then_recording_plugin_invoked(capture: UploadCapture, plugin_name: str) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: assert "
        f"capture.recording_plugin_named.process_called is True (the "
        f"named plugin '{plugin_name}' was selected by "
        f"get_by_name(plugin_name) precedence)."
    )


@then(parsers.parse('the plugin claiming the "{ext}" extension was not invoked'))
def then_extension_plugin_not_invoked(capture: UploadCapture, ext: str) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: assert "
        f"capture.recording_plugin_ext.process_called is False (the "
        f"'{ext}'-extension plugin was NOT invoked because plugin_name "
        f"on the event takes precedence over filename extension "
        f"matching)."
    )


# ---------------------------------------------------------------------------
# Outbox-payload observation (Milestone 2 — THE asymmetry preservation)
# ---------------------------------------------------------------------------


@then(parsers.parse('the outbox payload for that upload does not contain a "{key}" key'))
def then_outbox_payload_lacks_key(capture: UploadCapture, key: str) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: re-read the OutboxRecord "
        f"from the test session (db_session.expire_all() then "
        f"db_session.get(OutboxRecord, capture.upload_id)); assert "
        f"'{key}' not in record.payload. THIS IS THE CRITICAL "
        f"ASYMMETRY-PRESERVATION ASSERTION — DWD-2 binding effect on "
        f"DISTILL."
    )


@then(parsers.parse('the outbox payload for the one-entry upload does not contain a "{key}" key'))
def then_outbox_one_entry_lacks_key(capture: UploadCapture, key: str) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: same as "
        f"then_outbox_payload_lacks_key but reads the OutboxRecord at "
        f"capture.upload_id (the SINGLE-result upload). Asserts "
        f"'{key}' not in record.payload — the explicit `if "
        f"len(results) > 1` guard's FALSE arm is observable here."
    )


@then(parsers.parse('the outbox payload for the two-entry upload contains a "{key}" key'))
def then_outbox_two_entry_has_key(capture: UploadCapture, key: str) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: re-read the OutboxRecord "
        f"at capture.secondary_upload_id (the MULTI-result upload); "
        f"assert '{key}' in record.payload — the `if len(results) > 1` "
        f"guard's TRUE arm is observable here."
    )


@then(parsers.parse('the outbox payload for that upload contains a "dataset_ids" list of length {expected_len:d}'))
def then_outbox_dataset_ids_length(capture: UploadCapture, expected_len: int) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: re-read OutboxRecord "
        f"at capture.upload_id; assert isinstance(record.payload["
        f"'dataset_ids'], list) and len(record.payload['dataset_ids']) "
        f"== {expected_len}. Mirrors the existing "
        f"test_multi_dataset_persists_dataset_ids_and_first_id_in_outbox_payload "
        f"characterization at the acceptance level."
    )


@then('the outbox payload\'s "dataset_id" matches the first returned dataset\'s id')
def then_outbox_dataset_id_matches_first(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: re-read OutboxRecord at "
        "capture.upload_id; datasets = capture.use_case_result.unwrap(); "
        "assert record.payload['dataset_id'] == datasets[0].id."
    )


# ---------------------------------------------------------------------------
# Controller observations (milestone 3)
# ---------------------------------------------------------------------------


@then(parsers.parse("the controller returns status code {expected_status:d}"))
def then_controller_status(capture: UploadCapture, expected_status: int) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: assert "
        f"capture.controller_status == {expected_status}."
    )


@then(parsers.parse('the controller envelope\'s "data" entry has type "{expected_type}"'))
def then_envelope_data_type(capture: UploadCapture, expected_type: str) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: assert "
        f"capture.controller_envelope['data']['type'] == "
        f"'{expected_type}'."
    )


@then("the controller envelope's self-link references the returned dataset id")
def then_envelope_self_link(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the envelope's "
        "self-link contains the dataset id; the exact JSON:API shape "
        "is wrap_jsonapi_single('datasets', serialize(data), "
        "f'/api/datasets/{serialized[\"id\"]}'). Read the dataset's id "
        "from the response itself (capture.controller_envelope['data']"
        "['id']) — DO NOT assert against the use case's return value, "
        "the controller's envelope is the driving-port observation."
    )


@then("the controller returns the same observable result as before the refactor for the multi-upload path")
def then_controller_multi_unchanged(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: pin the CURRENT "
        "controller behaviour for a multi-upload — today, "
        "post_dataset's serialize(data)['id'] raises TypeError because "
        "data is a list[Dataset], not a Dataset (latent bug; ADR-022 "
        "follow-up #3). Assert the SAME observable: capture.raised_error "
        "is a TypeError whose message references __getitem__ on a list. "
        "If the production code's behaviour for multi-upload changes "
        "from raising-at-controller-boundary to anything else, that is "
        "a behaviour change OUT OF SCOPE for this refactor — surface "
        "it here as a test failure that points DELIVER back to ADR-022 "
        "follow-up #3."
    )


@then("the controller returns a non-success status code")
def then_controller_non_success(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.controller_status >= 400 (any client/server error "
        "status; the exact code is determined by error_response from "
        "_result_mapper.py — pin whichever code today's behaviour "
        "produces for the failure class in question)."
    )


@then("the controller envelope describes a domain failure for the upload pipeline")
def then_controller_domain_failure(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.controller_envelope contains an 'errors' or 'error' "
        "key (per the JSON:API error shape error_response builds) and "
        "the message text identifies the upload pipeline as the "
        "failing surface. Pin the EXACT shape today's code produces — "
        "this is a characterization assertion, not a wishful one."
    )


@then("the controller envelope describes a storage-substrate failure on the second dataset write")
def then_controller_storage_failure(capture: UploadCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.controller_envelope's error message references the S3 "
        "InternalError (or the 'Simulated S3 failure' substring) for "
        "the second-write failure. Mirrors the existing "
        "test_multi_dataset_partial_failure_returns_failure assertion "
        "at the controller boundary."
    )
