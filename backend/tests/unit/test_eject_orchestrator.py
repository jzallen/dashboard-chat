"""Unit tests for EjectAndTestOrchestrator — drives Step 00-06 (dbt-test-validation).

Driving port: ``EjectAndTestOrchestrator`` exposes two public async methods —
``probe()`` and ``eject_and_test(project_id, tmp_path)``. Both are tested
directly through that public surface.

Composition-root invariant (ADR-018 §4): the orchestrator is the central new
component for Option β. Tests exercise the full compose-then-call cycle with a
real ``DuckDBProfileSeeder`` + ``DbtRunner`` + ``RunResultsParser`` against a
hand-built minimal dbt project zip — mocking the substrate components would
test our wrapper, not the composition. Probes 3/4/5 (substrate-dependent
external I/O) are monkeypatched to ok-reports because the unit test environment
has no MinIO bucket + no live backend; their happy paths are covered by
``test_probe_happy_paths.py`` (step 00-05) and the per-probe failure scenarios
by Phase 1 distill milestone-3. Probes 1 + 2 run for real here — they are pure
imports against the dbt-core / dbt-duckdb extras installed by step 00-01.

Test budget: 6 distinct behaviors x 2 = 12. Using 6.
    1. probe() aggregates 5 individual ProbeReports into a ProbeSummary
    2. probe() is cached (idempotent within a session)
    3. eject_and_test happy path returns EjectTestReport
    4. EjectOrchestratorProtocol runtime_checkable conformance
    5. orchestrator.py does not allocate its own tempdir (caller controls)
    6. eject_and_test raises RuntimeError when dbt_project.yml has no profile key
       (substrate-gap defence — the seeder cannot invent a profile name)
"""

from __future__ import annotations

import ast
import io
import textwrap
import zipfile
from collections.abc import Awaitable, Callable
from pathlib import Path

import httpx
import pytest

from tests.integration.dataset_layer.eject import probe as probe_module
from tests.integration.dataset_layer.eject.orchestrator import (
    EjectAndTestOrchestrator,
)
from tests.integration.dataset_layer.eject.parser import EjectTestReport
from tests.integration.dataset_layer.eject.probe import ProbeReport
from tests.integration.dataset_layer.eject.protocols import (
    EjectOrchestratorProtocol,
)

# ---------------------------------------------------------------------------
# Fixtures: minimal valid dbt project zip the export endpoint pretends to return.
# The orchestrator unzips this, the seeder rewrites profiles.yml, the runner
# calls dbt deps/build/test against the result.
# ---------------------------------------------------------------------------


_FIXTURE_PROFILE_NAME = "dataset_staging_01h_test_ulid"


def _build_fixture_dbt_zip(profile_name: str = _FIXTURE_PROFILE_NAME) -> bytes:
    """Build a tiny valid dbt+duckdb project zip mirroring the exporter's shape.

    The exporter generates project-specific profile names (e.g.
    ``dataset_staging_<snake-cased ULID>``) via
    backend/app/use_cases/project/_dbt/project_yml.py and references that
    same name in ``dbt_project.yml`` via the ``profile:`` field. The
    fixture mirrors that shape so the orchestrator's parse-then-pass logic
    is exercised against a realistic input. The model selects a literal so
    no MinIO is required during the dbt build phase.
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "dbt_project.yml",
            textwrap.dedent(
                f"""\
                name: '{profile_name}'
                version: '1.0.0'
                config-version: 2
                profile: '{profile_name}'
                model-paths: ["models"]
                """
            ),
        )
        # placeholder — overwritten by DuckDBProfileSeeder during eject_and_test
        zf.writestr(
            "profiles.yml",
            textwrap.dedent(
                f"""\
                {profile_name}:
                  target: dev
                  outputs:
                    dev:
                      type: duckdb
                      path: ":memory:"
                """
            ),
        )
        zf.writestr("models/hello.sql", "select 1 as one")
    return buf.getvalue()


def _build_fixture_dbt_zip_without_profile() -> bytes:
    """Same shape as the happy fixture but with no ``profile:`` key in
    dbt_project.yml — drives the substrate-gap error path."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "dbt_project.yml",
            textwrap.dedent(
                """\
                name: 'broken_export'
                version: '1.0.0'
                config-version: 2
                model-paths: ["models"]
                """
            ),
        )
        zf.writestr("models/hello.sql", "select 1 as one")
    return buf.getvalue()


@pytest.fixture
def fixture_zip_bytes() -> bytes:
    return _build_fixture_dbt_zip()


@pytest.fixture
def minio_creds() -> dict[str, str]:
    """Stub MinIO credentials — concrete enough for the seeder to write a valid
    profile, never actually used because the fixture model has no s3 source."""
    return {
        "endpoint_url": "http://minio.test.local:9000",
        "access_key": "test-access-key",
        "secret_key": "test-secret-key",
        "bucket": "test-bucket",
        "region": "us-east-1",
    }


@pytest.fixture
def stub_auth_minter() -> Callable[[str], Awaitable[str]]:
    """No-op auth minter for unit tests: returns a fixed dev token without HTTP.

    The orchestrator's ``_ensure_auth_token`` calls this instead of
    ``AuthApi.fetch_dev_user_jwt`` so the unit tests don't need a live
    auth-proxy on the wire. The integration path (acceptance suite's
    ``eject_orchestrator`` fixture) leaves the kwarg unset so the real
    minter runs against the compose stack.
    """

    async def _mint(_base_url: str) -> str:
        return "unit-test-stub-jwt"

    return _mint


@pytest.fixture
def export_zip_transport(fixture_zip_bytes: bytes) -> httpx.MockTransport:
    """httpx MockTransport returning 200/application/zip with the fixture zip."""

    def handler(request: httpx.Request) -> httpx.Response:
        # Orchestrator should hit the export endpoint per design.md §3
        # (GET /api/projects/{id}/export/dbt). We don't pin the exact path
        # in the assertion — that would couple the test to wiring detail —
        # but we do assert it's a GET.
        assert request.method == "GET", f"orchestrator should GET; saw {request.method}"
        return httpx.Response(
            200,
            content=fixture_zip_bytes,
            headers={"Content-Type": "application/zip"},
        )

    return httpx.MockTransport(handler)


@pytest.fixture
def patched_substrate_probes(monkeypatch: pytest.MonkeyPatch) -> None:
    """Monkeypatch the 3 substrate-dependent probes to return ok=True.

    Probes 1 + 2 (dbt-core / dbt-duckdb importable) run for real — those
    are pure-import probes against the test extras installed by 00-01.
    Probes 3 (export endpoint) + 4 (MinIO) + 5 (run_results shape) require
    a live backend, MinIO bucket, and a fixture dbt project respectively;
    their happy paths are covered by ``test_probe_happy_paths.py``.
    """
    ok_export = ProbeReport(name="probe_export_endpoint_reachable", ok=True, reason="patched ok")
    ok_minio = ProbeReport(name="probe_minio_readable_via_duckdb", ok=True, reason="patched ok")
    ok_shape = ProbeReport(name="probe_run_results_shape", ok=True, reason="patched ok")
    monkeypatch.setattr(probe_module, "probe_export_endpoint_reachable", lambda *a, **kw: ok_export)
    monkeypatch.setattr(probe_module, "probe_minio_readable_via_duckdb", lambda *a, **kw: ok_minio)
    monkeypatch.setattr(probe_module, "probe_run_results_shape", lambda *a, **kw: ok_shape)


# ---------------------------------------------------------------------------
# Behavior 1: probe() aggregates 5 ProbeReports into a ProbeSummary
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_probe_aggregates_5_individual_probes_into_summary(
    export_zip_transport: httpx.MockTransport,
    minio_creds: dict[str, str],
    patched_substrate_probes: None,
    stub_auth_minter: Callable[[str], Awaitable[str]],
    tmp_path: Path,
) -> None:
    """probe() runs all 5 earned-trust probes and returns an aggregate
    ProbeSummary with one ProbeReport per probe."""
    async with httpx.AsyncClient(transport=export_zip_transport, base_url="http://test-backend.local") as http_client:
        orch = EjectAndTestOrchestrator(
            http_client=http_client,
            base_url="http://test-backend.local",
            minio_creds=minio_creds,
            auth_token_minter=stub_auth_minter,
        )

        summary = await orch.probe(tmp_path=tmp_path)

    assert summary.ok is True, f"summary.ok should be True; failures={summary.failures!r}"
    assert len(summary.reports) == 5, f"5 earned-trust probes per ADR-018 §4; saw {len(summary.reports)}"
    assert summary.failures == [], f"expected no failing probes; got {summary.failures!r}"
    # Names map 1:1 to ADR-018 §4 (probe identity is greppable from CI logs).
    expected_names = {
        "probe_dbt_runner_importable",
        "probe_dbt_duckdb_loadable",
        "probe_export_endpoint_reachable",
        "probe_minio_readable_via_duckdb",
        "probe_run_results_shape",
    }
    actual_names = {r.name for r in summary.reports}
    assert actual_names == expected_names, (
        f"probe names should match ADR-018 §4; expected={expected_names}, actual={actual_names}"
    )


# ---------------------------------------------------------------------------
# Behavior 2: probe() is cached (idempotent within a session)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_probe_is_cached_idempotent(
    export_zip_transport: httpx.MockTransport,
    minio_creds: dict[str, str],
    patched_substrate_probes: None,
    stub_auth_minter: Callable[[str], Awaitable[str]],
    tmp_path: Path,
) -> None:
    """ADR-018 §4 — the session fixture invokes probe() exactly once.
    Subsequent calls return the same cached ProbeSummary instance."""
    async with httpx.AsyncClient(transport=export_zip_transport, base_url="http://test-backend.local") as http_client:
        orch = EjectAndTestOrchestrator(
            http_client=http_client,
            base_url="http://test-backend.local",
            minio_creds=minio_creds,
            auth_token_minter=stub_auth_minter,
        )

        first = await orch.probe(tmp_path=tmp_path)
        second = await orch.probe(tmp_path=tmp_path)

    assert first is second, (
        "probe() must cache and return the same ProbeSummary instance on "
        "repeat calls; ADR-018 §4 'invoked once per pytest session'"
    )


# ---------------------------------------------------------------------------
# Behavior 3: eject_and_test happy path returns EjectTestReport
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_eject_and_test_happy_path_returns_eject_test_report(
    export_zip_transport: httpx.MockTransport,
    minio_creds: dict[str, str],
    stub_auth_minter: Callable[[str], Awaitable[str]],
    tmp_path: Path,
) -> None:
    """eject_and_test fetches zip -> unzips -> seeds profile -> runs dbt
    deps/build/test -> parses -> returns an EjectTestReport. The fixture
    project has one trivial model and zero tests, so the report has at
    least one model_built recorded; status is 'pass' since no test failed.

    Crucially, this also exercises the parse-profile-from-dbt_project.yml
    path: the fixture's profile name is project-specific (mirrors the real
    exporter's `dataset_staging_<ULID>` shape) and the seeder's profiles.yml
    must be written under THAT name for `dbt build` to find it.
    """
    async with httpx.AsyncClient(transport=export_zip_transport, base_url="http://test-backend.local") as http_client:
        orch = EjectAndTestOrchestrator(
            http_client=http_client,
            base_url="http://test-backend.local",
            minio_creds=minio_creds,
            auth_token_minter=stub_auth_minter,
        )

        report = await orch.eject_and_test(project_id="proj-001", tmp_path=tmp_path)

    assert isinstance(report, EjectTestReport), f"expected EjectTestReport; got {type(report).__name__}"
    # Trivial project -> no tests fail; status is 'pass'. (Empty-tests case is
    # 'pass' per parser.py: `status = "pass" if not all_failures else "fail"`.)
    assert report.status == "pass", (
        f"trivial fixture project should pass; got status={report.status!r}, failures={report.failures!r}"
    )
    # The fixture model 'hello' should have been built — surface it for
    # diagnostic context (and to prove the build phase actually ran, not
    # just returned a default-empty report).
    assert any("hello" in name for name in report.models_built), (
        f"expected the fixture 'hello' model in models_built; got models_built={report.models_built!r}"
    )


@pytest.mark.asyncio
async def test_eject_and_test_raises_when_dbt_project_yml_has_no_profile_key(
    minio_creds: dict[str, str],
    stub_auth_minter: Callable[[str], Awaitable[str]],
    tmp_path: Path,
) -> None:
    """Substrate-gap defence: if the exported ``dbt_project.yml`` is missing
    the ``profile:`` key the seeder cannot synthesize a name for it — dbt
    would fail at build time with a confusing 'Could not find profile' error.
    The orchestrator MUST detect this gap and raise a clear RuntimeError
    naming the missing key, BEFORE invoking the runner."""
    no_profile_zip = _build_fixture_dbt_zip_without_profile()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=no_profile_zip,
            headers={"Content-Type": "application/zip"},
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://test-backend.local") as http_client:
        orch = EjectAndTestOrchestrator(
            http_client=http_client,
            base_url="http://test-backend.local",
            minio_creds=minio_creds,
            auth_token_minter=stub_auth_minter,
        )

        with pytest.raises(RuntimeError) as exc_info:
            await orch.eject_and_test(project_id="proj-broken", tmp_path=tmp_path)

    assert "profile" in str(exc_info.value).lower(), (
        f"RuntimeError must name the missing 'profile' key — substrate-lie defence; got: {exc_info.value!r}"
    )


# ---------------------------------------------------------------------------
# Behavior 4: EjectOrchestratorProtocol runtime_checkable conformance
# ---------------------------------------------------------------------------


def test_orchestrator_implements_eject_orchestrator_protocol(
    minio_creds: dict[str, str],
) -> None:
    """ADR-018 D5 — the orchestrator MUST conform structurally to
    EjectOrchestratorProtocol so the 'lite orchestrator without a probe'
    failure mode is caught at construction time."""
    # We can build the orchestrator without any HTTP traffic for this check —
    # constructor wires the deps; protocol conformance is structural.
    transport = httpx.MockTransport(lambda req: httpx.Response(200))
    client = httpx.AsyncClient(transport=transport, base_url="http://test.local")
    try:
        orch = EjectAndTestOrchestrator(
            http_client=client,
            base_url="http://test.local",
            minio_creds=minio_creds,
        )
        assert isinstance(orch, EjectOrchestratorProtocol), (
            "EjectAndTestOrchestrator must conform to EjectOrchestratorProtocol "
            "(declares probe() and eject_and_test()) — the runtime_checkable "
            "subtype guard from ADR-018 D5"
        )
    finally:
        # Close synchronously — we never opened transport pool entries.
        # AsyncClient.aclose isn't required for MockTransport-only paths.
        pass


# ---------------------------------------------------------------------------
# Behavior 5: orchestrator.py does NOT allocate its own tempdir
# ---------------------------------------------------------------------------


def test_orchestrator_does_not_create_tempdir_internally() -> None:
    """The caller (pytest fixture or composition root) supplies tmp_path.
    The orchestrator must NOT call tempfile.mkdtemp() or
    tempfile.TemporaryDirectory() itself — that would side-step pytest's
    per-test cleanup contract and obscure where artefacts live."""
    orchestrator_path = (
        Path(__file__).resolve().parents[1] / "integration" / "dataset_layer" / "eject" / "orchestrator.py"
    )
    tree = ast.parse(orchestrator_path.read_text())

    offenders: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == "tempfile" or alias.name.startswith("tempfile."):
                    offenders.append(f"import {alias.name}")
        elif isinstance(node, ast.ImportFrom) and (
            node.module == "tempfile" or (node.module and node.module.startswith("tempfile."))
        ):
            offenders.append(f"from {node.module} import ...")
        # Catch tempfile.mkdtemp() / tempfile.TemporaryDirectory() even if
        # `tempfile` is imported transitively through another module.
        elif (
            isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id == "tempfile"
            and node.attr in {"mkdtemp", "TemporaryDirectory"}
        ):
            offenders.append(f"tempfile.{node.attr}")

    assert not offenders, (
        f"orchestrator.py must not allocate its own tmpdir; the caller "
        f"(pytest tmp_path / session fixture) controls it. Found: {offenders}"
    )
