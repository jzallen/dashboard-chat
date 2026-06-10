"""Round-trip test for migration 018 (nullable organizations.created_by).

Runs ``alembic upgrade head`` then ``downgrade -1`` then ``upgrade head`` again
on a throwaway file-backed SQLite database, asserting the nullable
``created_by`` column on ``organizations`` appears/disappears correctly.

This proves the migration is portable (plain add_column/drop_column, no batch
mode) and that the down path is clean — the brownfield analog of the walking
skeleton for a schema change.
"""

import sqlite3
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

DOWN_REVISION = "d7e8f9a0b1c2"  # 017 head  # pragma: allowlist secret

_MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"


def _alembic_config(db_path: Path, monkeypatch) -> Config:
    # env.py overrides ``sqlalchemy.url`` from ``settings.database_url`` and runs
    # async, so point the app config at an aiosqlite file DB and bust the
    # ``get_settings`` lru_cache so env.py picks it up.
    from app import config as app_config

    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")
    app_config.get_settings.cache_clear()

    cfg = Config(str(_MIGRATIONS_DIR / "alembic.ini"))
    # script_location is "." relative to the ini in the repo; make it absolute so
    # the test is cwd-independent.
    cfg.set_main_option("script_location", str(_MIGRATIONS_DIR))
    return cfg


def _organization_columns(db_path: Path) -> dict[str, tuple]:
    conn = sqlite3.connect(db_path)
    try:
        # name -> (type, notnull, default)
        return {r[1]: (r[2], r[3], r[4]) for r in conn.execute("PRAGMA table_info(organizations)")}
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


def test_upgrade_adds_nullable_created_by(db_path: Path, monkeypatch):
    cfg = _alembic_config(db_path, monkeypatch)
    command.upgrade(cfg, "head")

    columns = _organization_columns(db_path)
    assert "created_by" in columns
    _type, notnull, default = columns["created_by"]
    assert notnull == 0  # nullable
    assert default is None  # no default — existing rows stay valid as NULL


def test_existing_rows_remain_valid_after_upgrade(db_path: Path, monkeypatch):
    cfg = _alembic_config(db_path, monkeypatch)
    command.upgrade(cfg, DOWN_REVISION)

    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "INSERT INTO organizations (id, name, created_at, updated_at)"
            " VALUES ('org-pre-018', 'Pre-018 Org', '2026-06-10 00:00:00', '2026-06-10 00:00:00')"
        )
        conn.commit()
    finally:
        conn.close()

    command.upgrade(cfg, "head")

    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute("SELECT id, created_by FROM organizations WHERE id = 'org-pre-018'").fetchall()
    finally:
        conn.close()
    assert rows == [("org-pre-018", None)]


def test_downgrade_removes_created_by(db_path: Path, monkeypatch):
    cfg = _alembic_config(db_path, monkeypatch)
    command.upgrade(cfg, "head")
    command.downgrade(cfg, DOWN_REVISION)

    assert "created_by" not in _organization_columns(db_path)


def test_round_trip_is_idempotent(db_path: Path, monkeypatch):
    cfg = _alembic_config(db_path, monkeypatch)
    command.upgrade(cfg, "head")
    command.downgrade(cfg, DOWN_REVISION)
    command.upgrade(cfg, "head")

    assert "created_by" in _organization_columns(db_path)
