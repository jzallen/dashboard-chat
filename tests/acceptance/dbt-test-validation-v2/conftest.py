"""Pytest configuration for the v2 dbt-test acceptance suite (ADR-024).

The v2 suite drives the same 5-service compose stack (auth-proxy +
backend + worker + query-engine + MinIO) the v1 suite drives, but
through a single procedural ``DbtTestDriver`` (no session-scoped
orchestrator, no probes, no BDD step glue). Each test gets a fresh
driver, JWT, project, and uploaded dataset; teardown deletes the
project so subsequent runs are independent.
"""
from __future__ import annotations

import os
import socket
import sys
import tempfile
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlparse

import pytest

# Ensure the driver module is importable as ``driver`` from each test.
sys.path.insert(0, str(Path(__file__).parent))
from driver import DbtTestDriver, MinioCreds, read_minio_creds_from_env  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"
ORDERS_CSV = FIXTURES / "orders.csv"


def _service_reachable(url: str, timeout: float = 0.5) -> bool:
    parsed = urlparse(url)
    host = parsed.hostname or ""
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if not host:
        return False
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


@pytest.fixture(scope="session")
def auth_proxy_url() -> str:
    """Auth-proxy base URL — defaults to the compose stack's mapped port."""
    return os.environ.get("AUTH_PROXY_URL", "http://localhost:1042").rstrip("/")


@pytest.fixture(scope="session")
def minio_creds() -> MinioCreds:
    return read_minio_creds_from_env()


@pytest.fixture(scope="session")
def requires_compose_stack(auth_proxy_url: str) -> None:
    """Skip the suite when the compose stack is not reachable.

    The driver depends on a running auth-proxy + backend + MinIO; absent
    those, every scenario would fail with a connection error. Skipping at
    fixture-evaluation time labels the cause cleanly.
    """
    if not _service_reachable(auth_proxy_url):
        pytest.skip(
            f"compose stack not reachable at {auth_proxy_url}; "
            f"run `docker compose up -d` and retry"
        )


@pytest.fixture
def driver(
    requires_compose_stack: None,
    auth_proxy_url: str,
    minio_creds: MinioCreds,
) -> DbtTestDriver:
    return DbtTestDriver(auth_proxy_url=auth_proxy_url, minio_creds=minio_creds)


@pytest.fixture
def jwt(driver: DbtTestDriver) -> str:
    return driver.fetch_dev_jwt()


@pytest.fixture
def project_with_orders(
    driver: DbtTestDriver, jwt: str, request: pytest.FixtureRequest
) -> Iterator[tuple[str, str]]:
    """Create a fresh project + uploaded orders CSV; yield (project_id, dataset_id).

    Teardown deletes the project so the next test sees a clean slate. The
    project name is derived from the test's node id so server-side logs
    point back at the scenario that created the project.
    """
    if not ORDERS_CSV.exists():
        pytest.fail(f"fixture missing at {ORDERS_CSV}")
    safe_name = request.node.name.replace("/", "_").replace("[", "_").replace("]", "_")
    project_id = driver.create_project(jwt, f"v2-acc-{safe_name}")
    try:
        dataset_id = driver.upload_csv(jwt, project_id, ORDERS_CSV)
        yield project_id, dataset_id
    finally:
        driver.delete_project(jwt, project_id)


@pytest.fixture
def work_dir() -> Iterator[Path]:
    """Disposable temp directory for unzipped exports + DuckDB scratch state."""
    with tempfile.TemporaryDirectory(prefix="dbt-v2-") as td:
        yield Path(td)
