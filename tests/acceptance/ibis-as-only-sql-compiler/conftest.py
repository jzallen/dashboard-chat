"""Pytest configuration for the ibis-as-only-sql-compiler acceptance suite.

Strategy C (DWD-1): drive the real compose stack when it is reachable; skip
cleanly otherwise. The walking-skeleton + milestone-1 scenarios all share the
same fixture lifecycle (fresh project / uploaded CSV per test) so teardown is
simple — delete the project, the cascade clears datasets / views.
"""

from __future__ import annotations

import socket
import sys
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlparse

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from driver import CreatedDataset, ViewAcceptanceDriver  # noqa: E402

import os  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"
ORDERS_CSV = FIXTURES / "orders.csv"
CUSTOMERS_CSV = FIXTURES / "customers.csv"


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
    return os.environ.get("AUTH_PROXY_URL", "http://localhost:1042").rstrip("/")


@pytest.fixture(scope="session")
def requires_compose_stack(auth_proxy_url: str) -> None:
    """Skip the suite when the compose stack is not reachable OR not in a
    mode that admits the dev-mode callback the driver mints JWTs with.

    Per DWD-1 (Strategy C) the suite skips with a named reason rather than
    failing when the substrate is unavailable. ``AUTH_MODE=workos`` rejects
    the ``dev-auth-code`` callback the driver uses; in that case the
    contract is unverifiable through HTTP and we skip cleanly.
    """
    if not _service_reachable(auth_proxy_url):
        pytest.skip(
            f"compose stack not reachable at {auth_proxy_url}; "
            f"run `docker compose up -d` and retry"
        )

    import httpx

    try:
        with httpx.Client(timeout=httpx.Timeout(5.0)) as client:
            res = client.post(
                f"{auth_proxy_url}/api/auth/callback",
                json={"code": "dev-auth-code"},
            )
    except httpx.HTTPError as exc:
        pytest.skip(f"auth-proxy unreachable: {exc}")
    if res.status_code != 200:
        pytest.skip(
            f"auth-proxy at {auth_proxy_url} is not in AUTH_MODE=dev "
            f"(callback returned {res.status_code}); restart the compose "
            f"stack with AUTH_MODE=dev to run this acceptance suite"
        )


@pytest.fixture
def driver(requires_compose_stack: None, auth_proxy_url: str) -> ViewAcceptanceDriver:
    return ViewAcceptanceDriver(auth_proxy_url=auth_proxy_url)


@pytest.fixture
def jwt(driver: ViewAcceptanceDriver) -> str:
    return driver.fetch_dev_jwt()


@pytest.fixture
def project(driver: ViewAcceptanceDriver, jwt: str, request: pytest.FixtureRequest) -> Iterator[str]:
    safe = request.node.name.replace("/", "_").replace("[", "_").replace("]", "_")
    project_id = driver.create_project(jwt, f"adr-026-mr-1-{safe}")
    try:
        yield project_id
    finally:
        driver.delete_project(jwt, project_id)


@pytest.fixture
def orders_dataset(driver: ViewAcceptanceDriver, jwt: str, project: str) -> CreatedDataset:
    if not ORDERS_CSV.exists():
        pytest.fail(f"fixture missing at {ORDERS_CSV}")
    return driver.upload_csv(jwt, project, ORDERS_CSV)


@pytest.fixture
def customers_dataset(driver: ViewAcceptanceDriver, jwt: str, project: str) -> CreatedDataset:
    if not CUSTOMERS_CSV.exists():
        pytest.fail(f"fixture missing at {CUSTOMERS_CSV}")
    return driver.upload_csv(jwt, project, CUSTOMERS_CSV)


@pytest.fixture
def orders_csv_path() -> Path:
    return ORDERS_CSV


@pytest.fixture
def customers_csv_path() -> Path:
    return CUSTOMERS_CSV
