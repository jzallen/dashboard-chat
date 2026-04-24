"""Tests for sql_access._datasets helper functions."""

from types import SimpleNamespace

from app.use_cases.sql_access import _datasets as datasets_module
from app.use_cases.sql_access._datasets import load_full_datasets


class _FakeMetadataRepo:
    def __init__(self, records):
        self._records = records
        self.calls: list[tuple[str, bool]] = []

    async def list_datasets(self, project_id: str, *, include_transforms: bool):
        self.calls.append((project_id, include_transforms))
        return self._records, len(self._records), 0


def _patch_from_record(monkeypatch):
    """Replace Dataset.from_record with a recording stub.

    Returns (recorded_calls, sentinel_factory) where recorded_calls is a list of
    (record, include_transforms) tuples observed, and sentinel_factory produces a
    unique marker object for each call so ordering can be asserted.
    """
    calls: list[tuple[object, bool]] = []

    def fake_from_record(record, *, include_transforms=True, preview_rows=None):
        calls.append((record, include_transforms))
        return SimpleNamespace(_sentinel=record, _include_transforms=include_transforms)

    monkeypatch.setattr(datasets_module.Dataset, "from_record", fake_from_record)
    return calls


class TestLoadFullDatasets:
    async def test_defaults_to_include_transforms_true(self, monkeypatch):
        record_a = SimpleNamespace(id="ds-a")
        record_b = SimpleNamespace(id="ds-b")
        repo = _FakeMetadataRepo(records=[record_a, record_b])
        from_record_calls = _patch_from_record(monkeypatch)

        result = await load_full_datasets("project-1", repo)

        assert repo.calls == [("project-1", True)]
        assert from_record_calls == [(record_a, True), (record_b, True)]
        assert [d._sentinel for d in result] == [record_a, record_b]
        assert all(d._include_transforms is True for d in result)

    async def test_propagates_include_transforms_false(self, monkeypatch):
        record_a = SimpleNamespace(id="ds-a")
        record_b = SimpleNamespace(id="ds-b")
        repo = _FakeMetadataRepo(records=[record_a, record_b])
        from_record_calls = _patch_from_record(monkeypatch)

        result = await load_full_datasets("project-1", repo, include_transforms=False)

        assert repo.calls == [("project-1", False)]
        assert from_record_calls == [(record_a, False), (record_b, False)]
        assert all(d._include_transforms is False for d in result)

    async def test_returns_empty_list_when_repo_returns_no_records(self, monkeypatch):
        repo = _FakeMetadataRepo(records=[])
        from_record_calls = _patch_from_record(monkeypatch)

        result = await load_full_datasets("project-empty", repo)

        assert result == []
        assert repo.calls == [("project-empty", True)]
        assert from_record_calls == []
