"""Step glue for dbt-test-validation acceptance suite (ADR-019, Option β).

Strategy C (real local I/O — DWD-1): step bindings invoke the
`DatasetLayerHarness` Python facade against the running 5-service compose
stack, real Groq, real `dbtRunner` from `dbt.cli.main`, real DuckDB, real
MinIO. No InMemory doubles for any local resource.

Driving-port discipline (skill Mandate 1 / F-005 analog):
    @when steps import only from `tests.acceptance.dbt-test-validation`
    fixtures and from the harness facade module
    (`backend.tests.integration.dataset_layer.harness`). Internal helpers —
    EjectAndTestOrchestrator, DuckDBProfileSeeder, RunResultsParser,
    PanderaValidator — are NEVER imported in @when steps. The
    `eject_orchestrator` session fixture is the composition root.

Today this file is a DISTILL scaffold. Every step body raises
NotImplementedError-via-pytest.fail with a clear "DELIVER will implement"
reason; the .feature files are tagged @pending so the default suite run
filters them out. The walking-skeleton scenario is enabled by default —
its bindings call into the (yet-unimplemented) `harness.eject_and_test`
extension method, which raises AssertionError on the scaffold path
(skill Mandate 7: tests are RED, not BROKEN).
"""
from __future__ import annotations

import asyncio
import contextlib
import os
import sys
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import httpx
import pytest
import pytest_asyncio
from pytest_bdd import given, parsers, then, when

# Make the backend test harness importable. Acceptance suite lives at the
# repo root; harness is at `backend/tests/integration/dataset_layer/harness.py`.
# Ruff would strip the imports without the # noqa markers — skill F-003.
_REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_REPO_ROOT))
sys.path.insert(0, str(_REPO_ROOT / "backend"))

# WS fixture: small orders dataset matching CsvPlugin's expected upload shape.
# Defined at module scope so the @given step can resolve it without a fresh
# Path() construction inside the body — ruff/F-003 friendly.
_ORDERS_FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "orders.csv"


# ---------------------------------------------------------------------------
# MinIO creds for fresh probing orchestrators (M3 scenarios)
# ---------------------------------------------------------------------------


def _read_minio_creds_from_env_for_steps() -> dict[str, str]:
    """Build the orchestrator's ``minio_creds`` dict from environment.

    Mirrors ``conftest.py:_read_minio_creds_from_env`` — duplicated rather
    than imported because conftest exposes that helper as a private module
    function, not a fixture, and re-exporting would couple step glue to
    conftest's internal API. The duplication is deliberate (M3 scenarios
    need a fresh probing orchestrator per scenario, after the @given
    monkeypatch lands; the session-scoped ``eject_orchestrator`` fixture
    probes once at session start against a healthy substrate).
    """
    return {
        "endpoint_url": os.environ.get("S3_ENDPOINT", "http://localhost:9000"),
        "access_key": os.environ.get("S3_ACCESS_KEY_ID", "minioadmin"),
        "secret_key": os.environ.get("S3_SECRET_ACCESS_KEY", "minioadmin"),
        "bucket": os.environ.get("S3_BUCKET", "dashboard-chat.datalake"),
        "region": os.environ.get("S3_REGION", "us-east-1"),
    }


# ---------------------------------------------------------------------------
# Capture object — observable state collected per scenario
# ---------------------------------------------------------------------------


@dataclass
class HarnessCapture:
    """Per-scenario observable state.

    Holds only outputs of driving-port calls (return values, raised
    exceptions, timing observations). NEVER stores internal state of
    components under test (Mandate 1 / Dim 7).
    """

    project_id: Optional[str] = None
    dataset_id: Optional[str] = None
    eject_report: Any = None
    validation_result: Any = None
    validation_elapsed_ms: Optional[float] = None
    chat_trace: Any = None
    chat_error: Optional[BaseException] = None
    seeder_error: Optional[BaseException] = None
    skip_reason: Optional[str] = None
    fetch_url: Optional[str] = None
    extras: dict[str, Any] = field(default_factory=dict)


@pytest_asyncio.fixture
async def capture(eject_orchestrator: Any) -> AsyncIterator[HarnessCapture]:
    """Per-scenario capture; pins to the session loop the orchestrator uses.

    pytest-bdd 8.x does not natively await async step functions, so step
    bodies stay synchronous and drive async work via
    ``loop.run_until_complete(...)`` on the loop captured here. We must
    use the SAME loop pytest-asyncio bound the session-scoped
    ``eject_orchestrator``'s ``httpx.AsyncClient`` to — re-using the
    orchestrator's client on a different loop raises "Future attached to a
    different loop" at runtime. Depending on ``eject_orchestrator`` here
    forces pytest-asyncio to give this fixture the same loop the
    orchestrator was set up on; ``asyncio.get_running_loop()`` returns
    that loop while the fixture is awaiting. The loop is then re-used
    synchronously by the @given/@when steps via
    ``loop.run_until_complete()``.

    The ``AsyncExitStack`` registers the harness for teardown so its
    ``__aexit__`` (project delete + httpx client close) fires at fixture
    finalize, not when the @given step returns.
    """
    loop = asyncio.get_running_loop()
    stack = contextlib.AsyncExitStack()
    cap = HarnessCapture()
    cap.extras["_loop"] = loop
    cap.extras["_stack"] = stack
    try:
        yield cap
    finally:
        # Close the harness via its registered async context. This runs on
        # the same session loop pytest-asyncio is driving the fixture on.
        await stack.aclose()


# ---------------------------------------------------------------------------
# Background steps
# ---------------------------------------------------------------------------


@given("the dataset-layer harness is ready against the running compose stack")
def given_harness_ready(requires_compose_stack: None) -> None:
    # The compose-stack fixture skips when the stack is unreachable;
    # reaching this line implies the harness can connect.
    pass


@given("the eject orchestrator has passed its earned-trust probes")
def given_orchestrator_probed(eject_orchestrator: Any) -> None:
    # The session-scoped fixture invokes probe() once and caches the
    # orchestrator. Probe failure -> pytest.skip with the failing probe
    # named (ADR-019 §4 invariant). Reaching here means probes passed.
    pass


# ---------------------------------------------------------------------------
# Walking-skeleton: chat-driven cleaning + eject + re-validate
# ---------------------------------------------------------------------------


@given("a fresh project with a small orders dataset uploaded")
def given_fresh_project(
    capture: HarnessCapture,
    requires_compose_stack: None,
    eject_orchestrator: Any,
) -> None:
    """Open a DatasetLayerHarness, create a project, upload the orders CSV.

    Wires the harness with the session-probed orchestrator (composition
    root invariant — ADR-019 §11) so subsequent ``@when`` eject steps can
    delegate through ``harness.eject_and_test``. The harness lifecycle
    spans the full scenario via the ``capture`` fixture's AsyncExitStack;
    project teardown fires at fixture finalize, not when this step returns.

    Step functions stay sync because pytest-bdd 8.x does not auto-await
    async step bodies; async work is driven through ``capture.extras["_loop"]``.
    """
    if not _ORDERS_FIXTURE.exists():
        pytest.fail(
            f"WS fixture missing at {_ORDERS_FIXTURE}; expected a small "
            f"orders CSV (matches CsvPlugin upload shape)"
        )

    # Local import: deferred so this module can load even when the backend
    # test deps aren't installed (the conftest fixtures gate that path
    # earlier with skip-when-unavailable).
    from tests.integration.dataset_layer.harness import (
        AuthApi,
        DatasetLayerHarness,
    )

    auth_proxy_url = os.environ.get("AUTH_PROXY_URL", "http://localhost:3000").rstrip("/")
    agent_url = os.environ.get("AGENT_URL", "http://localhost:8787").rstrip("/")

    loop: asyncio.AbstractEventLoop = capture.extras["_loop"]
    stack: contextlib.AsyncExitStack = capture.extras["_stack"]

    async def _setup() -> tuple[Any, str, str]:
        user_jwt = await AuthApi.fetch_dev_user_jwt(auth_proxy_url)
        harness = DatasetLayerHarness(
            auth_proxy_url=auth_proxy_url,
            agent_url=agent_url,
            user_jwt=user_jwt,
            # eject_orchestrator fixture yields an EjectSessionContext
            # carrying the probed orchestrator and a session_tmp_path.
            # The harness needs only the orchestrator (it implements
            # EjectOrchestratorProtocol); session_tmp_path is threaded into
            # eject_and_test by the @when step.
            eject_orchestrator=eject_orchestrator.orchestrator,
        )
        h = await stack.enter_async_context(harness)
        # Harness allocates and binds a ULID-keyed project in __aenter__.
        # Read the bound project_id back through the private attribute —
        # the public surface offers no getter today; preserving SLF001
        # silence here keeps lint clean without weakening the harness's
        # encapsulation in production code.
        project_id = h._project_id
        dataset_id = await h.upload_csv(_ORDERS_FIXTURE)
        capture.extras["harness"] = h
        capture.extras["user_jwt"] = user_jwt
        return h, project_id, dataset_id

    _h, project_id, dataset_id = loop.run_until_complete(_setup())
    capture.project_id = project_id
    capture.dataset_id = dataset_id


@when(parsers.parse('the customer asks the chat to "{prompt}"'))
def when_customer_asks_chat(
    prompt: str, capture: HarnessCapture, requires_groq: None
) -> None:
    """Drive one chat turn through the harness facade and capture the trace.

    Uses the harness's default ``max_retries=2`` (AC1.5 retry-with-rephrase
    budget) and stores the resulting ``ChatEventTrace`` on
    ``capture.chat_trace``. The trace surfaces the AC1.4 raw-tool-call
    invariant via ``trace.raw_tool_call_seen`` for milestone-4 checks.
    """
    loop: asyncio.AbstractEventLoop = capture.extras["_loop"]
    harness = capture.extras["harness"]
    capture.chat_trace = loop.run_until_complete(
        harness.chat_turn(prompt, dataset_id=capture.dataset_id),
    )


@when("the customer ejects the project and re-runs the validations")
def when_customer_ejects(
    capture: HarnessCapture, eject_orchestrator: Any
) -> None:
    """Eject + re-validate via the harness's ``eject_and_test`` extension.

    Threads the session-scoped ``tmp_path`` from the orchestrator fixture
    into the call so unzipped project artefacts share pytest's session
    tempdir lifecycle (orchestrator.py contract: caller controls tmpdir).
    Records the auth-proxy ingress URL on ``capture.fetch_url`` so the
    milestone-4 ADR-016 invariant has an observable to assert (the WS
    doesn't assert it but the field is captured for downstream scenarios).
    """
    loop: asyncio.AbstractEventLoop = capture.extras["_loop"]
    harness = capture.extras["harness"]
    capture.eject_report = loop.run_until_complete(
        harness.eject_and_test(
            project_id=capture.project_id,
            tmp_path=eject_orchestrator.session_tmp_path,
        ),
    )
    auth_proxy_url = os.environ.get("AUTH_PROXY_URL", "http://localhost:3000").rstrip("/")
    capture.fetch_url = (
        f"{auth_proxy_url}/api/projects/{capture.project_id}/export/dbt"
    )


@then("the ejected project re-validates successfully")
def then_revalidates_successfully(capture: HarnessCapture) -> None:
    assert capture.eject_report is not None, "no eject report captured"
    # Observable outcome from the driving port's return value (Dim 7).
    assert getattr(capture.eject_report, "status", None) == "pass", (
        f"expected eject status='pass', got "
        f"{getattr(capture.eject_report, 'status', None)!r}"
    )


@then("every staging model the chat produced was built and tested")
def then_models_built_and_tested(capture: HarnessCapture) -> None:
    assert capture.eject_report is not None, "no eject report captured"
    models_built = getattr(capture.eject_report, "models_built", []) or []
    tests_run = getattr(capture.eject_report, "tests_run", []) or []
    assert len(models_built) >= 1, (
        f"expected at least one model in models_built, got {models_built!r}"
    )
    assert len(tests_run) >= 1, (
        f"expected at least one test in tests_run, got {tests_run!r}"
    )


# ---------------------------------------------------------------------------
# Milestone 1 — eject-and-test
# ---------------------------------------------------------------------------


@given("a chat workflow has produced a staging model that is shape-correct")
def given_shape_correct_staging(capture: HarnessCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: drive the harness through "
        "a chat workflow that yields a shape-correct staging frame"
    )


@given("a chat workflow has produced a staging model whose exported tests would fail")
def given_exported_tests_would_fail(capture: HarnessCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: drive the harness through "
        "a chat workflow that yields a staging frame violating one of the "
        "schema.yml assertions in the exported project"
    )


@then("the report names at least one model that was built")
def then_report_names_a_model(capture: HarnessCapture) -> None:
    assert capture.eject_report is not None
    models = getattr(capture.eject_report, "models_built", []) or []
    assert len(models) >= 1, f"models_built was empty: {models!r}"


@then("the report names at least one validation that was executed")
def then_report_names_a_validation(capture: HarnessCapture) -> None:
    assert capture.eject_report is not None
    tests = getattr(capture.eject_report, "tests_run", []) or []
    assert len(tests) >= 1, f"tests_run was empty: {tests!r}"


@then("the ejected project re-validates as failed")
def then_revalidates_as_failed(capture: HarnessCapture) -> None:
    assert capture.eject_report is not None
    assert getattr(capture.eject_report, "status", None) == "fail", (
        f"expected eject status='fail', got "
        f"{getattr(capture.eject_report, 'status', None)!r}"
    )


@then("the report names the failing validation by name")
def then_failing_validation_named(capture: HarnessCapture) -> None:
    assert capture.eject_report is not None
    failures = getattr(capture.eject_report, "failures", []) or []
    assert len(failures) >= 1, "expected at least one named failure"
    # Each failure should have a name attribute (RunResult.node.name).
    for failure in failures:
        name = getattr(failure, "name", None) or (
            failure.get("name") if isinstance(failure, dict) else None
        )
        assert name, f"failure entry missing a name: {failure!r}"


@then("the seeded read path points at the same datalake bucket the running app uses")
def then_seeded_bucket_matches_app(capture: HarnessCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the seeded "
        "profiles.yml bucket path equals the running backend's "
        "configured MinIO bucket. Read both sides through observable "
        "outputs (eject_report.seeded_profile_bucket and the backend's "
        "GET /api/health/storage response)"
    )


@then("the seeded read endpoint matches the running app's storage endpoint")
def then_seeded_endpoint_matches_app(capture: HarnessCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: same as the bucket "
        "assertion above, but for the S3 endpoint URL"
    )


# ---------------------------------------------------------------------------
# Milestone 2 — validate-after (β only)
# ---------------------------------------------------------------------------


@when(
    "the customer asks the harness to validate the staging frame against the orders schema"
)
def when_validate_after(capture: HarnessCapture) -> None:
    """capsys-equivalent timing measurement happens HERE, in @when, not in
    @then. Skill F-002: capsys (and other step-scoped capture fixtures) are
    only available in the step that requests them."""
    start = time.monotonic()
    try:
        pytest.fail(
            "DISTILL scaffold — DELIVER implements: invoke "
            "DatasetLayerHarness.validate_after(dataset_id, OrdersStaging) "
            "and store the result on capture.validation_result"
        )
    finally:
        capture.validation_elapsed_ms = (time.monotonic() - start) * 1000.0


@then("the validation reports a successful result")
def then_validation_pass(capture: HarnessCapture) -> None:
    assert capture.validation_result is not None
    assert getattr(capture.validation_result, "status", None) == "pass", (
        f"expected validation status='pass', got "
        f"{getattr(capture.validation_result, 'status', None)!r}"
    )


@then("the validation completes within 200 milliseconds")
def then_validation_under_budget(capture: HarnessCapture) -> None:
    # Skill F-004: budget >= 200ms to avoid false flakes under parallel load.
    # The design.md §6 OQ4 rationale is "<100ms typical"; the acceptance-side
    # budget is 2x that to absorb CI/CD variance.
    assert capture.validation_elapsed_ms is not None
    assert capture.validation_elapsed_ms < 200.0, (
        f"validation took {capture.validation_elapsed_ms:.1f}ms, "
        f"budget is 200ms (skill F-004; design §6 OQ4 typical <100ms)"
    )


@given("the chat workflow will produce a wrong-shape staging frame on its first attempt")
def given_wrong_shape_first(capture: HarnessCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: configure a deterministic "
        "chat fixture that yields a wrong-shape frame on attempt #1"
    )


@given(
    "the chat workflow will produce a shape-correct staging frame on its first rephrase"
)
def given_correct_shape_after_rephrase(capture: HarnessCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: extend the chat fixture "
        "to yield a shape-correct frame on attempt #2 (first rephrase)"
    )


@given("the chat workflow will produce a wrong-shape staging frame on every attempt")
def given_wrong_shape_always(capture: HarnessCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: configure the chat "
        "fixture to yield wrong-shape frames on every attempt within "
        "the AC1.5 retry budget"
    )


@when("the customer runs the chat workflow with retries permitted")
def when_run_chat_with_retries(
    capture: HarnessCapture, requires_groq: None
) -> None:
    try:
        pytest.fail(
            "DISTILL scaffold — DELIVER implements: invoke "
            "DatasetLayerHarness.chat_turn(prompt, max_retries=2) and "
            "capture either the trace (success) or the raised "
            "AssertionError (exhaustion) on capture"
        )
    except AssertionError as e:
        capture.chat_error = e


@then("the chat workflow completes successfully on the first rephrase")
def then_chat_completes_after_rephrase(capture: HarnessCapture) -> None:
    assert capture.chat_error is None, (
        f"chat_turn unexpectedly raised: {capture.chat_error!r}"
    )
    assert capture.chat_trace is not None, "no chat trace captured"


@then("the per-turn validation eventually reports a successful result")
def then_validation_eventually_passes(capture: HarnessCapture) -> None:
    assert capture.validation_result is not None
    assert getattr(capture.validation_result, "status", None) == "pass"


@then("the chat workflow raises after the retry budget is exhausted")
def then_chat_raises_after_exhaustion(capture: HarnessCapture) -> None:
    assert capture.chat_error is not None, (
        "chat_turn was expected to raise after retry exhaustion but did not"
    )


@then("the diagnostic context names the offending column")
def then_diagnostic_names_column(capture: HarnessCapture) -> None:
    assert capture.chat_error is not None
    msg = str(capture.chat_error)
    # Observable outcome: the error message itself is a user-visible
    # surface. We assert it carries the structured-diagnostic context the
    # Pandera lazy-validation path produces.
    assert "column" in msg.lower(), (
        f"expected the failure message to name a column; got: {msg!r}"
    )


@then("the failure context includes the validation diff")
def then_failure_includes_diff(capture: HarnessCapture) -> None:
    assert capture.chat_error is not None
    msg = str(capture.chat_error)
    assert "diff" in msg.lower() or "expected" in msg.lower(), (
        f"expected the failure message to include a validation diff; "
        f"got: {msg!r}"
    )


# ---------------------------------------------------------------------------
# Milestone 3 — earned-trust probes
# ---------------------------------------------------------------------------


@given("the dbt runner cannot be imported")
def given_dbt_runner_broken(
    capture: HarnessCapture, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Sabotage probe 1's substrate: remove ``dbtRunner`` from
    ``dbt.cli.main`` so ``from dbt.cli.main import dbtRunner`` raises
    ImportError at probe time. ``monkeypatch.delattr`` reverts on
    function-scope teardown, so state cannot leak across scenarios.

    Probe 5 (``probe_run_results_shape``) imports ``dbtRunner`` from the
    same module and will ALSO fail in this scenario; that is fine —
    the @then assertion uses substring match on the failing-probe list,
    so ``probe_dbt_runner_importable`` appearing in the failures is the
    asserted contract regardless of probe 5's outcome.
    """
    import dbt.cli.main

    monkeypatch.delattr(dbt.cli.main, "dbtRunner", raising=False)


@given("the dbt-duckdb adapter cannot be loaded")
def given_dbt_duckdb_broken(capture: HarnessCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: monkeypatch "
        "dbt.adapters.duckdb to raise ImportError on import"
    )


@given("the project export endpoint is unreachable")
def given_export_endpoint_broken(capture: HarnessCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: monkeypatch the "
        "ProjectExporter adapter to receive a 5xx / connection-refused "
        "from a throwaway probe project"
    )


@given("the datalake cannot be read through the seeded profile")
def given_minio_unreadable(capture: HarnessCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: monkeypatch the seeded "
        "profile to point at a bucket the test creds cannot read"
    )


@given("the dbt result shape no longer matches the parser's expectations")
def given_run_results_shape_drift(capture: HarnessCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: monkeypatch dbtRunner to "
        "return a dbtRunnerResult whose .result is None or whose "
        "RunResult objects lack .node.name"
    )


@when("the eject orchestrator runs its earned-trust probes")
def when_orchestrator_probes_run(
    capture: HarnessCapture,
    tmp_path: Path,
) -> None:
    """Construct a FRESH probing orchestrator post-@given monkeypatch and
    capture the would-be skip reason.

    The session-scoped ``eject_orchestrator`` fixture probes once at
    session start against a HEALTHY substrate; M3 scenarios need a
    per-scenario orchestrator built AFTER the @given monkeypatch landed.
    We mirror the conftest fixture's skip-message construction format so
    @then assertions verify the SAME reason format the production fixture
    emits. Stays fixture-format-coupled by design — that IS the contract
    under test (ADR-019 §4: probe failure -> pytest.skip with the failing
    probe NAMED in the reason).

    Hexagonal boundary: this step uses the public
    ``EjectAndTestOrchestrator(...)`` constructor and ``await
    orchestrator.probe(tmp_path)`` only — no internal helpers
    (``probe_module.probe_*`` etc.) are imported.
    """
    loop: asyncio.AbstractEventLoop = capture.extras["_loop"]
    base_url = (
        capture.extras.get("override_base_url")
        or os.environ.get("AUTH_PROXY_URL", "http://localhost:3000").rstrip("/")
    )
    minio_creds = (
        capture.extras.get("override_minio_creds")
        or _read_minio_creds_from_env_for_steps()
    )
    auth_minter = capture.extras.get("override_auth_minter")  # None -> real minter

    async def _run_probes() -> Any:
        from tests.integration.dataset_layer.eject.orchestrator import (
            EjectAndTestOrchestrator,
        )

        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
            orch = EjectAndTestOrchestrator(
                http_client=client,
                base_url=base_url,
                minio_creds=minio_creds,
                auth_token_minter=auth_minter,
            )
            return await orch.probe(tmp_path)

    summary = loop.run_until_complete(_run_probes())
    if not summary.ok:
        # Mirror conftest's session-fixture skip-message construction so
        # @then assertions verify the SAME reason format the production
        # fixture emits. Stays fixture-format-coupled by design — that IS
        # the contract under test.
        failing_names = ", ".join(r.name for r in summary.failures) or "<unknown>"
        failing_reasons = "; ".join(
            f"{r.name}: {r.reason}" for r in summary.failures
        )
        capture.skip_reason = (
            f"eject orchestrator probe failed ({failing_names}); "
            f"details: {failing_reasons}"
        )


@then(parsers.parse('the suite skips with the failing probe named "{probe_name}"'))
def then_suite_skips_with_probe_named(
    probe_name: str, capture: HarnessCapture
) -> None:
    """When the @when step's pytest.skip propagates correctly, this @then
    is unreachable (skip aborts the test). DELIVER asserts the skip
    REASON contains the probe name from a pytest_runtest_makereport hook
    or by catching the skip exception in the @when step. For the
    scaffold, this @then exists so DELIVER has a place to encode the
    "named probe in the reason" assertion.
    """
    expected = capture.skip_reason or ""
    assert probe_name in expected, (
        f"expected skip reason to name probe {probe_name!r}, "
        f"got: {expected!r}"
    )


# ---------------------------------------------------------------------------
# Milestone 4 — protocol invariants
# ---------------------------------------------------------------------------


@when("the customer runs a complete chat workflow")
def when_customer_runs_complete_workflow(
    capture: HarnessCapture, requires_groq: None
) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: invoke a representative "
        "harness.chat_turn(...) sequence end-to-end and store the trace"
    )


@then("the chat trace contains no raw tool-call frames")
def then_no_raw_tool_call_frames(capture: HarnessCapture) -> None:
    assert capture.chat_trace is not None, "no chat trace captured"
    # AC1.4 invariant: the harness raises on a leak today; this assertion
    # is the acceptance-side guard that the new validation layers do not
    # bypass that guard.
    raw_seen = getattr(capture.chat_trace, "raw_tool_call_seen", None)
    assert raw_seen is False, (
        f"raw tool-call delta leaked through (AC1.4 violation); "
        f"raw_tool_call_seen={raw_seen!r}"
    )


@then("the project export was fetched through the production-ingress URL")
def then_fetched_via_ingress(capture: HarnessCapture) -> None:
    """ADR-016: the orchestrator MUST reach the SUT through the auth-proxy
    ingress (default localhost:3000), not through the backend's internal
    port. The orchestrator records the URL it used on
    capture.fetch_url; this @then asserts it matches the configured ingress.
    """
    assert capture.fetch_url is not None, "no export fetch URL captured"
    auth_proxy_url = os.environ.get("AUTH_PROXY_URL", "http://localhost:3000")
    assert capture.fetch_url.startswith(auth_proxy_url), (
        f"export fetch URL {capture.fetch_url!r} does not start with "
        f"auth-proxy ingress {auth_proxy_url!r}"
    )


@then("the project export was not fetched directly from a backend internal port")
def then_not_fetched_from_backend(capture: HarnessCapture) -> None:
    assert capture.fetch_url is not None
    # Backend internal port is 8000 in the local topology; ADR-016
    # forbids tests from talking to it directly.
    assert ":8000/" not in capture.fetch_url, (
        f"export fetch URL {capture.fetch_url!r} talks to backend "
        f"internal port 8000 — ADR-016 violation"
    )


# ---------------------------------------------------------------------------
# Milestone 5 — failure modes
# ---------------------------------------------------------------------------


@given(
    "the project export will reference a credential variable that is not set in the environment"
)
def given_export_references_unset_var(capture: HarnessCapture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: monkeypatch the export "
        "endpoint's profiles.yml template to include "
        "{{ env_var('DC_TEST_UNSET_CREDENTIAL') }} and ensure that env "
        "var is unset in the pytest process"
    )


@then("the seeder fails with an error that names the missing credential variable")
def then_seeder_names_missing_var(capture: HarnessCapture) -> None:
    assert capture.seeder_error is not None, (
        "expected seeder to raise but no error captured"
    )
    msg = str(capture.seeder_error)
    assert "DC_TEST_UNSET_CREDENTIAL" in msg, (
        f"seeder error does not name the missing variable; got: {msg!r}"
    )


@then("the orchestrator does not silently substitute an empty value")
def then_no_silent_substitution(capture: HarnessCapture) -> None:
    # Observable: if the orchestrator silently substituted "" then
    # eject_report would either be None (no fetch happened) or status
    # would reflect downstream failure rather than the seeder raising.
    # The contract is: fail at the seeder, not later.
    assert capture.eject_report is None, (
        f"expected orchestrator to fail at seeder; got eject_report: "
        f"{capture.eject_report!r}"
    )
    assert capture.seeder_error is not None
