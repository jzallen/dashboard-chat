"""Unit tests for DuckDBProfileSeeder.

Step 00-02 — see docs/feature/dbt-test-validation/deliver/roadmap.json.

The seeder is a pure utility (no async, no subprocess, no dbt invocation):
it maps a `minio_creds` dict to a concrete `profiles.yml` that DuckDB's
httpfs extension can use to read parquet from MinIO. Its failure-mode
contract is part of the substrate-lie defence layer (ADR-018 §Decision
Outcome Mechanism step 3): missing keys raise a `RuntimeError` that
NAMES the missing key, never silently substituting an empty value.

The seeder ALSO accepts a `profile_name` argument so the written
profiles.yml uses the same top-level key the exported `dbt_project.yml`
references via its `profile:` field. The exporter generates per-project
names like `dataset_staging_<snake-cased ULID>` (see
backend/app/use_cases/project/_dbt/project_yml.py); a hardcoded sentinel
would never line up with what dbt looks up.

PORT-TO-PORT: the seeder is a leaf utility; `seed(tmpdir, minio_creds, profile_name)`
IS the driving port. Tests call it directly with a real `tmp_path`.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from tests.integration.dataset_layer.eject.seeder import DuckDBProfileSeeder

REQUIRED_KEYS = ("endpoint_url", "access_key", "secret_key", "bucket", "region")


def _full_creds() -> dict[str, str]:
    return {
        "endpoint_url": "http://minio:9000",
        "access_key": "minioadmin",
        "secret_key": "minioadmin",
        "bucket": "dashboard-chat",
        "region": "us-east-1",
    }


class TestSeedHappyPath:
    """Behavior 1: seed writes a concrete profiles.yml from minio_creds under
    the provided profile_name as its single top-level YAML key."""

    def test_writes_profiles_yml_with_concrete_s3_credentials(self, tmp_path: Path) -> None:
        seeder = DuckDBProfileSeeder()

        profile_path = seeder.seed(tmp_path, _full_creds(), profile_name="test_profile")

        # Returned path is the seeded file inside tmp_path
        assert profile_path == tmp_path / "profiles.yml"
        assert profile_path.exists()

        # Parse the yaml and assert it contains concrete creds (no env_var(...) stubs)
        loaded = yaml.safe_load(profile_path.read_text())
        rendered = profile_path.read_text()
        assert "env_var(" not in rendered, (
            "seeded profile must substitute env_var(...) placeholders with "
            "concrete values; otherwise DuckDB httpfs has nothing to bind"
        )

        # Single top-level project key matching profile_name
        assert isinstance(loaded, dict) and len(loaded) == 1
        project_name = next(iter(loaded))
        assert project_name == "test_profile", (
            f"top-level YAML key must equal the provided profile_name; got {project_name!r}"
        )
        outputs = loaded[project_name]["outputs"]
        assert "dev" in outputs
        dev = outputs["dev"]

        # Concrete S3 creds wired through (httpfs extension contract)
        assert dev["s3_endpoint"] == "minio:9000"  # scheme stripped or kept
        assert dev["s3_access_key_id"] == "minioadmin"
        assert dev["s3_secret_access_key"] == "minioadmin"
        assert dev["s3_region"] == "us-east-1"
        assert dev["s3_url_style"] == "path"
        # DuckDB target file lives inside the seeded tmpdir
        assert str(tmp_path) in dev["path"]
        assert dev["path"].endswith("duckdb.db")

    def test_top_level_key_matches_profile_name_argument(self, tmp_path: Path) -> None:
        """The exporter generates project-specific profile names like
        `dataset_staging_<snake-cased ULID>`. The seeder must honour
        whatever name the caller passes — a hardcoded sentinel would
        never line up with dbt's profile lookup."""
        seeder = DuckDBProfileSeeder()

        profile_path = seeder.seed(
            tmp_path,
            _full_creds(),
            profile_name="dataset_staging_01h_test_ulid",
        )

        loaded = yaml.safe_load(profile_path.read_text())
        assert list(loaded.keys()) == ["dataset_staging_01h_test_ulid"], (
            "profiles.yml must have exactly one top-level key matching "
            f"the supplied profile_name; got keys={list(loaded.keys())!r}"
        )


class TestSeedErrorPath:
    """Behavior 2: missing required key raises RuntimeError naming the key."""

    def test_raises_runtime_error_naming_missing_endpoint_url(self, tmp_path: Path) -> None:
        seeder = DuckDBProfileSeeder()
        creds = _full_creds()
        del creds["endpoint_url"]

        with pytest.raises(RuntimeError) as exc_info:
            seeder.seed(tmp_path, creds, profile_name="test_profile")

        assert "endpoint_url" in str(exc_info.value)

    @pytest.mark.parametrize("missing_key", REQUIRED_KEYS)
    def test_raises_runtime_error_naming_any_missing_required_key(self, tmp_path: Path, missing_key: str) -> None:
        seeder = DuckDBProfileSeeder()
        creds = _full_creds()
        del creds[missing_key]

        with pytest.raises(RuntimeError) as exc_info:
            seeder.seed(tmp_path, creds, profile_name="test_profile")

        # The missing key name MUST appear in the message — substrate-lie defense
        assert missing_key in str(exc_info.value), (
            f"RuntimeError must name the missing key '{missing_key}'; got: {exc_info.value!r}"
        )
