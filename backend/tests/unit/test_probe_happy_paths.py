"""Unit tests for the five earned-trust probes (step 00-05, ADR-018 §4).

Driving port: each probe is a module-level pure function whose signature
is its public interface (paradigm DWD-7). Tests call the function
directly and assert observable outcome (`report.ok is True`, name correct).

Test design (TDD-discipline, hexagonal-testing F-001):
    - probe_dbt_runner_importable / probe_dbt_duckdb_loadable / probe_run_results_shape:
      exercise the REAL substrate. The whole point of these probes is to
      detect when the substrate lies; mocking would test our wrapper, not
      the substrate.
    - probe_export_endpoint_reachable: uses httpx.MockTransport to stub a
      200/application/zip response. The integration scenario in distill
      Phase 1 will exercise the real backend export endpoint.
    - probe_minio_readable_via_duckdb: skips when MinIO env vars are
      absent (precedent: backend/tests/integration/test_lake_preview_live.py).
      When present, runs against real DuckDB httpfs reading real S3.

Test budget: 5 distinct behaviors x 2 = 10. Using 5.

Failure-injection paths (each probe's ok=False branch) are deferred to
distill Phase 1 (`milestone-3-earned-trust-probes.feature`). This step
covers HAPPY paths only.
"""

from __future__ import annotations

import io
import os
import textwrap
import zipfile
from pathlib import Path

import httpx
import pytest

from tests.integration.dataset_layer.eject.probe import (
    ProbeReport,
    probe_dbt_duckdb_loadable,
    probe_dbt_runner_importable,
    probe_export_endpoint_reachable,
    probe_minio_readable_via_duckdb,
    probe_run_results_shape,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_minimal_dbt_project(root: Path) -> None:
    """Stage a minimal dbt+duckdb (in-memory) project at `root`.

    Same shape as backend/tests/unit/test_dbt_runner.py's `_write_probe_project`,
    but we keep them local-scoped — there is no shared fixture module yet and
    the duplication is small enough not to warrant introducing one.
    """
    (root / "models").mkdir(parents=True, exist_ok=True)
    (root / "dbt_project.yml").write_text(
        textwrap.dedent(
            """\
            name: 'probe'
            version: '1.0.0'
            config-version: 2
            profile: 'probe'
            model-paths: ["models"]
            """
        )
    )
    (root / "profiles.yml").write_text(
        textwrap.dedent(
            """\
            probe:
              target: dev
              outputs:
                dev:
                  type: duckdb
                  path: ":memory:"
                  threads: 1
            """
        )
    )
    (root / "models" / "hello.sql").write_text("select 1 as one")


def _build_zip_bytes() -> bytes:
    """Tiny but valid zip — body the export endpoint contract returns."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("dbt_project.yml", "name: probe\nversion: 1.0.0\n")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Behavior 1: probe_dbt_runner_importable — real dbt-core import + version
# ---------------------------------------------------------------------------


def test_probe_dbt_runner_importable_returns_ok_on_real_dbt_core() -> None:
    """Given dbt-core >= 1.8 installed in the test env (per 00-01 extras),
    the probe imports `dbt.cli.main.dbtRunner` and returns ok=True with the
    detected version surfaced in `reason`."""
    report = probe_dbt_runner_importable()

    assert isinstance(report, ProbeReport)
    assert report.ok is True, f"expected ok=True; got reason={report.reason!r}"
    assert report.name == "probe_dbt_runner_importable"
    # On the happy path the reason carries diagnostic context (the detected
    # dbt-core version), not "" — the caller logs this for greppable CI lines.
    assert "1." in report.reason, f"expected dbt-core version in reason; got {report.reason!r}"


# ---------------------------------------------------------------------------
# Behavior 2: probe_dbt_duckdb_loadable — real adapter import
# ---------------------------------------------------------------------------


def test_probe_dbt_duckdb_loadable_returns_ok_on_real_adapter() -> None:
    """Given dbt-duckdb installed in the test env (per 00-01 extras), the
    probe imports `dbt.adapters.duckdb` and returns ok=True."""
    report = probe_dbt_duckdb_loadable()

    assert isinstance(report, ProbeReport)
    assert report.ok is True, f"expected ok=True; got reason={report.reason!r}"
    assert report.name == "probe_dbt_duckdb_loadable"


# ---------------------------------------------------------------------------
# Behavior 3: probe_export_endpoint_reachable — 200 + application/zip
# ---------------------------------------------------------------------------


def test_probe_export_endpoint_reachable_returns_ok_on_200_application_zip() -> None:
    """Given a stub HTTP transport returning 200 with application/zip, the
    probe issues a GET against the export endpoint and reports ok=True."""

    def handler(request: httpx.Request) -> httpx.Response:
        # The probe should hit the export endpoint shape used by the
        # orchestrator; we don't assert the exact path (that's an
        # implementation detail of the orchestrator wiring) — just that it
        # made a GET request.
        assert request.method == "GET", f"probe should issue GET; saw {request.method}"
        return httpx.Response(
            200,
            content=_build_zip_bytes(),
            headers={"Content-Type": "application/zip"},
        )

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport, base_url="http://test-backend.local")

    report = probe_export_endpoint_reachable(
        client=client,
        base_url="http://test-backend.local",
        project_id="proj-123",
    )

    assert isinstance(report, ProbeReport)
    assert report.ok is True, f"expected ok=True; got reason={report.reason!r}"
    assert report.name == "probe_export_endpoint_reachable"


def test_probe_export_endpoint_reachable_forwards_auth_token_when_provided() -> None:
    """Given an ``auth_token`` kwarg, the probe sends ``Authorization: Bearer <token>``
    on the GET request. Without auth, the auth-proxy returns 401 and the
    probe reports ``ok=False`` — this test pins the behaviour that the
    orchestrator's lazily-minted dev JWT actually reaches the wire."""
    seen_authorization: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_authorization.append(request.headers.get("Authorization"))
        return httpx.Response(
            200,
            content=_build_zip_bytes(),
            headers={"Content-Type": "application/zip"},
        )

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport, base_url="http://test-backend.local")

    report = probe_export_endpoint_reachable(
        client=client,
        base_url="http://test-backend.local",
        project_id="proj-123",
        auth_token="dev-jwt-abc",
    )

    assert report.ok is True, f"expected ok=True; got reason={report.reason!r}"
    assert seen_authorization == ["Bearer dev-jwt-abc"], (
        f"expected single GET with Bearer header; saw {seen_authorization!r}"
    )


# ---------------------------------------------------------------------------
# Behavior 4: probe_minio_readable_via_duckdb — real DuckDB httpfs
# ---------------------------------------------------------------------------


def _minio_substrate_available() -> bool:
    """Mirror of backend/tests/integration/test_lake_preview_live.py gate.

    We require an explicit opt-in env var (`MINIO_TEST_BUCKET_AVAILABLE=1`)
    AND the credentials. Defaulting to skip in unconfigured environments
    matches the existing live-substrate precedent in the repo.
    """
    if os.environ.get("MINIO_TEST_BUCKET_AVAILABLE") != "1":
        return False
    return bool(os.environ.get("MINIO_ACCESS_KEY"))


@pytest.mark.skipif(
    not _minio_substrate_available(),
    reason="MinIO substrate not configured (set MINIO_TEST_BUCKET_AVAILABLE=1 and MINIO_ACCESS_KEY)",
)
def test_probe_minio_readable_via_duckdb_returns_ok_when_substrate_present(tmp_path: Path) -> None:
    """Given a live MinIO with a fixture parquet, the probe opens a fresh
    DuckDB connection, installs+loads httpfs, and successfully reads the
    parquet — returning ok=True. Mocking httpfs would test our wrapper,
    not the substrate; the probe's whole purpose is to detect substrate
    lies, so we exercise the real S3 read."""
    from tests.integration.dataset_layer.eject.seeder import DuckDBProfileSeeder

    minio_creds = {
        "endpoint_url": os.environ.get("MINIO_ENDPOINT", "http://localhost:9000"),
        "access_key": os.environ["MINIO_ACCESS_KEY"],
        "secret_key": os.environ.get("MINIO_SECRET_KEY", ""),
        "bucket": os.environ.get("MINIO_TEST_BUCKET", "dashboard-chat.datalake"),
        "region": os.environ.get("MINIO_REGION", "us-east-1"),
    }
    seeded_profile_path = DuckDBProfileSeeder().seed(tmp_path, minio_creds)
    fixture_key = os.environ.get("MINIO_TEST_FIXTURE_KEY", "probe/fixture.parquet")

    report = probe_minio_readable_via_duckdb(
        seeded_profile_path=seeded_profile_path,
        bucket=minio_creds["bucket"],
        fixture_key=fixture_key,
    )

    assert isinstance(report, ProbeReport)
    assert report.ok is True, f"expected ok=True; got reason={report.reason!r}"
    assert report.name == "probe_minio_readable_via_duckdb"


# ---------------------------------------------------------------------------
# Behavior 5: probe_run_results_shape — dbtRunner.invoke(['parse']) shape
# ---------------------------------------------------------------------------


def test_probe_run_results_shape_returns_ok_for_minimal_dbt_parse(tmp_path: Path) -> None:
    """Given a minimal embedded dbt project, the probe invokes
    `dbtRunner().invoke(['parse', ...])` and asserts the returned
    `dbtRunnerResult` exposes the attributes RunResultsParser depends on
    (`.success` boolean and `.result` not None)."""
    _write_minimal_dbt_project(tmp_path)

    report = probe_run_results_shape(probe_project_dir=tmp_path)

    assert isinstance(report, ProbeReport)
    assert report.ok is True, f"expected ok=True; got reason={report.reason!r}"
    assert report.name == "probe_run_results_shape"
