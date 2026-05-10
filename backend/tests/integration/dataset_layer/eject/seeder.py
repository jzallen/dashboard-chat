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

Export-contract defense (Phase 5, design.md §13 Risk #1): when the
unzipped export contains a ``profiles.yml`` referencing an
``env_var(...)`` name the seeder does not recognise, ``seed()`` raises
``RuntimeError`` naming the unfamiliar var. The seeder OVERWRITES the
exported profile in full — without this check, a future change to
``backend/app/use_cases/project/_dbt/profiles_yml.py`` that adds a new
credential reference would be silently dropped, leaving the customer's
real ``dbt build`` to fail later with a confusing error far from the
edit. Either extend ``_KNOWN_EXPORT_ENV_VARS`` (when the seeder's
overwrite covers the new var implicitly) or extend the substitution
logic itself.
"""

from __future__ import annotations

import re
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

# Env vars the seeder explicitly handles. S3_* values land in the
# settings: block as concrete substitutions (from minio_creds); the
# postgres PG_* references are removed entirely because the seeder
# writes only the dev output. Updating this set is a deliberate
# substrate-contract change — see module docstring.
_KNOWN_EXPORT_ENV_VARS: frozenset[str] = frozenset(
    {
        # Substituted via settings: block from minio_creds.
        "S3_REGION",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
        "S3_ENDPOINT",
        "S3_URL_STYLE",
        "S3_USE_SSL",
        "S3_BUCKET",
        # Postgres target removed by the seeder's overwrite.
        "PG_HOST",
        "PG_PORT",
        "PG_USER",
        "PG_PASSWORD",
        "PG_DATABASE",
        "PG_SCHEMA",
    }
)

# Capture group 1 is the env_var NAME. Defaults / filters after the name
# are intentionally not parsed — the seeder's contract is "every name
# must be acknowledged," independent of runtime defaults.
_ENV_VAR_REF_PATTERN = re.compile(r"env_var\(\s*['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]")


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

        existing_profile = tmpdir / "profiles.yml"
        if existing_profile.exists():
            self._validate_existing_export(existing_profile.read_text())

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

    @staticmethod
    def _validate_existing_export(profiles_text: str) -> None:
        """Surface unfamiliar ``env_var(...)`` refs in the unzipped export.

        Phase 5 substrate-contract defense (design.md §13 Risk #1). The
        seeder is about to OVERWRITE this file in full — any env_var ref
        the seeder doesn't recognise would be silently dropped, so flag
        it loudly here. See module docstring for how to extend the
        recognised set when the export legitimately grows a new ref.
        """
        unfamiliar: list[str] = []
        seen: set[str] = set()
        for match in _ENV_VAR_REF_PATTERN.finditer(profiles_text):
            name = match.group(1)
            if name in seen:
                continue
            seen.add(name)
            if name not in _KNOWN_EXPORT_ENV_VARS:
                unfamiliar.append(name)
        if unfamiliar:
            names = ", ".join(unfamiliar)
            raise RuntimeError(
                "profile seed failed: exported profiles.yml references "
                f"env_var(s) the seeder does not recognise: {names}. "
                "The seeder overwrites profiles.yml in full, so unrecognised "
                "credential references would be silently dropped — extend "
                "_KNOWN_EXPORT_ENV_VARS in seeder.py (when the overwrite "
                "covers the new var implicitly) or extend the seeder's "
                "substitution logic."
            )
