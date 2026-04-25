"""Port-level unit tests for the sql_access shared context helper.

Covers the behavioural matrix of ``load_context``: project preamble,
fetch_variant dispatch, and the require_enabled / forbid_enabled guards.
No DB; uses SimpleNamespace stubs for repositories and a module-level
monkeypatch for ProjectService.
"""

from types import SimpleNamespace

import pytest

from app.use_cases.sql_access import _context
from app.use_cases.sql_access._context import SqlAccessContext, load_context
from app.use_cases.sql_access.exceptions import (
    SqlAccessAlreadyEnabled,
    SqlAccessNotEnabled,
)


class _FakeExternalAccessRepo:
    """Records which fetch method was called and returns a canned record."""

    def __init__(self, record: object | None = None):
        self._record = record
        self.plain_calls: list[str] = []
        self.for_update_calls: list[str] = []
        self.with_hash_calls: list[str] = []

    async def get_by_project_id(self, project_id: str):
        self.plain_calls.append(project_id)
        return self._record

    async def get_by_project_id_for_update(self, project_id: str):
        self.for_update_calls.append(project_id)
        return self._record

    async def get_by_project_id_with_hash(self, project_id: str):
        self.with_hash_calls.append(project_id)
        return self._record


class _FakeProjectService:
    """Stands in for app.use_cases.project.project_service.ProjectService."""

    instances: list["_FakeProjectService"] = []

    def __init__(self, repositories):
        self.repositories = repositories
        self.fetch_calls: list[str] = []
        _FakeProjectService.instances.append(self)

    async def fetch_project(self, project_id: str) -> dict:
        self.fetch_calls.append(project_id)
        return {"id": project_id, "name": "Fetched Project"}


@pytest.fixture(autouse=True)
def patch_project_service(monkeypatch):
    """Swap ProjectService at the module where _context imports it."""
    _FakeProjectService.instances = []
    monkeypatch.setattr(_context, "ProjectService", _FakeProjectService)
    yield
    _FakeProjectService.instances = []


def _repos(record: object | None = None) -> SimpleNamespace:
    return SimpleNamespace(external_access=_FakeExternalAccessRepo(record))


class TestLoadContextPreamble:
    async def test_fetches_project_when_none(self):
        repos = _repos()
        ctx = await load_context(project_id="p1", project=None, repositories=repos)
        assert len(_FakeProjectService.instances) == 1
        assert _FakeProjectService.instances[0].fetch_calls == ["p1"]
        assert ctx.project == {"id": "p1", "name": "Fetched Project"}

    async def test_skips_project_fetch_when_provided(self):
        repos = _repos()
        preloaded = {"id": "p1", "name": "Preloaded"}
        ctx = await load_context(project_id="p1", project=preloaded, repositories=repos)
        assert _FakeProjectService.instances == []
        assert ctx.project is preloaded


class TestLoadContextFetchVariant:
    @pytest.mark.parametrize(
        "variant,active_attr,idle_attrs",
        [
            ("plain", "plain_calls", ("for_update_calls", "with_hash_calls")),
            ("for_update", "for_update_calls", ("plain_calls", "with_hash_calls")),
            ("with_hash", "with_hash_calls", ("plain_calls", "for_update_calls")),
        ],
    )
    async def test_dispatches_to_correct_repo_method(self, variant, active_attr, idle_attrs):
        repos = _repos()
        await load_context(
            project_id="p1",
            project={"id": "p1"},
            repositories=repos,
            fetch_variant=variant,
        )
        repo = repos.external_access
        assert getattr(repo, active_attr) == ["p1"]
        for idle in idle_attrs:
            assert getattr(repo, idle) == []


class TestLoadContextRequireEnabled:
    async def test_raises_when_access_record_missing(self):
        repos = _repos(record=None)
        with pytest.raises(SqlAccessNotEnabled) as exc:
            await load_context(
                project_id="p1",
                project={"id": "p1"},
                repositories=repos,
                require_enabled=True,
            )
        assert "p1" in str(exc.value)

    async def test_raises_when_access_record_disabled(self):
        repos = _repos(record=SimpleNamespace(enabled=False))
        with pytest.raises(SqlAccessNotEnabled):
            await load_context(
                project_id="p1",
                project={"id": "p1"},
                repositories=repos,
                require_enabled=True,
            )

    async def test_returns_context_when_enabled(self):
        record = SimpleNamespace(enabled=True, pg_schema="s1")
        repos = _repos(record=record)
        ctx = await load_context(
            project_id="p1",
            project={"id": "p1"},
            repositories=repos,
            require_enabled=True,
        )
        assert ctx.access_record is record


class TestLoadContextForbidEnabled:
    async def test_raises_when_access_record_enabled(self):
        repos = _repos(record=SimpleNamespace(enabled=True))
        with pytest.raises(SqlAccessAlreadyEnabled) as exc:
            await load_context(
                project_id="p1",
                project={"id": "p1"},
                repositories=repos,
                forbid_enabled=True,
            )
        assert "p1" in str(exc.value)

    @pytest.mark.parametrize(
        "record",
        [None, SimpleNamespace(enabled=False)],
        ids=["none", "disabled"],
    )
    async def test_allows_when_not_enabled(self, record):
        repos = _repos(record=record)
        ctx = await load_context(
            project_id="p1",
            project={"id": "p1"},
            repositories=repos,
            forbid_enabled=True,
        )
        assert ctx.access_record is record


class TestLoadContextNoGuards:
    @pytest.mark.parametrize(
        "record",
        [None, SimpleNamespace(enabled=False), SimpleNamespace(enabled=True)],
        ids=["none", "disabled", "enabled"],
    )
    async def test_returns_context_regardless_of_access_record(self, record):
        repos = _repos(record=record)
        ctx = await load_context(
            project_id="p1",
            project={"id": "p1"},
            repositories=repos,
        )
        assert isinstance(ctx, SqlAccessContext)
        assert ctx.project == {"id": "p1"}
        assert ctx.access_record is record


class TestSqlAccessContextDataclass:
    def test_is_frozen(self):
        ctx = SqlAccessContext(project={"id": "p1"}, access_record=None)
        with pytest.raises((AttributeError, Exception)):
            ctx.project = {"id": "p2"}  # type: ignore[misc]
