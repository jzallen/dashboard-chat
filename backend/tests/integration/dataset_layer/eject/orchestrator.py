"""Eject-and-test orchestrator — composes probes + seeder + runner + parser.

ADR-018, Option β. The orchestrator owns the per-flow validation cycle:
    fetch zip -> unzip into tmpdir -> seed profile -> dbtRunner.invoke(deps)
    -> .invoke(build) -> .invoke(test) -> RunResultsParser.parse()

Composition-root invariant (ADR-018 §4): the orchestrator is constructed
ONLY by the session-scoped ``eject_orchestrator`` pytest fixture (step
00-08), which invokes ``probe()`` exactly once before any flow uses it.
Probe failure converts to ``pytest.skip(reason)`` with the failing probe
NAMED — silent-green is impossible by construction.

Architectural enforcement (ADR-018 D5, §11):
    - ``EjectOrchestratorProtocol`` (protocols.py) — subtype layer
    - pytest-archon rule — structural layer
    - CI behavioral test (uninstall dbt-core, expect named probe skip)
"""

from __future__ import annotations

import textwrap
import zipfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx

from . import probe as probe_module
from .parser import EjectTestReport, RunResultsParser
from .probe import ProbeReport
from .runner import DbtRunner
from .seeder import DuckDBProfileSeeder

# ---------------------------------------------------------------------------
# Aggregate report — the 5 individual ProbeReports rolled up for the session
# fixture. Per Step 00-05 author's note: ProbeReport is per-probe; the
# orchestrator owns the aggregate type.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ProbeSummary:
    """Aggregate of the 5 earned-trust probe results.

    ``ok`` is True iff every probe reported ``ok=True``. The session
    fixture (step 00-08) reads ``ok``; if False it composes a ``pytest.skip``
    message naming each failing probe via ``failures``.
    """

    ok: bool
    reports: list[ProbeReport]
    failures: list[ProbeReport]


# ---------------------------------------------------------------------------
# Constants — fixture probe project name + minimal model. Mirrors
# tests/unit/test_dbt_runner.py's _write_probe_project shape.
# ---------------------------------------------------------------------------

_PROBE_PROJECT_NAME = "probe"
_PROBE_FIXTURE_KEY_DEFAULT = "probe/fixture.parquet"

_PROBE_DBT_PROJECT_YML = textwrap.dedent(
    """\
    name: 'probe'
    version: '1.0.0'
    config-version: 2
    profile: 'probe'
    model-paths: ["models"]
    """
)
_PROBE_PROFILES_YML = textwrap.dedent(
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
_PROBE_MODEL_SQL = "select 1 as one"


class EjectAndTestOrchestrator:
    """Per-flow customer-fidelity validation orchestrator.

    Wires:
        * httpx.AsyncClient (existing harness convention) for fetching the
          export zip.
        * DuckDBProfileSeeder for rewriting profiles.yml with concrete
          MinIO credentials (substitutes the env_var(...) placeholders the
          backend export emits).
        * DbtRunner for in-process dbt deps/build/test sequencing.
        * RunResultsParser for translating dbtRunnerResult into
          EjectTestReport.

    The orchestrator does NOT allocate its own tmpdir. Callers supply
    ``tmp_path`` (pytest fixture in unit tests; session-scoped tmp_path_factory
    in step 00-08's harness fixture). This keeps artefact lifetimes under
    pytest's control.
    """

    def __init__(
        self,
        http_client: httpx.AsyncClient,
        base_url: str,
        minio_creds: dict[str, str],
        project_id: str | None = None,
    ) -> None:
        self._http_client = http_client
        self._base_url = base_url.rstrip("/")
        self._minio_creds = minio_creds
        self._project_id = project_id
        self._probe_cache: ProbeSummary | None = None
        self._seeder = DuckDBProfileSeeder()
        self._runner = DbtRunner()
        self._parser = RunResultsParser()

    # ------------------------------------------------------------------
    # probe() — earned-trust contract (ADR-018 §4)
    # ------------------------------------------------------------------

    async def probe(self, tmp_path: Path) -> ProbeSummary:
        """Run the 5 earned-trust probes once and aggregate the results.

        Cached after the first call within a session — subsequent calls
        return the same ``ProbeSummary`` instance. ``tmp_path`` is used to
        stage a tiny fixture dbt project for ``probe_run_results_shape``
        and to seed a profile for ``probe_minio_readable_via_duckdb``.

        On any probe failure, ``ok`` is False and ``failures`` lists each
        offending ``ProbeReport`` (with ``name`` greppable from CI logs).
        The session fixture (step 00-08) translates failure to
        ``pytest.skip`` with the failing-probe name in the reason.
        """
        if self._probe_cache is not None:
            return self._probe_cache

        reports: list[ProbeReport] = []

        # Probe 1: dbt-core importable + version >= 1.8 (pure import).
        reports.append(probe_module.probe_dbt_runner_importable())

        # Probe 2: dbt-duckdb adapter importable (pure import).
        reports.append(probe_module.probe_dbt_duckdb_loadable())

        # Probe 3: export endpoint reachable. The probe takes a sync
        # httpx.Client; build one bound to the same base_url. In-test the
        # caller monkeypatches this probe so the real client is never
        # created.
        reports.append(self._invoke_export_probe())

        # Probe 4: MinIO readable via DuckDB httpfs. Needs a seeded profile
        # and a fixture parquet key in the bucket.
        reports.append(self._invoke_minio_probe(tmp_path))

        # Probe 5: dbtRunnerResult shape contract. Needs a tiny fixture
        # dbt project — staged into tmp_path.
        reports.append(self._invoke_run_results_shape_probe(tmp_path))

        failures = [r for r in reports if not r.ok]
        summary = ProbeSummary(ok=not failures, reports=reports, failures=failures)
        self._probe_cache = summary
        return summary

    def _invoke_export_probe(self) -> ProbeReport:
        # Use the same project_id the orchestrator was wired with when
        # available; otherwise fall back to a sentinel that exercises the
        # endpoint shape. Either way the probe asserts 200/application-zip.
        probe_project_id = self._project_id or "probe"
        with httpx.Client(base_url=self._base_url) as sync_client:
            return probe_module.probe_export_endpoint_reachable(
                client=sync_client,
                base_url=self._base_url,
                project_id=probe_project_id,
            )

    def _invoke_minio_probe(self, tmp_path: Path) -> ProbeReport:
        probe_dir = tmp_path / "probe-profile"
        probe_dir.mkdir(parents=True, exist_ok=True)
        seeded_profile_path = self._seeder.seed(probe_dir, self._minio_creds)
        fixture_key = self._minio_creds.get("fixture_key", _PROBE_FIXTURE_KEY_DEFAULT)
        return probe_module.probe_minio_readable_via_duckdb(
            seeded_profile_path=seeded_profile_path,
            bucket=self._minio_creds["bucket"],
            fixture_key=fixture_key,
        )

    def _invoke_run_results_shape_probe(self, tmp_path: Path) -> ProbeReport:
        probe_dir = tmp_path / "probe-project"
        self._stage_probe_project(probe_dir)
        return probe_module.probe_run_results_shape(probe_project_dir=probe_dir)

    @staticmethod
    def _stage_probe_project(root: Path) -> None:
        """Stage a minimal dbt+duckdb project — same shape as test_dbt_runner.py."""
        models = root / "models"
        models.mkdir(parents=True, exist_ok=True)
        (root / "dbt_project.yml").write_text(_PROBE_DBT_PROJECT_YML)
        (root / "profiles.yml").write_text(_PROBE_PROFILES_YML)
        (models / "hello.sql").write_text(_PROBE_MODEL_SQL)

    # ------------------------------------------------------------------
    # eject_and_test() — the per-flow durable gate
    # ------------------------------------------------------------------

    async def eject_and_test(self, project_id: str, tmp_path: Path) -> EjectTestReport:
        """Drive one per-flow eject-and-test cycle for ``project_id``.

        Flow (ADR-018 §Decision Outcome step 3):
            1. GET ``/api/projects/{project_id}/export/dbt`` -> zip bytes
            2. Unzip into ``tmp_path / project_id``
            3. Seed ``profiles.yml`` with concrete MinIO credentials
            4. Run dbt ``deps`` -> ``build`` -> ``test`` via DbtRunner
            5. Parse the dbtRunnerResult into an EjectTestReport
        """
        zip_bytes = await self._fetch_zip(project_id)
        project_dir = self._unzip_project(zip_bytes, tmp_path / project_id)
        self._verify_expected_tree(project_dir)
        self._seeder.seed(project_dir, self._minio_creds)
        run_result = self._runner.run_build_and_test(str(project_dir))
        return self._parser.parse(run_result, project_dir=str(project_dir))

    async def _fetch_zip(self, project_id: str) -> bytes:
        url = f"{self._base_url}/api/projects/{project_id}/export/dbt"
        response = await self._http_client.get(url)
        response.raise_for_status()
        content_type = response.headers.get("Content-Type", "")
        if not content_type.startswith("application/zip"):
            raise RuntimeError(f"export endpoint returned Content-Type={content_type!r} (expected application/zip)")
        return response.content

    @staticmethod
    def _unzip_project(zip_bytes: bytes, target_dir: Path) -> Path:
        target_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(BytesIO(zip_bytes)) as zf:
            zf.extractall(target_dir)
        return target_dir

    @staticmethod
    def _verify_expected_tree(project_dir: Path) -> None:
        """Ensure the unzipped project has the load-bearing files."""
        for relative in ("dbt_project.yml", "models"):
            target = project_dir / relative
            if not target.exists():
                raise RuntimeError(f"unzipped project at {project_dir} missing expected entry: {relative!r}")


# Re-export the aggregate type for downstream callers.
__all__ = [
    "EjectAndTestOrchestrator",
    "ProbeSummary",
]


# Reserved kwargs hook for future tuning; keeps a stable signature surface
# even if the orchestrator grows optional knobs (timeout, retry, etc.) without
# breaking existing call sites.
def _accept_extra_kwargs(**_: Any) -> None:  # pragma: no cover — utility hook
    """No-op accepting arbitrary kwargs. Reserved for future expansion."""
