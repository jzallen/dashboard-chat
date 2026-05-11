"""M1.3 — customer-fidelity invariant (ADR-024 Phase 1).

Port of v1 ``milestone-1-eject-and-test.feature``::

  Scenario: Customer-fidelity invariant — eject reads the same lake the app reads
    Given a fresh project with a small orders dataset uploaded
    And a chat workflow has produced a staging model that is shape-correct
    When the customer ejects the project and re-runs the validations
    Then the seeded read path points at the same datalake bucket the running app uses
    And the seeded read endpoint matches the running app's storage endpoint

The v1 contract is that the bucket / endpoint the seeder wrote into
``profiles.yml`` is the SAME bucket / endpoint the running app reads
from. Substrate-divergence (e.g., the test pointing at a different
lake than the app) would silently green-light an eject against the
wrong store. The v2 driver's ``TestReport.seeded_profile_bucket`` and
``seeded_profile_endpoint`` carry exactly what was substituted in
during ``seed_profile``; the assertion compares them to the same env
vars the running backend reads.
"""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

import pytest

from driver import DbtTestDriver


pytestmark = pytest.mark.real_io


def _expected_bucket() -> str:
    return os.environ.get("S3_BUCKET", "dashboard-chat.datalake")


def _expected_endpoint_hostport() -> str:
    raw = os.environ.get("S3_ENDPOINT", "http://localhost:9000")
    parsed = urlparse(raw)
    if parsed.netloc:
        return parsed.netloc
    # Fallback for bare ``host:port`` form (no scheme).
    return raw


def test_seeded_bucket_and_endpoint_match_backend(
    driver: DbtTestDriver,
    jwt: str,
    project_with_orders: tuple[str, str],
    work_dir: Path,
) -> None:
    project_id, dataset_id = project_with_orders
    driver.patch_column_required(jwt, dataset_id, "region")

    report = driver.run(jwt, project_id, work_dir)

    assert report.seeded_profile_bucket == _expected_bucket(), (
        f"seeded_profile_bucket={report.seeded_profile_bucket!r} does not "
        f"match the backend's S3_BUCKET={_expected_bucket()!r} — substrate "
        f"divergence would silently green-light eject against the wrong lake"
    )
    assert report.seeded_profile_endpoint == _expected_endpoint_hostport(), (
        f"seeded_profile_endpoint={report.seeded_profile_endpoint!r} does not "
        f"match the backend's S3_ENDPOINT host:port "
        f"({_expected_endpoint_hostport()!r}) — the seeder must mirror the same "
        f"host:port the in-app DuckDB resolves to"
    )
