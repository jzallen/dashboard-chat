"""Eject-and-test orchestrator — composes probes + seeder + runner + parser.

ADR-019, Option β. The orchestrator owns the per-flow validation cycle:
    fetch zip -> unzip into tmpdir -> seed profile -> dbtRunner.invoke(deps)
    -> .invoke(build) -> .invoke(test) -> RunResultsParser.parse()

Composition-root invariant (ADR-019 §4): the orchestrator is constructed
ONLY by the session-scoped ``eject_orchestrator`` pytest fixture (step
00-08), which invokes ``probe()`` exactly once before any flow uses it.
Probe failure converts to ``pytest.skip(reason)`` with the failing probe
NAMED — silent-green is impossible by construction.

Architectural enforcement (ADR-019 D5, §11):
    - ``EjectOrchestratorProtocol`` (protocols.py) — subtype layer
    - pytest-archon rule — structural layer
    - CI behavioral test (uninstall dbt-core, expect named probe skip)

Ingress invariant (ADR-016, milestone-4 protocol assertion): every HTTP
request the orchestrator makes — both the earned-trust export probe and
the per-flow ``_fetch_zip`` — resolves through ``self._base_url``, which
the session fixture wires from ``AUTH_PROXY_URL`` (the auth-proxy
ingress). The orchestrator NEVER dials the backend's internal port
directly. Single point of resolution: ``url = f"{self._base_url}/..."``
in ``_fetch_zip`` (and the equivalent in ``_invoke_export_probe``). This
keeps test-time substrate identical to production-fidelity ingress; the
acceptance suite's milestone-4 scenario asserts on the resulting URL to
catch regressions where a future contributor introduces a backend-direct
shortcut.
"""

from __future__ import annotations

import contextlib
import os
import textwrap
import zipfile
from collections.abc import Awaitable, Callable, Iterator
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx
import yaml

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


@contextlib.contextmanager
def _exported_env(updates: dict[str, str]) -> Iterator[None]:
    """Temporarily set ``os.environ`` keys; restore prior state on exit.

    dbt evaluates Jinja ``env_var(...)`` calls at parse time by reading
    ``os.environ`` of the running Python process. Because ``dbtRunner``
    runs in-process (ADR-019 D9), the harness process's environment is
    what dbt sees — the seeded ``profiles.yml`` covers the s3_* profile
    fields, but ``sources.yml`` still references env_var('S3_BUCKET'),
    so without this wrapper dbt parse fails with "Env var required but
    not provided: 'S3_BUCKET'".

    Restore-on-exit is critical: pytest reuses the harness process across
    tests; leaking S3_* into a subsequent test that doesn't expect them
    would be a worse failure mode than the one we're fixing.
    """
    original: dict[str, str | None] = {k: os.environ.get(k) for k in updates}
    try:
        for k, v in updates.items():
            os.environ[k] = v
        yield
    finally:
        for k, prior in original.items():
            if prior is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = prior


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
        auth_token_minter: Callable[[str], Awaitable[str]] | None = None,
    ) -> None:
        self._http_client = http_client
        self._base_url = base_url.rstrip("/")
        self._minio_creds = minio_creds
        self._project_id = project_id
        self._probe_cache: ProbeSummary | None = None
        # Auth state — lazily minted on first probe() call. The auth-proxy
        # gates /api/projects/{id}/export/dbt; the orchestrator owns the
        # session-lived dev JWT so the per-flow eject_and_test path and
        # the earned-trust probe can both authenticate the same way.
        # ``auth_token_minter`` is injectable for tests that don't have a
        # live auth-proxy on the wire (the default minter calls the real
        # ``AuthApi.fetch_dev_user_jwt``). Tests pass an async lambda that
        # returns a stub token.
        self._auth_token: str | None = None
        self._auth_token_minter = auth_token_minter
        self._seeder = DuckDBProfileSeeder()
        self._runner = DbtRunner()
        self._parser = RunResultsParser()

    # ------------------------------------------------------------------
    # probe() — earned-trust contract (ADR-019 §4)
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

        # Mint a dev JWT once per session so the export probe (and the
        # downstream eject_and_test flow) can authenticate against the
        # auth-proxy. Cached on self for reuse by _fetch_zip below.
        await self._ensure_auth_token()

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

    async def _ensure_auth_token(self) -> str:
        """Mint a dev JWT against the auth-proxy callback endpoint, once.

        The default minter is ``AuthApi.fetch_dev_user_jwt`` (deferred-imported
        from ``harness.py`` to keep this module decoupled from the harness's
        heavyweight imports). Tests can inject ``auth_token_minter`` via
        the constructor to short-circuit the real HTTP call when no
        auth-proxy is on the wire.

        Cached on ``self._auth_token`` so the export probe and the per-flow
        ``_fetch_zip`` share the same session JWT.
        """
        if self._auth_token is not None:
            return self._auth_token
        if self._auth_token_minter is not None:
            self._auth_token = await self._auth_token_minter(self._base_url)
            return self._auth_token
        # Local import — keeps test-collection lightweight and avoids a
        # circular dependency through harness.py at module load.
        from tests.integration.dataset_layer.harness import fetch_dev_user_jwt

        self._auth_token = await fetch_dev_user_jwt(self._base_url)
        return self._auth_token

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
                auth_token=self._auth_token,
            )

    def _invoke_minio_probe(self, tmp_path: Path) -> ProbeReport:
        probe_dir = tmp_path / "probe-profile"
        probe_dir.mkdir(parents=True, exist_ok=True)
        # Probe-time profile: not bound to any real exported dbt project,
        # so a fixed sentinel name is fine — the probe asserts httpfs can
        # read parquet, not that dbt's lookup wires through a profile name.
        seeded_profile_path = self._seeder.seed(
            probe_dir,
            self._minio_creds,
            profile_name="probe_profile",
        )
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

        Flow (ADR-019 §Decision Outcome step 3):
            1. GET ``/api/projects/{project_id}/export/dbt`` -> zip bytes
            2. Unzip into ``tmp_path / project_id``
            3. Parse the unzipped ``dbt_project.yml`` to extract the
               ``profile:`` field (the exporter generates project-specific
               names like ``dataset_staging_<snake-cased ULID>``)
            4. Seed ``profiles.yml`` with concrete MinIO credentials under
               that exact profile name — otherwise dbt fails at build time
               with "Could not find profile named '...'".
            5. Run dbt ``deps`` -> ``build`` -> ``test`` via DbtRunner
            6. Parse the dbtRunnerResult into an EjectTestReport
        """
        # Make sure we have a session JWT — the per-flow path may be
        # invoked in a test that doesn't go through ``probe()`` first.
        await self._ensure_auth_token()
        zip_bytes = await self._fetch_zip(project_id)
        project_dir = self._unzip_project(zip_bytes, tmp_path / project_id)
        self._verify_expected_tree(project_dir)
        profile_name = self._extract_profile_name(project_dir)
        self._seeder.seed(project_dir, self._minio_creds, profile_name=profile_name)
        with _exported_env(self._build_env_overrides()):
            run_result = self._runner.run_build_and_test(str(project_dir))
        report = self._parser.parse(run_result, project_dir=str(project_dir))
        # Customer-fidelity invariant (ADR-019 cross-decision composition with
        # ADR-007): the report mirrors what the seeder wrote into profiles.yml
        # so acceptance tests can prove the test substrate reaches the SAME
        # MinIO lake the running app reads via Ibis. Endpoint is the
        # scheme-stripped host:port form — matches what's on disk in the
        # customer-facing profiles.yml, not the original env URL.
        report.seeded_profile_bucket = self._minio_creds["bucket"]
        report.seeded_profile_endpoint = DuckDBProfileSeeder._strip_scheme(self._minio_creds["endpoint_url"])
        return report

    def _build_env_overrides(self) -> dict[str, str]:
        """Map MinIO creds to the env_var(...) names the export emits.

        The exported ``models/staging/sources.yml`` references
        ``env_var('S3_BUCKET')`` (see
        ``backend/app/use_cases/project/_dbt/sources_yml.py``); the
        exported ``profiles.yml`` references the other s3_* keys
        (see ``backend/app/use_cases/project/_dbt/profiles_yml.py``).
        The seeder overwrites profiles.yml with concrete values, but
        sources.yml's env_var lookups still fire at parse time — so
        all five vars must be exported before ``dbtRunner.invoke``.
        """
        return {
            "S3_ENDPOINT": self._minio_creds["endpoint_url"],
            "S3_ACCESS_KEY_ID": self._minio_creds["access_key"],
            "S3_SECRET_ACCESS_KEY": self._minio_creds["secret_key"],
            "S3_BUCKET": self._minio_creds["bucket"],
            "S3_REGION": self._minio_creds["region"],
        }

    @staticmethod
    def _extract_profile_name(project_dir: Path) -> str:
        """Read ``profile:`` from the unzipped dbt_project.yml.

        Raises ``RuntimeError`` naming the missing key when the export is
        malformed — a substrate gap the seeder cannot paper over. dbt's
        own error ("Could not find profile named '...'") would surface
        much later, after the seeder has written a profiles.yml under the
        wrong key; raising here keeps the failure proximate to its cause.
        """
        dbt_project_yml = project_dir / "dbt_project.yml"
        data = yaml.safe_load(dbt_project_yml.read_text()) or {}
        profile_name = data.get("profile") if isinstance(data, dict) else None
        if not profile_name or not isinstance(profile_name, str):
            raise RuntimeError(
                f"dbt_project.yml at {dbt_project_yml} has no 'profile' key — "
                "cannot seed profiles.yml without knowing the profile name dbt "
                "will look up at build time"
            )
        return profile_name

    async def _fetch_zip(self, project_id: str) -> bytes:
        url = f"{self._base_url}/api/projects/{project_id}/export/dbt"
        headers = {"Authorization": f"Bearer {self._auth_token}"} if self._auth_token else None
        response = await self._http_client.get(url, headers=headers)
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
