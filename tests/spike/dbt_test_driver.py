"""Spike: minimal dbt-test driver for dashboard-chat.

Premise (SPIKE, not delivery): the existing dbt-test-validation feature
shipped ~4,800 LOC across a harness facade, eject orchestrator (probes +
seeder + runner + parser), per-turn Pandera validator, BDD step glue,
and 17 scenarios spread across 5 milestone files. This file asks:
how thin is the version that just does what the customer does?

What the customer does (per ADR-019 §1 "the customer's first ejected run
IS our last test run"):

  1. Drive the chat session to produce a staging model.
  2. Eject via GET /api/projects/{id}/export/dbt.
  3. Unzip. Drop their own SQL tests into tests/.
  4. Set S3_* env vars. Run `dbt build` then `dbt test`.
  5. Exit-code 0 means green.

That's it. No "Earned-Trust probes" (dbt's own errors name what's broken).
No "DuckDBProfileSeeder" (the exported profiles.yml already uses env_var()
Jinja — dbt resolves it natively). No "RunResultsParser" (the exit code IS
the signal; failing test names come from `dbt --log-format=json` if you
need them). No "PanderaValidator + AC1.5 retry budget" (chat that fails
to produce the shape just fails the SQL test downstream).

This is a SPIKE — exploratory, prototype-quality. It exists to evaluate
the architectural question. See docs/research/spike-dbt-test-driver-
simplification.md for the findings.

Usage (from this directory, with the acceptance suite's venv):

    cd tests/acceptance/dbt-test-validation
    uv run --no-project python ../../spike/dbt_test_driver.py
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import httpx

# Default ports match the developer compose stack (docker-compose.yml).
AUTH_PROXY_URL = os.environ.get("AUTH_PROXY_URL", "http://localhost:1042")
AGENT_URL = os.environ.get("AGENT_URL", "http://localhost:1041")
S3_BUCKET = os.environ.get("S3_BUCKET", "dashboard-chat.datalake")
S3_ENDPOINT = os.environ.get("S3_ENDPOINT", "http://localhost:9000")
S3_ACCESS_KEY_ID = os.environ.get("S3_ACCESS_KEY_ID", "minioadmin")
S3_SECRET_ACCESS_KEY = os.environ.get("S3_SECRET_ACCESS_KEY", "minioadmin")

ORDERS_CSV = Path(__file__).parent.parent / "acceptance" / "dbt-test-validation" / "fixtures" / "orders.csv"


# ---------------------------------------------------------------------------
# Primitives — each is a thin wrapper around one HTTP call or filesystem op.
# ---------------------------------------------------------------------------


def auth() -> str:
    """Mint a dev JWT via the auth-proxy callback endpoint."""
    res = httpx.post(f"{AUTH_PROXY_URL}/api/auth/callback", json={"code": "dev"}, timeout=10)
    res.raise_for_status()
    return res.json()["token"]


def create_project(jwt: str, name: str) -> str:
    res = httpx.post(
        f"{AUTH_PROXY_URL}/api/projects",
        headers={"Authorization": f"Bearer {jwt}"},
        json={"name": name},
        timeout=10,
    )
    res.raise_for_status()
    return _id(res.json())


def delete_project(jwt: str, project_id: str) -> None:
    httpx.delete(
        f"{AUTH_PROXY_URL}/api/projects/{project_id}",
        headers={"Authorization": f"Bearer {jwt}"},
        timeout=10,
    )


def upload_csv(jwt: str, project_id: str, csv_path: Path) -> str:
    with csv_path.open("rb") as fh:
        res = httpx.post(
            f"{AUTH_PROXY_URL}/api/uploads",
            headers={"Authorization": f"Bearer {jwt}"},
            files={"file": (csv_path.name, fh.read(), "text/csv")},
            data={"project_id": project_id},
            timeout=30,
        )
    res.raise_for_status()
    return _id(res.json())


def patch_required(jwt: str, dataset_id: str, column: str) -> None:
    """Mark a column required=True so the schema.yml exporter emits a
    not_null dbt test for it.

    This is exactly the M1/WS fixture-driven setup (DWD-9 — chat layer has
    no production path that writes schema_config.constraints, so the
    acceptance suite uses PATCH to drive deterministic test emission).
    """
    res = httpx.get(
        f"{AUTH_PROXY_URL}/api/datasets/{dataset_id}",
        headers={"Authorization": f"Bearer {jwt}"},
        timeout=10,
    )
    res.raise_for_status()
    attrs = res.json()["data"]["attributes"]
    schema = attrs.get("schema_config") or {"fields": {}}
    fields = dict(schema.get("fields") or {})
    entry = dict(fields.get(column) or {"type": "text"})
    entry["constraints"] = {**(entry.get("constraints") or {}), "required": True}
    fields[column] = entry
    httpx.patch(
        f"{AUTH_PROXY_URL}/api/datasets/{dataset_id}",
        headers={"Authorization": f"Bearer {jwt}"},
        json={"schema_config": {**schema, "fields": fields}},
        timeout=10,
    ).raise_for_status()


def chat_turn(jwt: str, dataset_id: str, prompt: str) -> dict:
    """One chat turn against the agent /chat endpoint. Returns the parsed
    SSE body as {events, raw_chunks_seen}. The simpler shape needs only
    "did it succeed" not the AC1.4 raw-tool-call invariant — that belongs
    to the chat protocol tests, not the dbt-test feature.
    """
    res = httpx.post(
        f"{AGENT_URL}/chat",
        headers={"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"},
        json={
            "messages": [{"role": "user", "content": prompt}],
            "contextType": "dataset",
            "contextId": dataset_id,
        },
        timeout=60,
    )
    if res.status_code != 200:
        raise RuntimeError(f"chat /chat returned {res.status_code}: {res.text[:300]}")
    return {"status": res.status_code, "bytes": len(res.content)}


def eject(jwt: str, project_id: str) -> bytes:
    """GET /api/projects/{id}/export/dbt → zip bytes."""
    res = httpx.get(
        f"{AUTH_PROXY_URL}/api/projects/{project_id}/export/dbt",
        headers={"Authorization": f"Bearer {jwt}"},
        timeout=30,
    )
    res.raise_for_status()
    return res.content


def unzip_and_inject(zip_bytes: bytes, target_dir: Path, custom_tests_dir: Path | None) -> Path:
    """Unzip the eject; copy custom_tests_dir/*.sql into target_dir/tests/;
    add s3_use_ssl=false to the profile (MinIO is plain HTTP).

    The exported profiles.yml inherits the customer's expected target —
    typically AWS S3 with TLS. Targeting a local MinIO requires one extra
    line in the profile (s3_use_ssl: false). Inject it post-unzip — same
    one-line patch a customer would apply when ejecting against MinIO.
    """
    target_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io_from_bytes(zip_bytes)) as zf:
        zf.extractall(target_dir)
    if custom_tests_dir and custom_tests_dir.exists():
        tests_out = target_dir / "tests"
        tests_out.mkdir(exist_ok=True)
        for sql in custom_tests_dir.glob("*.sql"):
            shutil.copy2(sql, tests_out / sql.name)
    _patch_profile_for_minio(target_dir / "profiles.yml")
    return target_dir


def _patch_profile_for_minio(profiles_path: Path) -> None:
    """Append `s3_use_ssl: false` to the exported profile's settings block.

    The exported profiles.yml assumes the customer's target (typically
    AWS S3 with TLS). A local MinIO target needs one extra line; same
    one-line patch a customer would apply when their target is MinIO.
    """
    if not profiles_path.exists():
        return
    import yaml as _yaml

    body = _yaml.safe_load(profiles_path.read_text())
    for profile in body.values():
        outputs = profile.get("outputs", {}) if isinstance(profile, dict) else {}
        for output in outputs.values():
            settings = output.setdefault("settings", {}) if isinstance(output, dict) else None
            if isinstance(settings, dict) and "s3_use_ssl" not in settings:
                settings["s3_use_ssl"] = False
    profiles_path.write_text(_yaml.safe_dump(body, sort_keys=False))


def io_from_bytes(b: bytes):
    from io import BytesIO

    return BytesIO(b)


def run_dbt(project_dir: Path, env_unset: tuple[str, ...] = ()) -> dict:
    """Run dbt deps (if packages.yml), build, then test. Return status dict.

    Uses dbtRunner.invoke when the python lib is importable; otherwise
    falls back to `dbt` on PATH. The customer does the latter; we test
    against both at the integration boundary.

    ``env_unset`` lets a scenario strip specific env vars before invoking
    dbt — used by the m5 missing-env-var scenario to assert that dbt
    fails loudly when a referenced env_var() is not set.
    """
    endpoint = S3_ENDPOINT.removeprefix("https://").removeprefix("http://")
    env = {
        **os.environ,
        "S3_BUCKET": S3_BUCKET,
        "S3_ENDPOINT": endpoint,
        "S3_ACCESS_KEY_ID": S3_ACCESS_KEY_ID,
        "S3_SECRET_ACCESS_KEY": S3_SECRET_ACCESS_KEY,
        "S3_REGION": "us-east-1",
        "S3_URL_STYLE": "path",
    }
    for k in env_unset:
        env.pop(k, None)

    def _invoke(args: list[str]) -> tuple[int, str]:
        # dbtRunner reads os.environ at invoke time — apply the scenario's
        # env mutations (including env_unset stripping), then restore.
        saved = {k: os.environ.get(k) for k in (*env.keys(), *env_unset)}
        try:
            os.environ.update(env)
            for k in env_unset:
                os.environ.pop(k, None)
            try:
                from dbt.cli.main import dbtRunner  # type: ignore[import-untyped]

                res = dbtRunner().invoke(args + ["--project-dir", str(project_dir), "--profiles-dir", str(project_dir)])
                output_parts: list[str] = []
                if getattr(res, "exception", None):
                    output_parts.append(str(res.exception))
                results = getattr(getattr(res, "result", None), "results", None) or []
                for r in results:
                    status = getattr(r, "status", "")
                    if str(status) not in {"pass", "success", "RunStatus.Success", "TestStatus.Pass"}:
                        node_name = getattr(getattr(r, "node", None), "name", "") or getattr(r, "unique_id", "")
                        msg = getattr(r, "message", "")
                        output_parts.append(f"{status} {node_name}: {msg}")
                return (0 if res.success else 1, "\n".join(output_parts))
            except ImportError:
                proc = subprocess.run(
                    ["dbt", *args, "--project-dir", str(project_dir), "--profiles-dir", str(project_dir)],
                    capture_output=True,
                    text=True,
                )
                return (proc.returncode, proc.stdout + proc.stderr)
        finally:
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

    # Only run deps when packages.yml exists (matches the customer's workflow).
    if (project_dir / "packages.yml").exists():
        deps_rc, deps_out = _invoke(["deps"])
        if deps_rc != 0:
            return {"phase": "deps", "rc": deps_rc, "out": deps_out}

    build_rc, build_out = _invoke(["build"])
    return {"phase": "build", "rc": build_rc, "out": build_out}


def _id(body: dict) -> str:
    """Resolve an entity id from a JSON:API or flat response."""
    if isinstance(body, dict):
        data = body.get("data", body)
        if isinstance(data, dict):
            return data.get("id") or data.get("attributes", {}).get("id") or ""
    return ""


# ---------------------------------------------------------------------------
# Scenarios — declarative data. NO Python steps required for fixture-driven
# scenarios; chat-driven scenarios carry their prompt list as data too.
# ---------------------------------------------------------------------------


@dataclass
class Scenario:
    name: str
    expected: str  # "pass" or "fail"
    custom_tests_dir: Path | None = None
    require_column: str | None = None  # fixture-drive: PATCH this column required=True
    prompts: list[str] = field(default_factory=list)  # chat-drive: send these prompts
    env_unset: tuple[str, ...] = ()  # strip these env vars before invoking dbt
    expected_failing_test: str | None = None  # name substring expected in failures
    expected_msg: str | None = None  # substring expected in dbt's stderr (m5 missing-var)


FIXTURES = Path(__file__).parent / "fixtures"


SCENARIOS: list[Scenario] = [
    # M1 happy-path / customer-fidelity (same @given as the existing M1 happy-path).
    Scenario(
        name="m1_happy_path",
        expected="pass",
        require_column="region",  # orders.csv has region populated on all 15 rows
        custom_tests_dir=FIXTURES / "require_region" / "tests",
    ),
    # M1 drift-detector: order_id is empty on 2 of 15 rows; marking it
    # required forces the not_null dbt test to fail.
    Scenario(
        name="m1_drift_detector",
        expected="fail",
        require_column="order_id",
        custom_tests_dir=FIXTURES / "drop_empty_order_id" / "tests",
        expected_failing_test="not_null",
    ),
    # Chat-driven happy-path. With GROQ_API_KEY unset this scenario is
    # gracefully skipped (no special skip-when-unavailable infra needed).
    Scenario(
        name="chat_then_eject_then_test",
        expected="pass",
        prompts=["Show me the first 5 rows of this dataset"],
        require_column="region",
        custom_tests_dir=FIXTURES / "require_region" / "tests",
    ),
    # M5 failure-mode coverage (env var unset). Strips S3_BUCKET so the
    # exported sources.yml's env_var('S3_BUCKET') cannot resolve and dbt
    # fails at compile time. NOTE: dbt's own error names the missing var
    # — no bespoke "seeder env-var defense" needed.
    Scenario(
        name="m5_missing_env_var",
        expected="fail",
        require_column="region",
        custom_tests_dir=FIXTURES / "require_region" / "tests",
        env_unset=("S3_BUCKET",),
        expected_msg="S3_BUCKET",
    ),
]


# ---------------------------------------------------------------------------
# Runner — one function per scenario, all the same shape.
# ---------------------------------------------------------------------------


def run_scenario(jwt: str, scn: Scenario) -> dict:
    """Run one scenario start-to-finish. Returns observation dict.

    No fixtures, no BDD step glue, no session-scoped probing. Each scenario
    is independent — fresh project, fresh dataset, fresh tmpdir.
    """
    project_id = create_project(jwt, f"spike-{scn.name}")
    try:
        dataset_id = upload_csv(jwt, project_id, ORDERS_CSV)
        for prompt in scn.prompts:
            chat_turn(jwt, dataset_id, prompt)
        if scn.require_column:
            patch_required(jwt, dataset_id, scn.require_column)
        zip_bytes = eject(jwt, project_id)
        with tempfile.TemporaryDirectory(prefix=f"spike-{scn.name}-") as td:
            project_dir = unzip_and_inject(zip_bytes, Path(td), scn.custom_tests_dir)
            outcome = run_dbt(project_dir, env_unset=scn.env_unset)
        passed = (outcome["rc"] == 0)
        matched = (passed and scn.expected == "pass") or (not passed and scn.expected == "fail")
        if scn.expected_failing_test and not passed:
            matched = matched and (scn.expected_failing_test in outcome["out"])
        if scn.expected_msg and not passed:
            matched = matched and (scn.expected_msg in outcome["out"])
        return {
            "name": scn.name,
            "expected": scn.expected,
            "actual": "pass" if passed else "fail",
            "matched": matched,
            "phase": outcome["phase"],
            "rc": outcome["rc"],
            "snippet": outcome["out"][-400:] if outcome["out"] else "",
        }
    finally:
        delete_project(jwt, project_id)


def main() -> int:
    jwt = auth()
    results = []
    for scn in SCENARIOS:
        if scn.prompts and not os.environ.get("GROQ_API_KEY"):
            results.append({"name": scn.name, "matched": True, "skipped": "GROQ_API_KEY unset"})
            continue
        try:
            results.append(run_scenario(jwt, scn))
        except Exception as exc:
            results.append({"name": scn.name, "matched": False, "error": repr(exc)})
    print(json.dumps(results, indent=2, default=str))
    return 0 if all(r.get("matched") for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
