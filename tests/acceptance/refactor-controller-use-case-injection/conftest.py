# <!-- DES-ENFORCEMENT : exempt -->
"""Acceptance-test configuration for refactor-controller-use-case-injection
(ADR-023).

DWD-1 (this distill): real I/O via the actual production Python controller
classes. The "real adapter" for this refactor is the kwarg-default-binding
mechanism baked into the Python language itself — when a caller omits a
keyword-only parameter, its declared default is used; when a caller supplies
the kwarg, the supplied value wins. There is no compose stack; no SQLite;
no MinIO; no auth-proxy. Every scenario imports the production controller
class from `app.controllers.<aggregate>_controller` and invokes its public
staticmethods directly, exactly as `backend/app/routers/<aggregate>s.py`
calls them today (plus the new `_use_cases=` keyword argument that
DELIVER introduces).

Fixtures here:
- ``capture`` — per-scenario observable-state object (defined in
  ``steps/controller_di_steps.py``; re-exported via star-import).
- ``fake_use_cases_factory`` — composable helper that builds the kind of
  ``MagicMock``/``AsyncMock`` use-cases module the migrated tests pass
  via ``_use_cases=lambda: fake``. DELIVER's step bodies call this
  helper; tests that need a custom shape compose on top of it.
- Star-import of step bindings from ``steps/`` so pytest-bdd registers
  every ``@given``/``@when``/``@then``.

DELIVER replaces the ``pytest.fail`` step bodies in
``steps/controller_di_steps.py`` with real implementations as each phase
unskips its scenarios per ``roadmap.json``.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

# Make the backend's `app` package importable. Acceptance suite lives at
# the repo root; backend is at `backend/`. Mirrors the sys.path discipline
# in tests/acceptance/refactor-metadata-repository-split/conftest.py.
_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT))
sys.path.insert(0, str(_REPO_ROOT / "backend"))

import pytest  # noqa: E402

# Star-import binds the @given/@when/@then bindings into pytest-bdd's
# registry so the .feature files resolve. Ruff would strip the import
# without the noqa marker.
sys.path.insert(0, str(Path(__file__).parent))
from steps.controller_di_steps import *  # noqa: E402,F401,F403


# ---------------------------------------------------------------------------
# fake_use_cases_factory — composable helper for `_use_cases=` injection
# ---------------------------------------------------------------------------


@pytest.fixture
def fake_use_cases_factory():
    """Build a fake use-cases module shaped to a per-scenario method map.

    Returns a callable suitable for the ``_use_cases=`` keyword on every
    per-aggregate controller method. Step bodies invoke it like::

        fake = fake_use_cases_factory({
            "get_organization": Success({"id": "org-1", "name": "Acme"}),
        })
        # ... in the @when step:
        body, status = await OrganizationController.get_my_organization(
            user="engineer-user-id",
            _use_cases=lambda: fake,  # the kwarg DELIVER introduces
        )

    The returned object behaves as a use-cases module: every name the
    controller calls is an ``AsyncMock`` whose ``return_value`` is the
    ``Success(...)``/``Failure(...)`` provided in ``method_returns``.
    Methods not listed in ``method_returns`` raise ``AttributeError`` on
    access (the ``spec=`` semantics) — this surfaces the "fake doesn't
    cover this method" failure mode in milestone-1.

    DISTILL scaffold: the helper raises ``pytest.fail`` until DELIVER
    fleshes out the body.
    """

    def _make(method_returns: dict[str, Any] | None = None, *, strict: bool = True):
        pytest.fail(
            "DISTILL scaffold — DELIVER implements: build a MagicMock "
            "(spec=list(method_returns) when strict=True, no spec "
            "otherwise) and set each fake.<method> = AsyncMock("
            "return_value=method_returns[<method>]). Return the mock. "
            "DELIVER's first phase wires this for the walking-skeleton "
            "(Phase 00) and broadens its surface in Phase 01."
        )

    return _make
