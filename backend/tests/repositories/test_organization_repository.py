"""Characterization tests for Organization operations on MetadataRepository.

Covers create_organization, get_organization, and
get_organization_by_created_by.
"""

from datetime import UTC, datetime

from app.repositories.metadata import OrganizationRecord
from tests.uuidv7_fixtures import ORG_1, ORG_OTHER, USER_1


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


class TestGetOrganizationByCreatedBy:
    """DEV_NO_ORG (D1): resolve the org a principal owns via created_by."""

    async def test_returns_owned_org(self, repo):
        await repo.create_organization(name="Owned Org", id=ORG_1, created_by=USER_1)

        found = await repo.get_organization_by_created_by(USER_1)

        assert found is not None
        assert found["id"] == ORG_1
        assert found["name"] == "Owned Org"

    async def test_returns_none_when_user_owns_no_org(self, repo):
        await repo.create_organization(name="Someone Elses Org", id=ORG_1, created_by="someone-else")

        assert await repo.get_organization_by_created_by(USER_1) is None

    async def test_earliest_created_at_wins_with_two_orgs(self, repo, db_session):
        db_session.add(
            OrganizationRecord(
                id=ORG_OTHER,
                name="Later Org",
                created_by=USER_1,
                created_at=datetime(2026, 2, 1, tzinfo=UTC),
            )
        )
        db_session.add(
            OrganizationRecord(
                id=ORG_1,
                name="Earlier Org",
                created_by=USER_1,
                created_at=datetime(2026, 1, 1, tzinfo=UTC),
            )
        )
        await db_session.commit()

        found = await repo.get_organization_by_created_by(USER_1)

        assert found is not None
        assert found["id"] == ORG_1

    async def test_identical_created_at_tie_breaks_on_smaller_id(self, repo, db_session):
        """Two owned orgs with the SAME created_at must resolve deterministically.

        Org ids are uuidv7 (chronological), so id-ascending is the honest
        secondary key. The larger-id org is inserted and flushed FIRST so a
        stable-but-wrong ordering (e.g. SQLite returning insertion/rowid order
        on a created_at tie) picks the wrong row and fails this test.
        """
        same_instant = datetime(2026, 3, 1, tzinfo=UTC)
        db_session.add(
            OrganizationRecord(
                id=ORG_OTHER,  # larger uuidv7 — inserted first on purpose
                name="Tied Org Larger Id",
                created_by=USER_1,
                created_at=same_instant,
            )
        )
        await db_session.flush()
        db_session.add(
            OrganizationRecord(
                id=ORG_1,  # smaller uuidv7 — inserted second
                name="Tied Org Smaller Id",
                created_by=USER_1,
                created_at=same_instant,
            )
        )
        await db_session.commit()

        found = await repo.get_organization_by_created_by(USER_1)

        assert found is not None
        assert found["id"] == ORG_1
