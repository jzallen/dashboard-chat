from returns.result import Success

from app.repositories import set_session
from app.use_cases.query_engine.list_query_engines import list_query_engines
from tests.uuidv7_fixtures import ORG_1, ORG_OTHER


async def test_list_query_engines_returns_engines_for_org(seeded_db):
    """Should return all query engine nodes for the given organization."""
    set_session(seeded_db)
    result = await list_query_engines(ORG_1)

    assert isinstance(result, Success)
    engines = result.unwrap()
    assert len(engines) == 2
    names = {e.name for e in engines}
    assert "Production Engine" in names
    assert "Staging Engine" in names


async def test_list_query_engines_empty_for_other_org(seeded_db):
    """Should return empty list for an org with no engines."""
    set_session(seeded_db)
    result = await list_query_engines(ORG_OTHER)

    assert isinstance(result, Success)
    engines = result.unwrap()
    assert len(engines) == 0


async def test_list_query_engines_excludes_password(seeded_db):
    """Should not expose admin_password_encrypted in the results."""
    set_session(seeded_db)
    result = await list_query_engines(ORG_1)

    assert isinstance(result, Success)
    engines = result.unwrap()
    for engine in engines:
        assert not hasattr(engine, "admin_password_encrypted")
