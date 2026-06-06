"""Round-trip test for migration 017 (assistant_audit_entries spine + reversed FK).

Runs ``alembic upgrade head`` then ``downgrade -1`` then ``upgrade head`` again
on a throwaway file-backed SQLite database, asserting the new table, the reversed
FK column on ``transforms``, and the required indexes appear/disappear correctly.

This proves the migration is portable under SQLite's limited ALTER support (the
``transforms`` alter uses ``op.batch_alter_table``) and that the down path is
clean — the brownfield analog of the walking skeleton for a schema change.
"""

import sqlite3
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

REVISION = "d7e8f9a0b1c2"  # pragma: allowlist secret
DOWN_REVISION = "c6d7e8f9a0b1"  # pragma: allowlist secret

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


def _table_names(db_path: Path) -> set[str]:
    conn = sqlite3.connect(db_path)
    try:
        return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        conn.close()


def _transform_columns(db_path: Path) -> set[str]:
    conn = sqlite3.connect(db_path)
    try:
        return {r[1] for r in conn.execute("PRAGMA table_info(transforms)")}
    finally:
        conn.close()


def _index_names(db_path: Path) -> set[str]:
    conn = sqlite3.connect(db_path)
    try:
        return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    finally:
        conn.close()


def _transform_foreign_keys(db_path: Path) -> list[tuple]:
    conn = sqlite3.connect(db_path)
    try:
        # (referenced_table, from_col, to_col, on_delete)
        return [(r[2], r[3], r[4], r[6]) for r in conn.execute("PRAGMA foreign_key_list(transforms)")]
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


def test_upgrade_creates_spine_and_reversed_fk(db_path: Path, monkeypatch):
    cfg = _alembic_config(db_path, monkeypatch)
    command.upgrade(cfg, "head")

    assert "assistant_audit_entries" in _table_names(db_path)
    assert "assistant_audit_entry_id" in _transform_columns(db_path)

    indexes = _index_names(db_path)
    assert "ix_assistant_audit_entries_org_id" in indexes
    assert "ix_assistant_audit_entries_project_id" in indexes
    assert "ix_assistant_audit_entries_node_id" in indexes
    assert "ix_transforms_assistant_audit_entry_id" in indexes

    fks = _transform_foreign_keys(db_path)
    assert ("assistant_audit_entries", "assistant_audit_entry_id", "id", "SET NULL") in fks
    # The pre-existing CASCADE FK to datasets must survive the batch alter.
    assert ("datasets", "dataset_id", "id", "CASCADE") in fks


def test_downgrade_removes_spine_and_reversed_fk(db_path: Path, monkeypatch):
    cfg = _alembic_config(db_path, monkeypatch)
    command.upgrade(cfg, "head")
    command.downgrade(cfg, DOWN_REVISION)

    assert "assistant_audit_entries" not in _table_names(db_path)
    assert "assistant_audit_entry_id" not in _transform_columns(db_path)
    assert "ix_transforms_assistant_audit_entry_id" not in _index_names(db_path)


def test_round_trip_is_idempotent(db_path: Path, monkeypatch):
    cfg = _alembic_config(db_path, monkeypatch)
    command.upgrade(cfg, "head")
    command.downgrade(cfg, DOWN_REVISION)
    command.upgrade(cfg, "head")

    assert "assistant_audit_entries" in _table_names(db_path)
    assert "assistant_audit_entry_id" in _transform_columns(db_path)
