"""dbt-test driver for the dashboard-chat acceptance suite (ADR-024).

Replaces the v1 ``DatasetLayerHarness.eject_and_test`` /
``EjectAndTestOrchestrator`` composition chain with a single procedural
driver. The customer flow this implements:

  1. Mint a dev JWT against the auth-proxy.
  2. Create a project, upload a CSV, optionally PATCH the dataset's
     ``schema_config`` to drive deterministic dbt-test emission.
  3. GET ``/api/projects/{id}/export/dbt`` -> zip bytes -> unzip to tmp.
  4. Substitute the exported ``profiles.yml`` env_var() placeholders with
     concrete values (the same MinIO credentials the running backend
     uses). Raise ``EnvVarMissingError`` if a referenced env_var() lacks
     both a default and a runtime value.
  5. Invoke ``dbtRunner`` for ``deps`` (if ``packages.yml`` exists),
     then ``build`` then ``test``. Parse ``RunExecutionResult.results``
     into a structured ``TestReport``.

Single-threaded, no async, no fixtures, no probes. Substrate lies
surface at the call site of each operation (HTTP 5xx, dbt-runner
exceptions) rather than being gated by a session-scoped probe pass.
"""
from __future__ import annotations

import io
import os
import re
import shutil
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import yaml


# ---------------------------------------------------------------------------
# Public structured types
# ---------------------------------------------------------------------------


class EnvVarMissingError(RuntimeError):
    """Raised by ``DbtTestDriver.seed_profile`` when the exported profile
    references an env_var() that lacks both a default and a runtime value.

    Mirrors the v1 seeder's defense (ADR-019 §13 Risk #1): naming the
    missing variable in the error rather than letting dbt's downstream
    error surface a generic Jinja resolution failure.
    """

    def __init__(self, missing: list[str], detail: str | None = None) -> None:
        self.missing = list(missing)
        names = ", ".join(self.missing) or "<unknown>"
        suffix = f" ({detail})" if detail else ""
        super().__init__(
            f"exported profile references env_var(s) not set in the environment: "
            f"{names}{suffix}"
        )


@dataclass(frozen=True)
class FailureDetail:
    """One dbt-test failure surfaced from ``RunExecutionResult.results``."""

    name: str
    message: str


@dataclass(frozen=True)
class TestReport:
    """Structured outcome of a full eject+build+test cycle.

    ``status`` is the customer-visible pass/fail. ``models_built`` and
    ``tests_run`` are name lists drawn from ``RunResult.node.name`` for
    each materialization / test node observed in dbt's
    ``RunExecutionResult.results``. ``failures`` carries the subset of
    ``tests_run`` whose ``RunResult.status`` was not pass/success.
    """

    status: str  # "pass" | "fail"
    models_built: list[str]
    tests_run: list[str]
    failures: list[FailureDetail]
    seeded_profile_bucket: str
    seeded_profile_endpoint: str
    dbt_phase: str  # "build" or "deps" — last phase invoked
    dbt_output: str = ""


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MinioCreds:
    """The credentials the driver substitutes into the exported profile."""

    bucket: str
    endpoint: str  # full URL with scheme; the driver strips scheme for DuckDB
    region: str
    access_key: str
    secret_key: str
    url_style: str = "path"
    use_ssl: bool = False


_ENV_VAR_PATTERN = re.compile(
    r"\{\{\s*env_var\(\s*['\"]([A-Z_][A-Z0-9_]*)['\"]"  # name
    r"(?:\s*,\s*['\"]([^'\"]*)['\"])?"                  # optional default
    r"\s*\)\s*(?:\|\s*[A-Za-z_]+\s*)?\}\}"              # optional jinja filter
)


def _coerce_value(value: str) -> str | int | bool:
    """Coerce a substituted value to match dbt's env_var() filters (``| as_bool``,
    ``| int``). DuckDB / dbt accept the literal string forms for bool / int in
    YAML and resolve them via Jinja filters; the substituted profile bypasses
    Jinja, so we coerce here.
    """
    lowered = value.strip().lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    try:
        return int(value)
    except (TypeError, ValueError):
        return value


class DbtTestDriver:
    """Procedural driver for the dbt-test customer-fidelity cycle.

    Each public method is one thin HTTP / filesystem / dbt-runner step. The
    full cycle is composed by ``run(...)``; individual tests can call the
    primitives in isolation when they need to inject a tampering step
    (e.g. M5.1 injects an extra env_var() into the unzipped profile
    between ``fetch_and_unzip`` and ``seed_profile``).
    """

    def __init__(
        self,
        *,
        auth_proxy_url: str,
        minio_creds: MinioCreds,
        http_timeout_seconds: float = 30.0,
    ) -> None:
        self._auth_proxy_url = auth_proxy_url.rstrip("/")
        self._minio_creds = minio_creds
        self._timeout = httpx.Timeout(http_timeout_seconds)

    # -- HTTP primitives ------------------------------------------------

    def fetch_dev_jwt(self) -> str:
        with httpx.Client(timeout=self._timeout) as client:
            res = client.post(
                f"{self._auth_proxy_url}/api/auth/callback",
                json={"code": "dev-auth-code"},
            )
            res.raise_for_status()
            token = res.json().get("token")
        if not isinstance(token, str) or not token:
            raise RuntimeError("auth-proxy callback did not return a token")
        return token

    def create_project(self, jwt: str, name: str) -> str:
        with httpx.Client(timeout=self._timeout) as client:
            res = client.post(
                f"{self._auth_proxy_url}/api/projects",
                headers=_bearer(jwt, json_body=True),
                json={"name": name},
            )
            res.raise_for_status()
        return _resolve_id(res.json())

    def delete_project(self, jwt: str, project_id: str) -> None:
        with httpx.Client(timeout=self._timeout) as client:
            client.delete(
                f"{self._auth_proxy_url}/api/projects/{project_id}",
                headers=_bearer(jwt),
            )

    def upload_csv(self, jwt: str, project_id: str, csv_path: Path) -> str:
        with httpx.Client(timeout=self._timeout) as client, csv_path.open("rb") as fh:
            res = client.post(
                f"{self._auth_proxy_url}/api/uploads",
                headers=_bearer(jwt),
                files={"file": (csv_path.name, fh.read(), "text/csv")},
                data={"project_id": project_id},
            )
            res.raise_for_status()
        return _resolve_id(res.json())

    def patch_column_required(self, jwt: str, dataset_id: str, column: str) -> None:
        """PATCH a dataset's ``schema_config`` to mark a column required.

        The schema.yml exporter translates ``constraints.required=true``
        into a ``not_null`` dbt test on the corresponding staging column;
        the M1 / WS scenarios use this to drive deterministic dbt-test
        emission (DWD-9 — chat layer has no production write path for
        ``schema_config.constraints``).
        """
        with httpx.Client(timeout=self._timeout) as client:
            res = client.get(
                f"{self._auth_proxy_url}/api/datasets/{dataset_id}",
                headers=_bearer(jwt),
            )
            res.raise_for_status()
            body = res.json()
            data = body.get("data", body) if isinstance(body, dict) else {}
            attrs = data.get("attributes", data) if isinstance(data, dict) else {}
            current = attrs.get("schema_config") or {"fields": {}}
            fields = dict(current.get("fields") or {})
            entry = dict(fields.get(column) or {"type": "text"})
            constraints = dict(entry.get("constraints") or {})
            constraints["required"] = True
            entry["constraints"] = constraints
            fields[column] = entry
            new_schema = {**current, "fields": fields}
            patch_res = client.patch(
                f"{self._auth_proxy_url}/api/datasets/{dataset_id}",
                headers=_bearer(jwt, json_body=True),
                json={"schema_config": new_schema},
            )
            patch_res.raise_for_status()

    def export_dbt(self, jwt: str, project_id: str) -> bytes:
        with httpx.Client(timeout=self._timeout) as client:
            res = client.get(
                f"{self._auth_proxy_url}/api/projects/{project_id}/export/dbt",
                headers=_bearer(jwt),
            )
            res.raise_for_status()
            return res.content

    # -- Filesystem primitives -----------------------------------------

    def fetch_and_unzip(self, jwt: str, project_id: str, target_dir: Path) -> Path:
        """GET the exported zip, write it under ``target_dir``, unzip there.

        The customer's first-ejected-run does exactly this — ``unzip
        dbt_<slug>.zip`` into a project tree they then ``dbt build``.
        """
        target_dir.mkdir(parents=True, exist_ok=True)
        zip_bytes = self.export_dbt(jwt, project_id)
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            zf.extractall(target_dir)
        # The exported zip nests everything under a slug-derived directory
        # (e.g. ``project-<slug>/``); pick the first subdirectory that
        # contains the dbt_project.yml so callers do not need to know the
        # slug.
        for candidate in (target_dir, *target_dir.iterdir()):
            if (candidate / "dbt_project.yml").exists():
                return candidate
        raise RuntimeError(
            f"unzipped export under {target_dir} does not contain dbt_project.yml"
        )

    def seed_profile(self, project_dir: Path) -> dict[str, str]:
        """Substitute env_var() placeholders in ``profiles.yml`` with values.

        Phase 0 added native ``s3_use_ssl`` support to the exported profile;
        the v1 post-unzip patch workaround is gone. This method now does
        one job: rewrite the exported profile's Jinja ``env_var('VAR')``
        placeholders with concrete values from ``self._minio_creds`` +
        ``os.environ``, then write the substituted profile back to disk.

        Returns ``{"bucket": ..., "endpoint": ...}`` reporting the values
        actually written. The customer-fidelity test compares these to the
        backend's MinIO env.

        Raises ``EnvVarMissingError`` if the profile references an env_var
        that has no default, is not provided by ``minio_creds``, and is
        not present in ``os.environ`` — the v2 analog of v1's seeder
        env_var defense (ADR-019 §13 Risk #1).
        """
        profile_path = project_dir / "profiles.yml"
        if not profile_path.exists():
            raise RuntimeError(f"exported profile missing at {profile_path}")

        env_lookup: dict[str, str] = {
            "S3_BUCKET": self._minio_creds.bucket,
            "S3_REGION": self._minio_creds.region,
            "S3_ACCESS_KEY_ID": self._minio_creds.access_key,
            "S3_SECRET_ACCESS_KEY": self._minio_creds.secret_key,
            "S3_ENDPOINT": _strip_scheme(self._minio_creds.endpoint),
            "S3_USE_SSL": "true" if self._minio_creds.use_ssl else "false",
            "S3_URL_STYLE": self._minio_creds.url_style,
        }

        # Parse the YAML so we walk semantic string values rather than the raw
        # source — the export uses YAML single-quoted strings (``''`` escaping
        # for inner ``'``), which yaml.safe_load resolves to plain ``'`` in
        # memory. Walking the parsed structure keeps the substitution shape
        # invariant to YAML's quoting form.
        body = yaml.safe_load(profile_path.read_text())
        missing: list[str] = []

        def _replace(match: re.Match[str]) -> str:
            name = match.group(1)
            default = match.group(2)
            if name in env_lookup:
                return env_lookup[name]
            value = os.environ.get(name)
            if value is not None:
                return value
            if default is not None:
                return default
            missing.append(name)
            return match.group(0)  # placeholder unchanged; we raise below

        def _walk(node: Any) -> Any:
            if isinstance(node, dict):
                return {k: _walk(v) for k, v in node.items()}
            if isinstance(node, list):
                return [_walk(v) for v in node]
            if isinstance(node, str):
                if _ENV_VAR_PATTERN.search(node):
                    substituted = _ENV_VAR_PATTERN.sub(_replace, node)
                    return _coerce_value(substituted) if substituted != node else node
                return node
            return node

        # Only substitute env_vars in the ACTIVE target's subtree. The exported
        # profile carries inactive targets (e.g. ``postgres``) that reference
        # credentials only relevant when that target is selected; leaving their
        # env_var() placeholders untouched keeps dbt happy because dbt only
        # resolves env_vars on the selected target. Bucketing this way also
        # prevents PG_* missing-var noise from masking real S3_* errors.
        if isinstance(body, dict):
            for profile in body.values():
                if not isinstance(profile, dict):
                    continue
                active = profile.get("target")
                outputs = profile.get("outputs")
                if not isinstance(outputs, dict) or not isinstance(active, str):
                    continue
                target_block = outputs.get(active)
                if target_block is not None:
                    outputs[active] = _walk(target_block)

        if missing:
            seen: list[str] = []
            for name in missing:
                if name not in seen:
                    seen.append(name)
            raise EnvVarMissingError(seen)

        profile_path.write_text(yaml.safe_dump(body, sort_keys=False))
        return {
            "bucket": env_lookup["S3_BUCKET"],
            "endpoint": env_lookup["S3_ENDPOINT"],
        }

    # -- dbt invocation ------------------------------------------------

    def run_dbt(self, project_dir: Path) -> dict[str, Any]:
        """Invoke dbtRunner for deps -> build -> test against ``project_dir``.

        Sets the S3 env vars before invoking so dbt's Jinja resolves
        ``env_var('S3_BUCKET')`` references in non-``profiles.yml`` files
        (``sources.yml``, ``dbt_project.yml``) natively. The customer does
        the equivalent on their host before ``dbt build``; we mirror that
        here for parity. Each invocation gets the project + profiles
        directory pinned to ``project_dir`` (we already wrote the
        substituted profile there). Returns
        ``{"phase": str, "success": bool, "results": list, "output": str}``.
        """
        from dbt.cli.main import dbtRunner

        runner = dbtRunner()
        invocation_env = {
            "S3_BUCKET": self._minio_creds.bucket,
            "S3_REGION": self._minio_creds.region,
            "S3_ACCESS_KEY_ID": self._minio_creds.access_key,
            "S3_SECRET_ACCESS_KEY": self._minio_creds.secret_key,
            "S3_ENDPOINT": _strip_scheme(self._minio_creds.endpoint),
            "S3_USE_SSL": "true" if self._minio_creds.use_ssl else "false",
            "S3_URL_STYLE": self._minio_creds.url_style,
        }

        def _invoke(args: list[str]) -> tuple[Any, str]:
            saved = {k: os.environ.get(k) for k in invocation_env}
            os.environ.update(invocation_env)
            try:
                res = runner.invoke(
                    args + [
                        "--project-dir", str(project_dir),
                        "--profiles-dir", str(project_dir),
                    ]
                )
            finally:
                for k, prior in saved.items():
                    if prior is None:
                        os.environ.pop(k, None)
                    else:
                        os.environ[k] = prior
            parts: list[str] = []
            if getattr(res, "exception", None):
                parts.append(repr(res.exception))
            return res, "\n".join(parts)

        if (project_dir / "packages.yml").exists():
            deps_res, deps_out = _invoke(["deps"])
            if not deps_res.success:
                return {
                    "phase": "deps",
                    "success": False,
                    "results": [],
                    "output": deps_out,
                }

        build_res, build_out = _invoke(["build"])
        results = getattr(getattr(build_res, "result", None), "results", None) or []
        return {
            "phase": "build",
            "success": bool(build_res.success),
            "results": list(results),
            "output": build_out,
        }

    @staticmethod
    def parse_results(
        dbt_outcome: dict[str, Any],
        *,
        seeded_bucket: str,
        seeded_endpoint: str,
    ) -> TestReport:
        """Translate ``RunExecutionResult.results`` into a ``TestReport``.

        Models surface from results whose node ``resource_type=='model'``;
        tests surface from results whose node ``resource_type=='test'``.
        A test result whose ``status`` is not in the success set
        (``pass``, ``success``, ``RunStatus.Success``, ``TestStatus.Pass``)
        is added to ``failures`` with the dbt-test's name (e.g.
        ``not_null_stg_orders_order_id``).
        """
        success_states = {
            "pass", "success", "RunStatus.Success", "TestStatus.Pass",
        }
        models: list[str] = []
        tests: list[str] = []
        failures: list[FailureDetail] = []

        for r in dbt_outcome.get("results", []) or []:
            node = getattr(r, "node", None)
            name = (
                getattr(node, "name", None)
                or getattr(r, "unique_id", None)
                or ""
            )
            resource_type = getattr(node, "resource_type", "")
            # ResourceType is sometimes a dbt enum; normalize to its string.
            resource_type_str = getattr(resource_type, "name", resource_type) or ""
            resource_type_str = str(resource_type_str).lower()
            status = str(getattr(r, "status", ""))

            if "test" in resource_type_str:
                tests.append(name)
                if status not in success_states:
                    failures.append(
                        FailureDetail(name=name, message=str(getattr(r, "message", "")))
                    )
            elif "model" in resource_type_str or "seed" in resource_type_str:
                models.append(name)

        return TestReport(
            status="pass" if dbt_outcome.get("success") else "fail",
            models_built=models,
            tests_run=tests,
            failures=failures,
            seeded_profile_bucket=seeded_bucket,
            seeded_profile_endpoint=seeded_endpoint,
            dbt_phase=str(dbt_outcome.get("phase", "")),
            dbt_output=str(dbt_outcome.get("output", "")),
        )

    # -- composition ---------------------------------------------------

    def run(self, jwt: str, project_id: str, work_dir: Path) -> TestReport:
        """Convenience: full fetch -> seed -> run -> parse cycle.

        Tests that need to tamper between steps (e.g. M5.1's profile
        injection) call the primitives directly instead.
        """
        project_dir = self.fetch_and_unzip(jwt, project_id, work_dir)
        seeded = self.seed_profile(project_dir)
        outcome = self.run_dbt(project_dir)
        return self.parse_results(
            outcome,
            seeded_bucket=seeded["bucket"],
            seeded_endpoint=seeded["endpoint"],
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _bearer(token: str, *, json_body: bool = False) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers


def _resolve_id(body: Any) -> str:
    """Extract an entity id from a JSON:API or flat response body."""
    if isinstance(body, dict):
        data = body.get("data", body)
        if isinstance(data, dict):
            ident = data.get("id") or data.get("attributes", {}).get("id")
            if isinstance(ident, str) and ident:
                return ident
    raise RuntimeError(f"could not resolve id from response: {body!r}")


def _strip_scheme(url: str) -> str:
    """Strip ``http://`` / ``https://`` so the value matches DuckDB's
    ``s3_endpoint`` form (host:port, no scheme)."""
    for prefix in ("https://", "http://"):
        if url.startswith(prefix):
            return url[len(prefix):]
    return url


def read_minio_creds_from_env() -> MinioCreds:
    """Build ``MinioCreds`` from the same env vars the backend reads.

    Defaults match ``backend/.env.example`` (``STORAGE_BUCKET=
    dashboard-chat.datalake``, etc.) so a contributor running ``docker
    compose up -d`` against the canonical .env never has to hand-export
    credentials.
    """
    use_ssl = os.environ.get("S3_USE_SSL", "false").lower() in {"true", "1", "yes"}
    return MinioCreds(
        bucket=os.environ.get("S3_BUCKET", "dashboard-chat.datalake"),
        endpoint=os.environ.get("S3_ENDPOINT", "http://localhost:9000"),
        region=os.environ.get("S3_REGION", "us-east-1"),
        access_key=os.environ.get("S3_ACCESS_KEY_ID", "minioadmin"),
        secret_key=os.environ.get("S3_SECRET_ACCESS_KEY", "minioadmin"),
        url_style=os.environ.get("S3_URL_STYLE", "path"),
        use_ssl=use_ssl,
    )
