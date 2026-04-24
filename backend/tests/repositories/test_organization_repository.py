"""Characterization tests for Organization operations on MetadataRepository.

Covers create_organization and get_organization.
"""

from tests.uuidv7_fixtures import ORG_1


class TestCreateOrganization:
    async def test_returns_dict_with_explicit_id(self, repo):
        result = await repo.create_organization(name="Acme Corp", id=ORG_1)
        assert result["id"] == ORG_1
        assert result["name"] == "Acme Corp"
        assert result["created_at"] is not None
        assert result["updated_at"] is not None

    async def test_autogenerates_id_when_omitted(self, repo):
        result = await repo.create_organization(name="Autogen Org")
        assert result["name"] == "Autogen Org"
        assert result["id"] is not None  # server_default uuidv7()


class TestGetOrganization:
    async def test_round_trip_create_then_read(self, repo):
        created = await repo.create_organization(name="Acme", id=ORG_1)
        fetched = await repo.get_organization(ORG_1)
        assert fetched is not None
        assert fetched["id"] == created["id"]
        assert fetched["name"] == "Acme"

    async def test_returns_none_when_not_found(self, repo):
        assert await repo.get_organization("nonexistent-id") is None
