"""Acceptance-test configuration for dc-1k8 (log image identity on startup).

This conftest sits at the feature-test root so pytest-bdd can locate the
.feature files and shared step glue under steps/.
"""
from __future__ import annotations

import shutil

import pytest

# pytest-bdd resolves step bindings by scanning conftest's namespace, not
# just the plugin registry — so a star-import of the step module is what
# actually surfaces the @given/@when/@then handlers to test_*.py modules.
from steps.identity_steps import *  # noqa: F401,F403


def _binary_present(name: str) -> bool:
    return shutil.which(name) is not None


@pytest.fixture(scope="session")
def real_io_available() -> bool:
    """True iff the real-IO toolchain (bazel + docker) is on $PATH.

    Walking-skeleton scenarios assert this via a `requires_real_io` fixture
    that skips with an informative reason rather than failing when the
    toolchain is absent (e.g. on a contributor laptop without bazel).
    """
    return _binary_present("bazel") and _binary_present("docker")


@pytest.fixture(scope="session")
def requires_real_io(real_io_available: bool) -> None:
    if not real_io_available:
        pytest.skip("real-IO toolchain (bazel + docker) not available on $PATH")
