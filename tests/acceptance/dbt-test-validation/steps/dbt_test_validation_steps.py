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
from collections.abc import AsyncIterator, Callable
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
    Records the orchestrator's actual fetch URL on ``capture.fetch_url`` —
    reconstructed from ``orchestrator._base_url`` so the milestone-4
    ADR-016 invariant assertion observes the URL the orchestrator was
    wired with at composition root, NOT the env var (which would only
    prove the env, not the orchestrator's choice).

    Captures any seeder-raised ``RuntimeError`` on ``capture.seeder_error``
    rather than letting it propagate. The milestone-5 export-breakage
    scenario asserts that the seeder fails LOUDLY with a named missing
    credential — the @then bindings observe the captured exception. For
    the WS / M1 / M4 scenarios where the seeder is expected to succeed,
    the absence of an exception is implicit (capture.eject_report is
    populated as before).
    """
    loop: asyncio.AbstractEventLoop = capture.extras["_loop"]
    harness = capture.extras["harness"]
    try:
        capture.eject_report = loop.run_until_complete(
            harness.eject_and_test(
                project_id=capture.project_id,
                tmp_path=eject_orchestrator.session_tmp_path,
            ),
        )
    except RuntimeError as exc:
        capture.seeder_error = exc
    # ADR-016 ingress invariant (milestone-4): the orchestrator builds
    # export URLs from its wired base_url (orchestrator.py:_fetch_zip).
    # Reading ``orchestrator._base_url`` makes the @then assertion observe
    # the orchestrator's choice rather than re-deriving from env.
    base_url = eject_orchestrator.orchestrator._base_url  # noqa: SLF001
    capture.fetch_url = (
        f"{base_url}/api/projects/{capture.project_id}/export/dbt"
    )


@then("the ejected project re-validates successfully")
def then_revalidates_successfully(capture: HarnessCapture) -> None:
    assert capture.eject_report is not None, "no eject report captured"
    # Observable outcome from the driving port's return value (Dim 7).
    assert getattr(capture.eject_report, "status", None) == "pass", (
        f"expected eject status='pass', got "
        f"{getattr(capture.eject_report, 'status', None)!r}"
    )


@then("every staging model in the eject was built and tested")
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
    """Inject a deterministic always-passing constraint via the dataset API.

    Per DWD-9 the M1 happy-path / customer-fidelity scenarios use
    deterministic fixture-driven setup — NO LLM chat turn — so the green
    signal is reproducible across CI runs. The orders.csv fixture has
    15/15 rows with a non-empty ``region`` value (column 4); patching the
    dataset's ``schema_config`` to add ``constraints.required: true`` on
    ``region`` forces the schema.yml exporter (step 02-01) to emit a
    ``not_null_stg_orders_region`` dbt test that passes against the upload.
    The eject orchestrator then runs deps/build/test and the parser
    surfaces ``status='pass'`` with at least one model built and one test
    executed — satisfying both the happy-path AND customer-fidelity
    scenarios (which share this @given).

    Driving-port discipline: the patch routes through
    ``DatasetLayerHarness.set_dataset_schema_config``, which exercises
    the real ``DatasetUpdate`` Pydantic schema and metadata-repository
    update path. Mirrors the drift-detector @given's structure (lines
    313-364) — the only difference is the targeted column (region vs
    order_id) and the column's data shape (no nulls vs deliberate nulls).
    """
    loop: asyncio.AbstractEventLoop = capture.extras["_loop"]
    harness = capture.extras["harness"]
    dataset_id = capture.dataset_id
    user_jwt = capture.extras["user_jwt"]
    auth_proxy_url = os.environ.get("AUTH_PROXY_URL", "http://localhost:3000").rstrip("/")

    async def _inject_required_on_region() -> None:
        # Fetch current schema_config, mutate only the region entry.
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
            res = await client.get(
                f"{auth_proxy_url}/api/datasets/{dataset_id}",
                headers={"Authorization": f"Bearer {user_jwt}"},
            )
            res.raise_for_status()
            body = res.json()
        data = body.get("data", body) if isinstance(body, dict) else {}
        if isinstance(data, dict) and isinstance(data.get("attributes"), dict):
            data = data["attributes"]
        current = data.get("schema_config") or {"fields": {}}
        fields = dict(current.get("fields") or {})
        region_entry = dict(fields.get("region") or {"type": "text"})
        region_constraints = dict(region_entry.get("constraints") or {})
        region_constraints["required"] = True
        region_entry["constraints"] = region_constraints
        fields["region"] = region_entry
        new_schema_config = {**current, "fields": fields}
        await harness.set_dataset_schema_config(dataset_id, new_schema_config)

    loop.run_until_complete(_inject_required_on_region())


@given("a chat workflow has produced a staging model whose exported tests would fail")
def given_exported_tests_would_fail(capture: HarnessCapture) -> None:
    """Inject a deterministic data-violating constraint via the dataset API.

    Per DWD-9 (docs/feature/dbt-test-validation/distill/wave-decisions.md)
    the milestone-1 scenarios use deterministic fixture-driven data,
    NOT an LLM chat turn — LLM jitter would make the drift signal
    flaky. The orders.csv fixture deliberately contains 2 rows with an
    empty ``order_id`` (lines starting with a comma); patching the
    dataset's schema_config to add ``constraints.required: true`` on
    ``order_id`` forces the schema.yml exporter (step 02-01) to emit a
    ``not_null`` dbt test that the data violates. The eject orchestrator
    then runs deps/build/test and the parser surfaces
    ``not_null_stg_orders_order_id`` in the failure list (step 02-02).

    Driving-port discipline: the patch routes through
    ``DatasetLayerHarness.set_dataset_schema_config``, which exercises
    the real ``DatasetUpdate`` Pydantic schema and metadata-repository
    update path.
    """
    loop: asyncio.AbstractEventLoop = capture.extras["_loop"]
    harness = capture.extras["harness"]
    dataset_id = capture.dataset_id
    user_jwt = capture.extras["user_jwt"]
    auth_proxy_url = os.environ.get("AUTH_PROXY_URL", "http://localhost:3000").rstrip("/")

    async def _inject_required_on_order_id() -> None:
        # Fetch current schema_config so we preserve all inferred fields
        # and only mutate the order_id entry. Using a fresh client keeps
        # this independent of any mutation the harness's wrapper might do.
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
            res = await client.get(
                f"{auth_proxy_url}/api/datasets/{dataset_id}",
                headers={"Authorization": f"Bearer {user_jwt}"},
            )
            res.raise_for_status()
            body = res.json()
        # Tolerate both flat and JSON:API shapes.
        data = body.get("data", body) if isinstance(body, dict) else {}
        if isinstance(data, dict) and isinstance(data.get("attributes"), dict):
            data = data["attributes"]
        current = data.get("schema_config") or {"fields": {}}
        fields = dict(current.get("fields") or {})
        order_id_entry = dict(fields.get("order_id") or {"type": "text"})
        order_id_constraints = dict(order_id_entry.get("constraints") or {})
        order_id_constraints["required"] = True
        order_id_entry["constraints"] = order_id_constraints
        fields["order_id"] = order_id_entry
        new_schema_config = {**current, "fields": fields}
        await harness.set_dataset_schema_config(dataset_id, new_schema_config)

    loop.run_until_complete(_inject_required_on_order_id())


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
    """Customer-fidelity invariant (ADR-019): the value the orchestrator
    handed the seeder MUST be the SAME bucket the running backend reads from
    via Ibis-DuckDB. Both sides observe the same env var
    (``S3_BUCKET``) — backend at startup, harness via the conftest fixture
    threaded into the orchestrator. ``eject_report.seeded_profile_bucket``
    is populated by the orchestrator after parse, so this assertion proves
    the seeder did not lose / rewrite the value the orchestrator wired.
    """
    assert capture.eject_report is not None, "no eject report captured"
    seeded_bucket = getattr(capture.eject_report, "seeded_profile_bucket", "")
    expected_bucket = _read_minio_creds_from_env_for_steps()["bucket"]
    assert seeded_bucket == expected_bucket, (
        f"seeded_profile_bucket {seeded_bucket!r} does not match the "
        f"backend's MinIO bucket {expected_bucket!r} — substrate-divergence "
        f"would silently green-light the eject against the wrong lake "
        "(ADR-019 customer-fidelity invariant)"
    )


@then("the seeded read endpoint matches the running app's storage endpoint")
def then_seeded_endpoint_matches_app(capture: HarnessCapture) -> None:
    """Same fidelity invariant for the S3 endpoint. The seeder writes the
    host:port form (scheme stripped — ``DuckDBProfileSeeder._strip_scheme``)
    and the orchestrator mirrors that form on the report. The env value
    is typically a URL (``http://localhost:9000``); strip the scheme on the
    expected side to compare apples-to-apples against the on-disk
    profiles.yml form.
    """
    assert capture.eject_report is not None, "no eject report captured"
    seeded_endpoint = getattr(capture.eject_report, "seeded_profile_endpoint", "")
    raw_endpoint = _read_minio_creds_from_env_for_steps()["endpoint_url"]
    expected_endpoint = raw_endpoint
    for scheme in ("http://", "https://"):
        if expected_endpoint.startswith(scheme):
            expected_endpoint = expected_endpoint[len(scheme):]
            break
    assert seeded_endpoint == expected_endpoint, (
        f"seeded_profile_endpoint {seeded_endpoint!r} does not match the "
        f"backend's storage endpoint {expected_endpoint!r} (raw env: "
        f"{raw_endpoint!r}) — the seeder must mirror the same host:port "
        "the in-app DuckDB resolves to (ADR-019 customer-fidelity invariant)"
    )


# ---------------------------------------------------------------------------
# Milestone 2 — validate-after (β only)
# ---------------------------------------------------------------------------


@when(
    "the customer asks the harness to validate the staging frame against the orders schema"
)
def when_validate_after(capture: HarnessCapture) -> None:
    """Drive the per-turn validate-after through the harness facade.

    Routes the call through ``DatasetLayerHarness.validate_after`` —
    the driving port for Phase 3's Pandera-per-turn layer. The harness
    fetches the current TableState for the dataset (over the auth-proxy
    ingress) and runs the schema with lazy=True; the returned
    ``ValidationResult`` carries status, structured errors, and elapsed
    wall-clock time. Timing is measured around the @when call rather
    than relying on result.elapsed_ms only — so the @then budget
    assertion observes the same wall-clock the customer would.

    Skill F-002: capsys (and other step-scoped capture fixtures) are
    only available in the step that requests them — keep the timing
    block scoped here.
    """
    from tests.integration.dataset_layer.validation.schemas.orders_staging import (
        OrdersStaging,
    )

    loop: asyncio.AbstractEventLoop = capture.extras["_loop"]
    harness = capture.extras["harness"]
    start = time.monotonic()
    try:
        capture.validation_result = loop.run_until_complete(
            harness.validate_after(capture.dataset_id, OrdersStaging),
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


def _install_pandera_validator_stub(
    capture: HarnessCapture,
    monkeypatch: pytest.MonkeyPatch,
    *,
    fail_on: Callable[[int], bool],
) -> None:
    """Substrate-side injection: patch PanderaValidator.validate with a
    stateful stub keyed off ``capture.extras["pandera_attempt"]``.

    Same monkeypatch pattern milestone-3 probe scenarios use to inject
    deterministic substrate behavior. The driving port (harness.chat_turn
    via validate_with=OrdersStaging) is preserved — only the leaf
    PanderaValidator is substituted so the @when prompt/Groq jitter does
    not influence the validation outcome.

    ``fail_on(attempt)`` returns True when this attempt should yield a
    fail result (with a region-column diagnostic), False for pass.
    Attempts are 1-indexed; counter increments on every validate() call.

    Each call also stores the most-recent ValidationResult on
    ``capture.validation_result`` so the @then "eventually reports a
    successful result" assertion observes the LAST result the harness
    saw.
    """
    from tests.integration.dataset_layer.validation import pandera_validator as pv_module
    from tests.integration.dataset_layer.validation.pandera_validator import (
        ValidationResult,
    )

    capture.extras["pandera_attempt"] = 0

    def _stub_validate(self: Any, df: Any, schema: Any, *, budget_ms: float = 200.0) -> Any:
        capture.extras["pandera_attempt"] += 1
        attempt = capture.extras["pandera_attempt"]
        if fail_on(attempt):
            result = ValidationResult(
                status="fail",
                errors=["region: failed check 'isin' (value='Mars')"],
                elapsed_ms=5.0,
                over_budget=False,
            )
        else:
            result = ValidationResult(
                status="pass",
                errors=[],
                elapsed_ms=3.0,
                over_budget=False,
            )
        capture.validation_result = result
        return result

    monkeypatch.setattr(pv_module.PanderaValidator, "validate", _stub_validate)


@given("the chat workflow will produce a wrong-shape staging frame on its first attempt")
def given_wrong_shape_first(
    capture: HarnessCapture, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Install a Pandera stub that fails attempt 1 (S2 first half).

    The S2 scenario also pairs with ``given_correct_shape_after_rephrase``
    below; both @givens chain through ``capture.extras["pandera_attempt"]``
    so the stub for "fail then pass" is the union of the two predicates.
    Installing once here covers BOTH @given fragments — the second
    @given is a no-op marker that documents the intended behavior.
    """
    _install_pandera_validator_stub(
        capture,
        monkeypatch,
        fail_on=lambda attempt: attempt == 1,
    )


@given(
    "the chat workflow will produce a shape-correct staging frame on its first rephrase"
)
def given_correct_shape_after_rephrase(capture: HarnessCapture) -> None:
    """Documentary @given — the predicate installed by
    ``given_wrong_shape_first`` already encodes "attempt 2+ passes".
    Asserting the stub is in place here protects against the S2
    scenario being reordered.
    """
    assert "pandera_attempt" in capture.extras, (
        "S2 scenarios must run given_wrong_shape_first BEFORE this @given"
    )


@given("the chat workflow will produce a wrong-shape staging frame on every attempt")
def given_wrong_shape_always(
    capture: HarnessCapture, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Install a Pandera stub that fails on every attempt (S3)."""
    _install_pandera_validator_stub(
        capture,
        monkeypatch,
        fail_on=lambda attempt: True,
    )


@when("the customer runs the chat workflow with retries permitted")
def when_run_chat_with_retries(
    capture: HarnessCapture, requires_groq: None
) -> None:
    """Drive harness.chat_turn with validate_with=OrdersStaging.

    The Pandera validator is monkey-patched in the @given step so the
    pass/fail sequence is deterministic; the prompt content does not
    affect the validation outcome. ``requires_groq`` is preserved
    because chat_turn still posts to the worker /chat endpoint over the
    real compose stack — only the validator leaf is substituted.

    Captures either the trace (S2 success) or the raised AssertionError
    (S3 exhaustion) on the capture object so the @then bindings can
    assert on observable outcomes.
    """
    from tests.integration.dataset_layer.validation.schemas.orders_staging import (
        OrdersStaging,
    )

    loop: asyncio.AbstractEventLoop = capture.extras["_loop"]
    harness = capture.extras["harness"]
    prompt = "Validate the staging frame against the orders schema"
    try:
        capture.chat_trace = loop.run_until_complete(
            harness.chat_turn(
                prompt,
                dataset_id=capture.dataset_id,
                validate_with=OrdersStaging,
                max_retries=2,
            ),
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
def given_dbt_duckdb_broken(
    capture: HarnessCapture, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Force the dbt.adapters.duckdb import to fail.

    The probe does ``from dbt.adapters import duckdb as _duckdb_adapter``;
    Python's import system checks ``sys.modules['dbt.adapters.duckdb']``
    before re-importing. Setting that key to ``None`` causes the import
    to raise ``ImportError`` (Python's documented behavior for None
    entries in sys.modules). Removing the cached attribute on
    ``dbt.adapters`` covers the case where the package was already
    imported and bound the submodule attribute. monkeypatch reverts
    both at function teardown — no leak.
    """
    import sys

    import dbt.adapters

    monkeypatch.setitem(sys.modules, "dbt.adapters.duckdb", None)
    monkeypatch.delattr(dbt.adapters, "duckdb", raising=False)


@given("the project export endpoint is unreachable")
def given_export_endpoint_broken(capture: HarnessCapture) -> None:
    """Point the probing orchestrator at an unbound TCP port so probe 3
    hits ``httpx.ConnectError`` and reports ok=False with the probe NAMED
    in the reason (ADR-019 Earned-Trust contract, probe 3 row).

    127.0.0.1:1 is the canonical "definitely-unreachable port" pattern:
    privileged-and-typically-unbound, no DNS lookup, ECONNREFUSED is
    immediate. The probe catches the resulting ``httpx.HTTPError`` and
    emits a structured ``ProbeReport(ok=False, name="probe_export_endpoint_reachable", ...)``.

    The auth-token minter is stubbed because the orchestrator's
    ``_ensure_auth_token`` defaults to dialing the SAME ``base_url`` (now
    pointed at the unbound port). Stubbing it ensures only probe 3 sees
    the bad URL — probes 1, 2, 4, 5 stay on healthy substrate so they
    can each fail/pass for their own probe-specific reasons rather than
    all riding on the auth-mint failure.
    """
    capture.extras["override_base_url"] = "http://127.0.0.1:1"

    async def _stub_token(_url: str) -> str:
        return "stub-token-for-unreachable-probe-3"

    capture.extras["override_auth_minter"] = _stub_token


@given("the datalake cannot be read through the seeded profile")
def given_minio_unreadable(capture: HarnessCapture) -> None:
    """Hand the probing orchestrator MinIO creds DuckDB will reject.

    Probe 4 (``probe_minio_readable_via_duckdb``) writes a canary parquet
    to the seeded bucket via DuckDB's httpfs and then reads it back. With
    the access_key/secret_key sentinels below, MinIO returns a server-side
    ``Forbidden`` / ``InvalidAccessKeyId`` at the COPY call; the probe
    catches it and emits ``ProbeReport(ok=False, name="probe_minio_readable_via_duckdb", ...)``.

    Real endpoint URL is preserved so the failure surfaces as auth, not
    routing — that is the substrate-lie probe 4 is contracted to catch:
    env_var(...) substitution producing creds that compile but cannot
    read (ADR-019 §"Earned-Trust contract", probe 4 row).

    Probes 1, 2, 3, 5 are independent of ``minio_creds`` (probes 1+2 are
    pure imports; probe 3 dials base_url; probe 5 uses a local tmpdir
    dbt project), so only probe 4 sees the bad creds in this scenario.
    The @when foundation step (01-01) reads
    ``capture.extras["override_minio_creds"]`` and threads it into the
    fresh orchestrator's constructor — DO NOT modify the @when body.
    """
    capture.extras["override_minio_creds"] = {
        "endpoint_url": os.environ.get("S3_ENDPOINT", "http://localhost:9000"),
        "access_key": "DC_TEST_INVALID_ACCESS_KEY",
        "secret_key": "DC_TEST_INVALID_SECRET_KEY",
        "bucket": os.environ.get("S3_BUCKET", "dashboard-chat.datalake"),
        "region": os.environ.get("S3_REGION", "us-east-1"),
    }


@given("the dbt result shape no longer matches the parser's expectations")
def given_run_results_shape_drift(
    capture: HarnessCapture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Force probe 5 to see a malformed ``dbtRunnerResult`` shape.

    Probe 5 (``probe_run_results_shape``) instantiates ``dbtRunner()`` and
    calls ``runner.invoke(['parse', ...])``, then reads ``.success`` and
    ``.result`` off the returned object. Replacing ``invoke`` at the CLASS
    level with a stub that returns an object missing the ``.result``
    attribute drives the probe down its
    ``ok=False, reason="dbtRunnerResult missing .result attribute"`` branch
    — the canonical "dbt minor-version bump changed the RunResult shape"
    lie the probe is contracted to catch loudly per ADR-019
    §"Earned-Trust contract" (probe 5 row).

    Probes 1, 2, 3, 4 are unaffected:

    * Probe 1 imports ``dbtRunner`` and reads the dbt-core package version
      — it never calls ``.invoke()``.
    * Probes 2 and 4 do not touch ``dbtRunner`` at all.
    * Probe 3 dials the export endpoint over ``httpx``.

    ``monkeypatch.setattr`` reverts on function-scope teardown, so the
    patched ``invoke`` cannot leak into other scenarios.
    """
    import dbt.cli.main

    class _ShapeDriftResult:
        success = True
        # Deliberately no `.result` attribute — that IS the contract drift.

    def _drifted_invoke(self: Any, args: Any, **kwargs: Any) -> Any:
        return _ShapeDriftResult()

    monkeypatch.setattr(dbt.cli.main.dbtRunner, "invoke", _drifted_invoke)


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
    """Drive one representative chat_turn end-to-end and capture the trace.

    The AC1.4 raw-tool-call leak guard is unconditional in
    ``DatasetLayerHarness.chat_turn`` (harness.py): the trace's
    ``raw_tool_call_seen`` flag is checked BEFORE any post-turn composition
    runs (including the Phase-3 ``validate_after`` layer). This @when
    proves the guard still fires after Phase 3 wired ``validate_after``
    into the post-turn closure — a chat workflow that completes (returns
    a trace) implies AC1.4 held throughout.

    Uses a neutral prompt that does not need to mutate the dataset; the
    AC1.4 invariant is orthogonal to LLM behavior, so a deterministic
    prompt outcome is not required for this assertion. ``requires_groq``
    skips the scenario when no API key is on the wire, matching the rest
    of the chat-driven scenarios.
    """
    loop: asyncio.AbstractEventLoop = capture.extras["_loop"]
    harness = capture.extras["harness"]
    capture.chat_trace = loop.run_until_complete(
        harness.chat_turn(
            "Summarise the columns in this dataset",
            dataset_id=capture.dataset_id,
        ),
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
def given_export_references_unset_var(
    capture: HarnessCapture, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Inject ``env_var('DC_TEST_UNSET_CREDENTIAL')`` into the unzipped
    profiles.yml so the seeder's substrate-lie defense surfaces the
    unfamiliar var name in its RuntimeError.

    The backend's export template lives in a separate process — the
    pragmatic injection point is the orchestrator's ``_unzip_project``
    static method, which we wrap to ALSO append a tampered env_var
    reference after the real unzip completes. This simulates the export
    template growing a new credential reference the seeder has not been
    updated to handle (Phase 5 §design.md §13 Risk #1).

    ``monkeypatch.delenv(... raising=False)`` ensures the var is NOT in
    ``os.environ``; the seeder's known-set check would still raise even
    if the var were set, but unsetting it documents the scenario's
    intent: a credential the runtime cannot provide.
    """
    from tests.integration.dataset_layer.eject.orchestrator import (
        EjectAndTestOrchestrator,
    )

    monkeypatch.delenv("DC_TEST_UNSET_CREDENTIAL", raising=False)

    real_unzip = EjectAndTestOrchestrator._unzip_project

    def tampered_unzip(zip_bytes: bytes, target_dir: Path) -> Path:
        result = real_unzip(zip_bytes, target_dir)
        profiles_path = result / "profiles.yml"
        original = profiles_path.read_text() if profiles_path.exists() else ""
        # Append the test injection AFTER the real export's content so
        # parsing still succeeds — only the env_var() ref scan triggers
        # on the new line.
        injection = (
            "\n# Phase 5 test injection — exercises seeder env_var defense.\n"
            "_dc_test_injection: \"{{ env_var('DC_TEST_UNSET_CREDENTIAL') }}\"\n"
        )
        profiles_path.write_text(original + injection)
        return result

    monkeypatch.setattr(
        EjectAndTestOrchestrator,
        "_unzip_project",
        staticmethod(tampered_unzip),
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
