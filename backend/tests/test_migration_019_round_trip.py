"""Round-trip test for migration 019 (sources table + datasets.source_id).

Runs ``alembic upgrade head`` then ``downgrade -1`` then ``upgrade head`` again
on a throwaway file-backed SQLite database, asserting the ``sources`` table and
the nullable ``datasets.source_id`` column appear/disappear correctly.

Proves the migration is portable (plain create_table/add_column, no batch mode,
no alter_column) and that the down path is clean in BOTH directions.
"""

import sqlite3
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

DOWN_REVISION = "e8f9a0b1c2d3"  # 018 head  # pragma: allowlist secret

_MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"


def _alembic_config(db_path: Path, monkeypatch) -> Config:
    from app import config as app_config

    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")
    app_config.get_settings.cache_clear()

    cfg = Config(str(_MIGRATIONS_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_MIGRATIONS_DIR))
    return cfg


def _table_names(db_path: Path) -> set[str]:
    conn = sqlite3.connect(db_path)
    try:
        return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        conn.close()


def _columns(db_path: Path, table: str) -> dict[str, tuple]:
    conn = sqlite3.connect(db_path)
    try:
        # name -> (type, notnull, default)
        return {r[1]: (r[2], r[3], r[4]) for r in conn.execute(f"PRAGMA table_info({table})")}
    finally:
        conn.close()


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "round_trip.db"


@pytest.fixture(autouse=True)
def _restore_settings_cache():
    from app import config as app_config

    yield
    app_config.get_settings.cache_clear()


def test_upgrade_creates_sources_table(db_path: Path, monkeypatch):
    cfg = _alembic_config(db_path, monkeypatch)
    command.upgrade(cfg, "head")

    assert "sources" in _table_names(db_path)
    columns = _columns(db_path, "sources")
    assert set(columns) >= {"id", "project_id", "name", "schema_config", "created_by", "created_at", "updated_at"}
    # created_by is nullable
    assert columns["created_by"][1] == 0


def test_upgrade_adds_nullable_source_id_on_datasets(db_path: Path, monkeypatch):
    cfg = _alembic_config(db_path, monkeypatch)
    command.upgrade(cfg, "head")

    columns = _columns(db_path, "datasets")
    assert "source_id" in columns
    assert columns["source_id"][1] == 0  # nullable
    assert columns["source_id"][2] is None  # no default


def test_downgrade_removes_sources_and_source_id(db_path: Path, monkeypatch):
    cfg = _alembic_config(db_path, monkeypatch)
    command.upgrade(cfg, "head")
    command.downgrade(cfg, DOWN_REVISION)

    assert "sources" not in _table_names(db_path)
    assert "source_id" not in _columns(db_path, "datasets")


def test_round_trip_is_idempotent(db_path: Path, monkeypatch):
    cfg = _alembic_config(db_path, monkeypatch)
    command.upgrade(cfg, "head")
    command.downgrade(cfg, DOWN_REVISION)
    command.upgrade(cfg, "head")

    assert "sources" in _table_names(db_path)
    assert "source_id" in _columns(db_path, "datasets")
