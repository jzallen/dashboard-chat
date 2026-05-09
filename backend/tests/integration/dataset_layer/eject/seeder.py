"""DuckDB profile seeder for the eject-then-test harness.

Writes a concrete ``profiles.yml`` overriding the export's
``env_var(...)`` placeholders for MinIO. The exported dbt project ships
a profile with placeholders such as ``env_var('S3_ACCESS_KEY_ID')``
(see ``features/dbt-project-export.feature`` line ~47); the test
environment substitutes the compose stack's MinIO credentials so
DuckDB's httpfs extension can actually reach the bucket.

The seeder also honours the caller-supplied ``profile_name`` so the
written ``profiles.yml`` uses the same top-level key the exported
``dbt_project.yml`` references via its ``profile:`` field. The exporter
generates per-project names like ``dataset_staging_<snake-cased ULID>``
(see ``backend/app/use_cases/project/_dbt/project_yml.py``); a hardcoded
sentinel would never line up with what dbt looks up at build time.

Failure-mode contract (ADR-019 §Decision Outcome Mechanism step 3):
when the caller passes a ``minio_creds`` dict missing a required key,
``seed()`` raises ``RuntimeError`` with a debugging-friendly message
that NAMES the missing key. It does NOT silently substitute an empty
value — that is exactly the substrate-lie pattern the
``probe_minio_readable_via_duckdb`` Phase-0 probe defends against.
"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

import yaml

_REQUIRED_KEYS: tuple[str, ...] = (
    "endpoint_url",
    "access_key",
    "secret_key",
    "bucket",
    "region",
)


class DuckDBProfileSeeder:
    """Generates a concrete ``profiles.yml`` for the ejected dbt project.

    The seeder is a pure utility: no I/O beyond writing the yaml file,
    no async, no subprocess. Its public driving port is :meth:`seed`.
    """

    def seed(
        self,
        tmpdir: Path,
        minio_creds: Mapping[str, str],
        *,
        profile_name: str,
    ) -> Path:
        """Write ``profiles.yml`` into ``tmpdir`` and return its path.

        Parameters
        ----------
        tmpdir:
            Directory the seeded ``profiles.yml`` is written to. Also
            houses the DuckDB target file referenced by the ``dev``
            output (``tmpdir/duckdb.db``).
        minio_creds:
            Mapping with the concrete MinIO credentials. Required keys:
            ``endpoint_url``, ``access_key``, ``secret_key``, ``bucket``,
            ``region``. Missing any of these raises ``RuntimeError``
            naming the offending key.
        profile_name:
            Top-level key under which the profile body is written. Must
            match the ``profile:`` field of the exported dbt project's
            ``dbt_project.yml`` — otherwise ``dbt build`` fails with
            "Could not find profile named '...'".

        Raises
        ------
        RuntimeError
            When ``minio_creds`` is missing a required key, or when
            ``profile_name`` is empty. The message names the offending
            input so debugging is mechanical, not archaeological.
        """
        if not profile_name:
            raise RuntimeError("profile seed failed: profile_name must be a non-empty string")

        for key in _REQUIRED_KEYS:
            if key not in minio_creds:
                raise RuntimeError(f"profile seed failed: missing required minio credential '{key}'")

        endpoint = self._strip_scheme(minio_creds["endpoint_url"])

        # dbt-duckdb only honours s3_* keys when they are nested under
        # `settings:` — at that level the adapter emits them as DuckDB
        # `SET s3_<key>=<value>` statements at connect time. Bare keys at
        # the output level are silently dropped, leaving DuckDB on its
        # default config (no endpoint override, vhost URL style) which
        # then resolves the bucket against AWS public S3 instead of the
        # MinIO compose service. The export's profiles.yml template uses
        # the same `settings:` shape — keeping the seeder aligned means
        # the customer's `dbt build` and the harness's invocation hit
        # DuckDB the same way.
        profile = {
            profile_name: {
                "target": "dev",
                "outputs": {
                    "dev": {
                        "type": "duckdb",
                        "path": str(tmpdir / "duckdb.db"),
                        "extensions": ["httpfs"],
                        "settings": {
                            "s3_endpoint": endpoint,
                            "s3_use_ssl": False,
                            "s3_region": minio_creds["region"],
                            "s3_access_key_id": minio_creds["access_key"],
                            "s3_secret_access_key": minio_creds["secret_key"],
                            "s3_url_style": "path",
                        },
                    },
                },
            },
        }

        profile_path = tmpdir / "profiles.yml"
        profile_path.write_text(yaml.safe_dump(profile, sort_keys=False))
        return profile_path

    @staticmethod
    def _strip_scheme(endpoint_url: str) -> str:
        """DuckDB's ``s3_endpoint`` wants ``host:port``, not a URL."""
        for scheme in ("http://", "https://"):
            if endpoint_url.startswith(scheme):
                return endpoint_url[len(scheme) :]
        return endpoint_url
