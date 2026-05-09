"""Earned-trust probes (ADR-018 §4) — happy-path implementation (step 00-05).

Per ADR-018 §4 (principle 12), the orchestrator's external dependencies
are five places the substrate can lie. Each probe forces an exercise of
the specific lie and reports through a per-probe ``ProbeReport``. The
orchestrator (step 00-06) composes the five into an aggregate report and
the session-scoped fixture converts any failure to ``pytest.skip(reason)``
with the failing probe NAMED — silent-green is impossible by construction.

Probes:
    1. probe_dbt_runner_importable      — dbt-core API present + version >= 1.8
    2. probe_dbt_duckdb_loadable        — dbt-duckdb adapter importable
    3. probe_export_endpoint_reachable  — backend export endpoint returns 200/zip
    4. probe_minio_readable_via_duckdb  — DuckDB httpfs can read s3://.../parquet
    5. probe_run_results_shape          — dbtRunner.invoke(['parse']) returns
                                           a ``dbtRunnerResult`` with the
                                           ``.success`` + ``.result`` attributes
                                           ``RunResultsParser`` (step 00-04) reads.

Failure-injection paths (each probe's ``ok=False`` branch with substrate
errors) are exercised by the scenario tests in distill Phase 1
(``milestone-3-earned-trust-probes.feature``). This module covers the
HAPPY-path implementation; the failure branches are ALSO present here
because every probe must convert exceptions into a structured
``ProbeReport`` rather than letting them bubble — the
``probe_export_endpoint_reachable`` probe, for instance, returns
``ok=False`` on any non-200 response so its scenario test can drive the
behaviour without needing a separate stub.
"""

from __future__ import annotations

from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

import httpx


@dataclass(frozen=True)
class ProbeReport:
    """Observable outcome of one probe run.

    ``ok`` is the binary outcome the orchestrator aggregates; ``name`` is
    the probe identifier (greppable from CI logs); ``reason`` carries
    diagnostic context — the detected version/URL/error message that lets
    a developer triage a substrate-lie failure without re-running the suite.

    On the happy path ``reason`` is non-empty and human-readable
    (e.g. ``"dbt-core 1.11.9"``). On failure it names the offending
    substrate condition (e.g. ``"dbt.cli.main not importable: ..."``).
    """

    name: str
    ok: bool
    reason: str


# ---------------------------------------------------------------------------
# Probe 1: dbt-core importable + version >= 1.8
# ---------------------------------------------------------------------------

_PROBE_DBT_RUNNER = "probe_dbt_runner_importable"
_MIN_DBT_CORE = (1, 8)


def probe_dbt_runner_importable() -> ProbeReport:
    """Verify ``dbt.cli.main.dbtRunner`` is importable and dbt-core >= 1.8."""
    try:
        from dbt.cli.main import dbtRunner  # noqa: F401 — import is the probe
    except Exception as exc:
        return ProbeReport(name=_PROBE_DBT_RUNNER, ok=False, reason=f"dbt.cli.main not importable: {exc!r}")

    try:
        detected = version("dbt-core")
    except PackageNotFoundError as exc:
        return ProbeReport(name=_PROBE_DBT_RUNNER, ok=False, reason=f"dbt-core not installed: {exc!r}")

    parsed = _parse_major_minor(detected)
    if parsed is None:
        return ProbeReport(
            name=_PROBE_DBT_RUNNER,
            ok=False,
            reason=f"dbt-core version unparseable: {detected!r}",
        )
    if parsed < _MIN_DBT_CORE:
        return ProbeReport(
            name=_PROBE_DBT_RUNNER,
            ok=False,
            reason=f"dbt-core {detected} < required {_MIN_DBT_CORE[0]}.{_MIN_DBT_CORE[1]}",
        )

    return ProbeReport(name=_PROBE_DBT_RUNNER, ok=True, reason=f"dbt-core {detected}")


# ---------------------------------------------------------------------------
# Probe 2: dbt-duckdb adapter importable
# ---------------------------------------------------------------------------

_PROBE_DBT_DUCKDB = "probe_dbt_duckdb_loadable"


def probe_dbt_duckdb_loadable() -> ProbeReport:
    """Verify ``dbt.adapters.duckdb`` is importable."""
    try:
        from dbt.adapters import duckdb as _duckdb_adapter  # noqa: F401
    except Exception as exc:
        return ProbeReport(
            name=_PROBE_DBT_DUCKDB,
            ok=False,
            reason=f"dbt.adapters.duckdb not importable: {exc!r}",
        )

    try:
        detected = version("dbt-duckdb")
    except PackageNotFoundError:
        # Adapter imports but package metadata missing is unusual but not fatal —
        # we have proof of import; report the import-success.
        detected = "unknown"

    return ProbeReport(name=_PROBE_DBT_DUCKDB, ok=True, reason=f"dbt-duckdb {detected}")


# ---------------------------------------------------------------------------
# Probe 3: export endpoint reachable (200 + application/zip)
# ---------------------------------------------------------------------------

_PROBE_EXPORT = "probe_export_endpoint_reachable"
_EXPECTED_CONTENT_TYPE = "application/zip"


def probe_export_endpoint_reachable(
    client: httpx.Client,
    base_url: str,
    project_id: str,
    auth_token: str | None = None,
) -> ProbeReport:
    """Issue a GET against the export endpoint and verify the substrate is
    truthful: endpoint reachable, auth works, app code ran.

    Both outcomes prove the substrate is honest:

    * ``200 application/zip`` — the project exists and the export pipeline
      produced a zip end-to-end.
    * ``404`` — the project does not exist, but the request reached the
      backend, the auth layer accepted the bearer token, and the app
      mapped the domain exception to a structured Problem-Details
      response. (See ``app.main.domain_exception_handler`` — without it
      this branch returns 500 and the probe must reject.)

    Rejected as substrate failures: ``401``/``403`` (auth broken),
    ``5xx`` (app broken), and connection errors. ``ok=False`` carries the
    offending status code in ``reason`` so a CI log reader can triage.

    The probe uses the caller-supplied ``client`` so unit tests can pass a
    ``httpx.MockTransport`` while the orchestrator's session fixture
    (step 00-06) supplies a real ``httpx.Client`` against the live backend.

    ``auth_token`` is the bearer token forwarded as
    ``Authorization: Bearer <token>``. The orchestrator mints a dev JWT
    once per session via ``AuthApi.fetch_dev_user_jwt`` and passes it in
    here. Tests that don't exercise the auth path may omit it.
    """
    # Path mirrors EjectAndTestOrchestrator._fetch_zip — the probe MUST hit
    # the same endpoint the per-flow cycle uses, otherwise it can pass
    # against a substrate that would later 404 on the real eject path.
    url = f"{base_url.rstrip('/')}/api/projects/{project_id}/export/dbt"
    headers = {"Authorization": f"Bearer {auth_token}"} if auth_token else None
    try:
        response = client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        return ProbeReport(name=_PROBE_EXPORT, ok=False, reason=f"export endpoint unreachable: {exc!r}")

    status = response.status_code

    # 200 + application/zip — full happy path (project exists, export ran).
    if status == 200:
        content_type = response.headers.get("Content-Type", "")
        # tolerate "application/zip; charset=..."  forms — only the prefix matters
        if not content_type.startswith(_EXPECTED_CONTENT_TYPE):
            return ProbeReport(
                name=_PROBE_EXPORT,
                ok=False,
                reason=(
                    f"export endpoint returned Content-Type={content_type!r} (expected {_EXPECTED_CONTENT_TYPE!r})"
                ),
            )
        return ProbeReport(name=_PROBE_EXPORT, ok=True, reason=f"GET {url} -> 200 {content_type}")

    # 404 — project missing but app code ran end-to-end. This is acceptable
    # substrate proof: the endpoint is wired, the auth layer accepted the
    # bearer token, and the global DomainException handler mapped the
    # exception to a structured response. The orchestrator uses a sentinel
    # project_id that is not expected to exist in a fresh compose stack.
    if status == 404:
        return ProbeReport(
            name=_PROBE_EXPORT,
            ok=True,
            reason=(
                f"GET {url} -> 404 (endpoint reachable; project_id "
                f"{project_id!r} not found -- acceptable substrate proof)"
            ),
        )

    # Anything else: auth broken (401/403), app broken (5xx), redirects, etc.
    return ProbeReport(
        name=_PROBE_EXPORT,
        ok=False,
        reason=f"export endpoint returned {status} (expected 200 or 404)",
    )


# ---------------------------------------------------------------------------
# Probe 4: DuckDB httpfs can read s3://<bucket>/<key>
# ---------------------------------------------------------------------------

_PROBE_MINIO = "probe_minio_readable_via_duckdb"


def probe_minio_readable_via_duckdb(
    seeded_profile_path: Path,
    bucket: str,
    fixture_key: str,
) -> ProbeReport:
    """Bootstrap a canary parquet via DuckDB httpfs ``COPY``, then read it back.

    ``seeded_profile_path`` is the ``profiles.yml`` produced by
    :class:`tests.integration.dataset_layer.eject.seeder.DuckDBProfileSeeder`
    in step 00-02. The probe parses the s3 settings out of the profile,
    configures DuckDB's httpfs extension with them, then:

    1. Writes ``s3://<bucket>/<fixture_key>`` with a single canary row
       (``COPY (SELECT 1 AS canary) TO ... (FORMAT PARQUET)``).
    2. Reads it back via ``SELECT count(*) FROM read_parquet(...)`` and
       verifies the count is 1.

    Both write AND read must succeed for ``ok=True``. Approach A from
    the dbt-test-validation Phase-0 hotfix: assuming a pre-existing
    fixture file is fragile (MinIO starts empty); bootstrapping at probe
    time exercises the full round-trip the eject-then-test flow needs.
    Mocking httpfs would test our wrapper, not the substrate.
    """
    try:
        import duckdb
    except Exception as exc:
        return ProbeReport(name=_PROBE_MINIO, ok=False, reason=f"duckdb not importable: {exc!r}")

    try:
        s3_config = _read_s3_config(seeded_profile_path)
    except Exception as exc:
        return ProbeReport(
            name=_PROBE_MINIO,
            ok=False,
            reason=f"could not parse seeded profile {seeded_profile_path}: {exc!r}",
        )

    s3_uri = f"s3://{bucket}/{fixture_key}"
    try:
        conn = duckdb.connect(":memory:")
        try:
            conn.execute("INSTALL httpfs")
            conn.execute("LOAD httpfs")
            conn.execute(f"SET s3_endpoint='{s3_config['endpoint']}'")
            conn.execute(f"SET s3_region='{s3_config['region']}'")
            conn.execute(f"SET s3_access_key_id='{s3_config['access_key']}'")
            conn.execute(f"SET s3_secret_access_key='{s3_config['secret_key']}'")
            conn.execute("SET s3_use_ssl=false")
            conn.execute("SET s3_url_style='path'")
            # Bootstrap: write a 1-row canary parquet. OVERWRITE makes the
            # probe idempotent across repeated session-fixture runs.
            try:
                conn.execute(f"COPY (SELECT 1 AS canary) TO '{s3_uri}' (FORMAT PARQUET, OVERWRITE_OR_IGNORE)")
            except Exception as write_exc:
                return ProbeReport(
                    name=_PROBE_MINIO,
                    ok=False,
                    reason=f"DuckDB could not write canary to {s3_uri}: {write_exc!r}",
                )
            row = conn.execute(f"SELECT count(*) FROM read_parquet('{s3_uri}')").fetchone()
        finally:
            conn.close()
    except Exception as exc:
        return ProbeReport(
            name=_PROBE_MINIO,
            ok=False,
            reason=f"DuckDB could not read {s3_uri}: {exc!r}",
        )

    count = row[0] if row else 0
    if count != 1:
        return ProbeReport(
            name=_PROBE_MINIO,
            ok=False,
            reason=f"DuckDB read {s3_uri} returned {count} rows (expected 1 canary row)",
        )
    return ProbeReport(name=_PROBE_MINIO, ok=True, reason=f"DuckDB write+read {s3_uri} ok (1 canary row)")


def _read_s3_config(profile_path: Path) -> dict[str, str]:
    """Pull the s3 settings out of the seeded profiles.yml.

    Mirrors :class:`DuckDBProfileSeeder` output keys: ``s3_endpoint``,
    ``s3_region``, ``s3_access_key_id``, ``s3_secret_access_key``.
    """
    import yaml

    payload = yaml.safe_load(profile_path.read_text())
    # The seeder writes a single top-level project entry; pull its dev output.
    project_block = next(iter(payload.values()))
    dev = project_block["outputs"]["dev"]
    return {
        "endpoint": dev["s3_endpoint"],
        "region": dev["s3_region"],
        "access_key": dev["s3_access_key_id"],
        "secret_key": dev["s3_secret_access_key"],
    }


# ---------------------------------------------------------------------------
# Probe 5: dbtRunner.invoke(['parse']) shape contract
# ---------------------------------------------------------------------------

_PROBE_RUN_RESULTS_SHAPE = "probe_run_results_shape"


def probe_run_results_shape(probe_project_dir: Path) -> ProbeReport:
    """Invoke ``dbt parse`` on an embedded probe project and verify the
    ``dbtRunnerResult`` exposes the attribute surface that
    :class:`RunResultsParser` (step 00-04) reads off it.

    Specifically: ``.success`` is a boolean and ``.result`` is non-None
    (parse returns a Manifest). When dbt 1.x changes that contract, this
    probe fails LOUDLY and the failing-probe name surfaces in the skip
    reason — exactly the upgrade-time signal ADR-018 §References calls
    out (``dbtRunnerResult.result is "not fully contracted"``).
    """
    try:
        from dbt.cli.main import dbtRunner
    except Exception as exc:
        return ProbeReport(
            name=_PROBE_RUN_RESULTS_SHAPE,
            ok=False,
            reason=f"dbt.cli.main not importable: {exc!r}",
        )

    try:
        runner = dbtRunner()
        result = runner.invoke(
            [
                "parse",
                "--project-dir",
                str(probe_project_dir),
                "--profiles-dir",
                str(probe_project_dir),
            ]
        )
    except Exception as exc:
        # Includes the pyarrow_hotfix gap flagged by step 00-01 — surface
        # it loudly rather than papering over it.
        return ProbeReport(
            name=_PROBE_RUN_RESULTS_SHAPE,
            ok=False,
            reason=f"dbtRunner.invoke(['parse']) raised: {exc!r}",
        )

    if not hasattr(result, "success"):
        return ProbeReport(
            name=_PROBE_RUN_RESULTS_SHAPE,
            ok=False,
            reason="dbtRunnerResult missing .success attribute",
        )
    if not isinstance(result.success, bool):
        return ProbeReport(
            name=_PROBE_RUN_RESULTS_SHAPE,
            ok=False,
            reason=f"dbtRunnerResult.success is {type(result.success).__name__}, expected bool",
        )
    if result.success is not True:
        return ProbeReport(
            name=_PROBE_RUN_RESULTS_SHAPE,
            ok=False,
            reason=f"dbt parse returned success=False; exception={getattr(result, 'exception', None)!r}",
        )
    if not hasattr(result, "result"):
        return ProbeReport(
            name=_PROBE_RUN_RESULTS_SHAPE,
            ok=False,
            reason="dbtRunnerResult missing .result attribute",
        )
    if result.result is None:
        return ProbeReport(
            name=_PROBE_RUN_RESULTS_SHAPE,
            ok=False,
            reason="dbtRunnerResult.result is None for parse (expected Manifest)",
        )

    return ProbeReport(
        name=_PROBE_RUN_RESULTS_SHAPE,
        ok=True,
        reason=f"dbt parse returned dbtRunnerResult(success=True, result={type(result.result).__name__})",
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _parse_major_minor(version_str: str) -> tuple[int, int] | None:
    """Parse ``"1.11.9"`` -> ``(1, 11)``; tolerate trailing pre-release suffixes.

    Returns ``None`` if the leading two components are not integers.
    """
    parts = version_str.split(".")
    if len(parts) < 2:
        return None
    try:
        return (int(parts[0]), int(parts[1]))
    except ValueError:
        return None


# Re-export the kwargs-tolerant signature for symmetry with the orchestrator
# scaffold's keyword-argument style; positional callers (like our unit tests)
# work as-is. Not strictly necessary, but kept for forward-compat.
__all__ = [
    "ProbeReport",
    "probe_dbt_duckdb_loadable",
    "probe_dbt_runner_importable",
    "probe_export_endpoint_reachable",
    "probe_minio_readable_via_duckdb",
    "probe_run_results_shape",
]


# Reserved kwargs hook for future tuning; keeps a stable signature surface
# even if probes grow optional knobs (timeout, retry, etc.) without breaking
# existing call sites.
def _accept_extra_kwargs(**_: Any) -> None:  # pragma: no cover — utility hook
    """No-op accepting arbitrary kwargs. Reserved for future expansion."""
