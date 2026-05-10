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

        # Concrete S3 creds wired through under `settings:` — dbt-duckdb
        # emits these as DuckDB SET statements at connect time. Bare keys
        # at the output level are silently dropped, so the nesting matters.
        settings = dev["settings"]
        assert settings["s3_endpoint"] == "minio:9000"  # scheme stripped or kept
        assert settings["s3_access_key_id"] == "minioadmin"
        assert settings["s3_secret_access_key"] == "minioadmin"
        assert settings["s3_region"] == "us-east-1"
        assert settings["s3_url_style"] == "path"
        assert settings["s3_use_ssl"] is False
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


class TestSeedExportEnvVarValidation:
    """Behavior 3 (Phase 5): when the export's profiles.yml references an
    env_var the seeder doesn't recognise, ``seed()`` raises RuntimeError
    naming the unfamiliar variable.

    The seeder OVERWRITES the export's profiles.yml — anything the export
    referenced via ``env_var(...)`` is silently dropped unless the seeder
    knows about it. This validation surfaces NEW credential references
    so the seeder maintainer can either extend the substitution logic or
    explicitly tolerate the new var. Without it, an export-side change
    would silently green-pass the harness while the customer's actual
    `dbt build` lost a credential (design.md §13 Risk #1).
    """

    def _write_profiles(self, project_dir: Path, body: str) -> None:
        project_dir.mkdir(parents=True, exist_ok=True)
        (project_dir / "profiles.yml").write_text(body)

    def test_raises_when_existing_profiles_yml_references_unknown_env_var(self, tmp_path: Path) -> None:
        seeder = DuckDBProfileSeeder()
        # Simulate the unzipped export: profiles.yml at tmpdir, with one
        # familiar (S3_ACCESS_KEY_ID) and one unfamiliar (DC_TEST_UNSET)
        # env_var ref. The unfamiliar one must trigger the raise even
        # though the familiar one is fine.
        self._write_profiles(
            tmp_path,
            "profile:\n"
            "  outputs:\n"
            "    dev:\n"
            "      type: duckdb\n"
            "      settings:\n"
            "        s3_access_key_id: \"{{ env_var('S3_ACCESS_KEY_ID') }}\"\n"
            "        custom_secret: \"{{ env_var('DC_TEST_UNSET') }}\"\n",
        )

        with pytest.raises(RuntimeError) as exc_info:
            seeder.seed(tmp_path, _full_creds(), profile_name="test_profile")

        msg = str(exc_info.value)
        assert "DC_TEST_UNSET" in msg, f"RuntimeError must name the unfamiliar env_var; got: {msg!r}"

    def test_raises_naming_unfamiliar_var_even_when_default_is_provided(self, tmp_path: Path) -> None:
        """Defaults in the env_var() call do NOT excuse an unknown name.

        A default papers over a runtime concern (the var may be unset);
        Phase 5's check is a substrate-contract concern (the seeder
        maintainer must explicitly acknowledge each ref). A new var with
        a default is still a new var — surface it.
        """
        seeder = DuckDBProfileSeeder()
        self._write_profiles(
            tmp_path,
            "profile:\n"
            "  outputs:\n"
            "    dev:\n"
            "      type: duckdb\n"
            "      settings:\n"
            "        custom_with_default: \"{{ env_var('DC_NEW_REF', 'fallback') }}\"\n",
        )

        with pytest.raises(RuntimeError) as exc_info:
            seeder.seed(tmp_path, _full_creds(), profile_name="test_profile")

        assert "DC_NEW_REF" in str(exc_info.value)

    def test_tolerates_familiar_env_vars_in_existing_profiles_yml(self, tmp_path: Path) -> None:
        """The existing M3/WS exports reference S3_* and PG_* env_vars —
        all of which are either substituted by the seeder's settings:
        block (S3_*) or removed by the seeder writing only the dev
        target (PG_*). No raise; the seeder proceeds to overwrite.
        """
        seeder = DuckDBProfileSeeder()
        # Approximation of the real export's profiles.yml content.
        self._write_profiles(
            tmp_path,
            "profile:\n"
            "  target: dev\n"
            "  outputs:\n"
            "    dev:\n"
            "      type: duckdb\n"
            "      settings:\n"
            "        s3_region: \"{{ env_var('S3_REGION', 'us-east-1') }}\"\n"
            "        s3_access_key_id: \"{{ env_var('S3_ACCESS_KEY_ID') }}\"\n"
            "        s3_secret_access_key: \"{{ env_var('S3_SECRET_ACCESS_KEY') }}\"\n"
            "        s3_endpoint: \"{{ env_var('S3_ENDPOINT', '') }}\"\n"
            "        s3_url_style: \"{{ env_var('S3_URL_STYLE', 'vhost') }}\"\n"
            "    postgres:\n"
            "      type: postgres\n"
            "      user: \"{{ env_var('PG_USER') }}\"\n"
            "      password: \"{{ env_var('PG_PASSWORD') }}\"\n",
        )

        # Should not raise.
        path = seeder.seed(tmp_path, _full_creds(), profile_name="test_profile")
        assert path.exists()

    def test_no_existing_profiles_yml_means_no_validation(self, tmp_path: Path) -> None:
        """Probe-time seeding (fresh tmpdir, no export to inspect) is
        unaffected by the env_var validation — the orchestrator's
        ``_invoke_minio_probe`` writes into a fresh probe directory
        without an existing profiles.yml.
        """
        seeder = DuckDBProfileSeeder()
        # No profiles.yml at tmpdir before seed() — same shape probe uses.
        path = seeder.seed(tmp_path, _full_creds(), profile_name="probe_profile")
        assert path == tmp_path / "profiles.yml"
        assert path.exists()
