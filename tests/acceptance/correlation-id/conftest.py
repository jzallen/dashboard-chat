"""Pytest configuration for the correlation-id (US-1) acceptance suite.

Walking-skeleton strategy (recorded for the K1 assertion): the cross-service
scenarios drive the **real** local compose stack (auth-proxy → backend over the
compose network) and read back each service's **real** emitted log lines; the
only faked dependency is the costly LLM external (no chat turn is driven). These
scenarios are tagged `@real_io` + `@needs_compose_stack` and skip cleanly when
the stack is not reachable.

The `@scaffold` scenarios are stack-independent: they assert each ambient-context
seam (the Python `correlation_id` `ContextVar`, the Node `AsyncLocalStorage`
store) exists and is RED until its implementation sub-issue lands. They keep the
suite classifying RED — never BROKEN — in any environment, including one with no
compose stack up.
"""

from __future__ import annotations

import importlib.util
import os
import socket
import sys
from pathlib import Path
from types import ModuleType
from urllib.parse import urlparse

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from driver import CorrelationDriver  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[3]


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
def repo_root() -> Path:
    """Absolute path to the repo working tree root."""
    return REPO_ROOT


@pytest.fixture(scope="session")
def auth_proxy_url() -> str:
    return os.environ.get("AUTH_PROXY_URL", "http://localhost:1042").rstrip("/")


@pytest.fixture(scope="session")
def requires_compose_stack(auth_proxy_url: str) -> None:
    """Skip the scenario when the local compose stack is not reachable.

    Probes `auth-proxy:1042` — the ingress that mints the correlation id and the
    first hop the cross-service request traverses.
    """
    if not _service_reachable(auth_proxy_url):
        pytest.skip(
            f"compose stack not reachable at {auth_proxy_url} — this scenario "
            f"needs the local stack up (`docker compose up -d` from repo root)",
            allow_module_level=False,
        )


@pytest.fixture(scope="session")
def driver(auth_proxy_url: str, repo_root: Path) -> CorrelationDriver:
    """HTTP probes against the ingress + per-service log-line capture."""
    return CorrelationDriver(auth_proxy_url=auth_proxy_url, repo_root=repo_root)


def _load_module_by_path(path: Path, name: str) -> ModuleType:
    """Load a single module file without triggering its package's `__init__`.

    The scaffold modules import only the stdlib, so loading them in isolation
    keeps this dependency-free suite from needing the backend's runtime deps.
    """
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {name} from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def python_correlation_context(repo_root: Path) -> ModuleType:
    """The backend's `correlation_id` `ContextVar` seam, loaded in isolation."""
    return _load_module_by_path(
        repo_root / "backend" / "app" / "correlation" / "context.py",
        "correlation_context_scaffold",
    )
