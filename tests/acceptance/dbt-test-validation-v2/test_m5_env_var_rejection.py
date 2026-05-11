"""M5.1 — env-var rejection (ADR-024 Phase 1).

Port of v1 ``milestone-5-failure-modes.feature``::

  Scenario: Export references an undefined credential — seeder fails with a named-variable error
    Given a fresh project with a small orders dataset uploaded
    And the project export will reference a credential variable that is not set in the environment
    When the customer ejects the project and re-runs the validations
    Then the seeder fails with an error that names the missing credential variable
    And the orchestrator does not silently substitute an empty value

The v1 scenario tampers the unzipped ``profiles.yml`` by appending a
new line referencing ``env_var('DC_TEST_UNSET_CREDENTIAL')`` after the
real export; the v1 seeder's env_var defense raises naming the missing
variable. The v2 driver mirrors the contract: ``seed_profile`` walks
the parsed YAML, substitutes known + defaulted env_vars, and raises
``EnvVarMissingError`` (carrying the names list) for any unresolved
ref. The test asserts the raise and the variable name in ``.missing``.

Phase 0 made ``S3_USE_SSL`` natively env_var-able with a default; the
M5.1 test cannot use a real S3_* var to drive the rejection because
those now all have defaults or are supplied by ``MinioCreds``. The
custom injection ``DC_TEST_UNSET_CREDENTIAL`` is the same pattern the
v1 step glue uses (matching the v1 contract).
"""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from driver import DbtTestDriver, EnvVarMissingError


pytestmark = pytest.mark.real_io

INJECTED_VAR = "DC_TEST_UNSET_CREDENTIAL"


def test_seed_profile_raises_on_unset_env_var(
    driver: DbtTestDriver,
    jwt: str,
    project_with_orders: tuple[str, str],
    work_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project_id, dataset_id = project_with_orders
    driver.patch_column_required(jwt, dataset_id, "region")

    # Make sure the injected var is NOT set in the environment so the
    # seeder cannot resolve it from os.environ either.
    monkeypatch.delenv(INJECTED_VAR, raising=False)

    project_dir = driver.fetch_and_unzip(jwt, project_id, work_dir)

    # Inject an env_var() reference into the active target's settings so
    # ``seed_profile``'s active-target walk reaches it. Adding under
    # ``outputs.dev.settings`` reflects the v1 test injection's intent
    # (the export template grew a new credential reference the seeder
    # has not been updated to handle).
    profile_path = project_dir / "profiles.yml"
    body = yaml.safe_load(profile_path.read_text())
    for profile in body.values():
        outputs = profile.get("outputs", {}) if isinstance(profile, dict) else {}
        dev = outputs.get(profile.get("target")) if isinstance(profile, dict) else None
        if isinstance(dev, dict):
            settings = dev.setdefault("settings", {})
            if isinstance(settings, dict):
                settings["_dc_test_injection"] = (
                    "{{ env_var('" + INJECTED_VAR + "') }}"
                )
    profile_path.write_text(yaml.safe_dump(body, sort_keys=False))

    with pytest.raises(EnvVarMissingError) as exc_info:
        driver.seed_profile(project_dir)

    assert INJECTED_VAR in exc_info.value.missing, (
        f"EnvVarMissingError.missing={exc_info.value.missing!r} should name "
        f"the unresolved variable {INJECTED_VAR!r}"
    )
    assert INJECTED_VAR in str(exc_info.value), (
        f"EnvVarMissingError message {str(exc_info.value)!r} should mention "
        f"the unresolved variable {INJECTED_VAR!r}"
    )
