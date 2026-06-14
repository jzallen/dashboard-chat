"""Round-trip test for migration 020 (datasets.model_name + backfill).

Runs ``alembic upgrade head`` then ``downgrade -1`` then ``upgrade head`` again
on a throwaway file-backed SQLite database, asserting the new ``model_name``
column on ``datasets`` appears/disappears correctly and that ``upgrade()``
backfills an existing pre-migration row's ``model_name`` from its
``display_name`` as ``stg_<snake>`` (matching ``stg_model_name`` byte-for-byte).

The brownfield analog of the walking skeleton for a schema change: proves the
column add is portable under SQLite, the down path is clean, and the data
backfill is correct.
"""

import sqlite3
import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

REVISION = "b0c1d2e3f4a5"  # pragma: allowlist secret — 020_add_dataset_model_name
DOWN_REVISION = "f9a0b1c2d3e4"  # pragma: allowlist secret — 019_add_sources_table

_MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"


def _alembic_config(db_path: Path, monkeypatch) -> Config:
    # env.py overrides ``sqlalchemy.url`` from ``settings.database_url`` and runs
    # async, so point the app config at an aiosqlite file DB and bust the
    # ``get_settings`` lru_cache so env.py picks it up.
    from app import config as app_config

    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")
    app_config.get_settings.cache_clear()

    cfg = Config(str(_MIGRATIONS_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_MIGRATIONS_DIR))
    return cfg


def _dataset_columns(db_path: Path) -> set[str]:
    conn = sqlite3.connect(db_path)
    try:
        return {r[1] for r in conn.execute("PRAGMA table_info(datasets)")}
    finally:
        conn.close()


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "round_trip.db"


@pytest.fixture(autouse=True)
def _restore_settings_cache():
    """Bust + restore the app settings cache so the override doesn't leak."""
    from app import config as app_config

    yield
    app_config.get_settings.cache_clear()


def test_upgrade_adds_model_name_column(db_path: Path, monkeypatch):
    cfg = _alembic_config(db_path, monkeypatch)
    command.upgrade(cfg, REVISION)

    assert "model_name" in _dataset_columns(db_path)


def test_downgrade_removes_model_name_column(db_path: Path, monkeypatch):
    cfg = _alembic_config(db_path, monkeypatch)
    command.upgrade(cfg, REVISION)
    command.downgrade(cfg, DOWN_REVISION)

    assert "model_name" not in _dataset_columns(db_path)


def test_round_trip_is_idempotent(db_path: Path, monkeypatch):
    cfg = _alembic_config(db_path, monkeypatch)
    command.upgrade(cfg, REVISION)
    command.downgrade(cfg, DOWN_REVISION)
    command.upgrade(cfg, REVISION)

    assert "model_name" in _dataset_columns(db_path)


def test_upgrade_backfills_model_name_from_display_name(db_path: Path, monkeypatch):
    """A row that predates 020 (model_name absent) is backfilled to
    ``stg_<snake(display_name)>`` by ``upgrade()``."""
    cfg = _alembic_config(db_path, monkeypatch)

    # Migrate up to (but not including) 020 so the row exists pre-column.
    command.upgrade(cfg, DOWN_REVISION)

    project_id = str(uuid.uuid4())
    dataset_id = str(uuid.uuid4())
    conn = sqlite3.connect(db_path)
    try:
        now = "2026-06-14 00:00:00"
        conn.execute(
            "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (project_id, "Proj", now, now),
        )
        conn.execute(
            "INSERT INTO datasets "
            "(id, project_id, name, display_name, schema_config, partition_fields, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, '{}', '[]', ?, ?)",
            (dataset_id, project_id, "customers.csv", "Q1 Revenue", now, now),
        )
        conn.commit()
    finally:
        conn.close()

    command.upgrade(cfg, REVISION)

    conn = sqlite3.connect(db_path)
    try:
        (model_name,) = conn.execute("SELECT model_name FROM datasets WHERE id = ?", (dataset_id,)).fetchone()
    finally:
        conn.close()

    assert model_name == "stg_q1_revenue"
