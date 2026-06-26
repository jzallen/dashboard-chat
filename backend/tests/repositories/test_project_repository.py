"""Characterization tests for Project operations on MetadataRepository.

Pins the CURRENT observable behavior at the driving-port boundary
(public methods of MetadataRepository). These tests DO NOT document what
the code SHOULD do — they document what it DOES today, so an upcoming
RPP refactor can refactor safely.
"""

from app.repositories.metadata import DatasetRecord, ProjectRecord
from tests.uuidv7_fixtures import (
    DATASET_1,
    ORG_1,
    ORG_OTHER,
    PROJECT_1,
    PROJECT_2,
)
from tests.uuidv7_fixtures import (
    PROJECT_EMPTY as PROJECT_3,  # Third project slot for pagination
)


class TestCreateProject:
    async def test_returns_dict_with_generated_id_and_timestamps(self, repo):
        result = await repo.create_project(
            name="New Project",
            description="Desc",
            org_id=ORG_1,
            created_by="user-1",
        )
        assert result["name"] == "New Project"
        assert result["description"] == "Desc"
        assert result["org_id"] == ORG_1
        assert result["created_by"] == "user-1"
        assert result["id"] is not None
        assert result["created_at"] is not None
        assert result["updated_at"] is not None

    async def test_defaults_optional_fields_to_none(self, repo):
        result = await repo.create_project(name="Minimal")
        assert result["description"] is None
        assert result["org_id"] is None
        assert result["created_by"] is None


class TestGetProject:
    async def test_returns_dict_when_found(self, repo_with_project):
        result = await repo_with_project.get_project(PROJECT_1)
        assert result is not None
        assert result["id"] == PROJECT_1
        assert result["name"] == "Test Project"
        assert result["org_id"] == ORG_1
        # get_project returns metadata only — no embedded datasets
        assert "datasets" not in result

    async def test_returns_none_when_not_found(self, repo):
        assert await repo.get_project("nonexistent-id") is None


class TestUpdateProject:
    async def test_applies_update_data_and_returns_dict(self, repo_with_project):
        result = await repo_with_project.update_project(
            PROJECT_1,
            {"name": "Renamed", "description": "Updated"},
        )
        assert result is not None
        assert result["name"] == "Renamed"
        assert result["description"] == "Updated"

    async def test_persists_changes(self, repo_with_project):
        await repo_with_project.update_project(PROJECT_1, {"name": "Persisted"})
        reread = await repo_with_project.get_project(PROJECT_1)
        assert reread["name"] == "Persisted"

    async def test_returns_none_when_not_found(self, repo):
        assert await repo.update_project("nonexistent-id", {"name": "X"}) is None


class TestDeleteProject:
    async def test_returns_true_and_removes_project(self, repo_with_project):
        assert await repo_with_project.delete_project(PROJECT_1) is True
        assert await repo_with_project.get_project(PROJECT_1) is None

    async def test_cascades_to_datasets(self, repo_with_project, db_session):
        # Seed a dataset under PROJECT_1
        dataset = DatasetRecord(
            id=DATASET_1,
            project_id=PROJECT_1,
            name="Child DS",
            schema_config={"fields": {}},
        )
        db_session.add(dataset)
        await db_session.commit()
        assert await repo_with_project.dataset_exists(DATASET_1) is True

        await repo_with_project.delete_project(PROJECT_1)
        assert await repo_with_project.dataset_exists(DATASET_1) is False

    async def test_returns_false_when_not_found(self, repo):
        assert await repo.delete_project("nonexistent-id") is False


class TestProjectExists:
    async def test_returns_true_when_exists(self, repo_with_project):
        assert await repo_with_project.project_exists(PROJECT_1) is True

    async def test_returns_false_when_missing(self, repo):
        assert await repo.project_exists("nonexistent-id") is False


class TestOrgScopedPointLookups:
    """Point-lookup and mutation methods scope by ``org_id`` when one is passed.

    A cross-tenant ``project_id`` becomes indistinguishable from not-found, so
    the repository enforces tenancy itself rather than trusting the router edge.
    Passing ``org_id=None`` preserves the unscoped behaviour for system callers.
    """

    async def _seed_two_orgs(self, db_session):
        mine = ProjectRecord(id=PROJECT_1, name="Mine", org_id=ORG_1)
        theirs = ProjectRecord(id=PROJECT_2, name="Theirs", org_id=ORG_OTHER)
        db_session.add(mine)
        db_session.add(theirs)
        await db_session.commit()

    async def test_get_project_returns_none_for_cross_tenant_org(self, repo, db_session):
        await self._seed_two_orgs(db_session)
        assert await repo.get_project(PROJECT_2, org_id=ORG_1) is None

    async def test_get_project_returns_dict_for_matching_org(self, repo, db_session):
        await self._seed_two_orgs(db_session)
        result = await repo.get_project(PROJECT_1, org_id=ORG_1)
        assert result is not None
        assert result["id"] == PROJECT_1

    async def test_get_project_unscoped_when_org_id_none(self, repo, db_session):
        await self._seed_two_orgs(db_session)
        assert (await repo.get_project(PROJECT_2)) is not None

    async def test_update_project_returns_none_and_no_mutation_for_cross_tenant_org(self, repo, db_session):
        await self._seed_two_orgs(db_session)
        result = await repo.update_project(PROJECT_2, {"name": "Hijacked"}, org_id=ORG_1)
        assert result is None
        # The other org's row is untouched.
        assert (await repo.get_project(PROJECT_2))["name"] == "Theirs"

    async def test_delete_project_returns_false_and_no_delete_for_cross_tenant_org(self, repo, db_session):
        await self._seed_two_orgs(db_session)
        assert await repo.delete_project(PROJECT_2, org_id=ORG_1) is False
        assert (await repo.get_project(PROJECT_2)) is not None

    async def test_project_exists_false_for_cross_tenant_org(self, repo, db_session):
        await self._seed_two_orgs(db_session)
        assert await repo.project_exists(PROJECT_2, org_id=ORG_1) is False
        assert await repo.project_exists(PROJECT_2, org_id=ORG_OTHER) is True


class TestListProjects:
    async def test_returns_empty_when_no_projects(self, repo):
        items, cursor, has_more = await repo.list_projects()
        assert items == []
        assert cursor is None
        assert has_more is False

    async def test_embeds_datasets_with_link_field(self, repo_with_project, db_session):
        dataset = DatasetRecord(
            id=DATASET_1,
            project_id=PROJECT_1,
            name="DS One",
            description="A dataset",
            schema_config={"fields": {"a": {"type": "text"}}},
        )
        db_session.add(dataset)
        await db_session.commit()

        items, _, _ = await repo_with_project.list_projects()
        assert len(items) == 1
        project_item = items[0]
        assert project_item["id"] == PROJECT_1
        assert len(project_item["datasets"]) == 1
        ds_embedded = project_item["datasets"][0]
        assert ds_embedded["id"] == DATASET_1
        assert ds_embedded["name"] == "DS One"
        assert ds_embedded["description"] == "A dataset"
        assert ds_embedded["link"] == f"/api/datasets/{DATASET_1}"
        assert ds_embedded["schema_config"] == {"fields": {"a": {"type": "text"}}}

    async def test_filters_by_org_id(self, repo, db_session):
        p_mine = ProjectRecord(id=PROJECT_1, name="Mine", org_id=ORG_1)
        p_theirs = ProjectRecord(id=PROJECT_2, name="Theirs", org_id=ORG_OTHER)
        db_session.add(p_mine)
        db_session.add(p_theirs)
        await db_session.commit()

        items, _, _ = await repo.list_projects(org_id=ORG_1)
        ids = {item["id"] for item in items}
        assert ids == {PROJECT_1}

    async def test_cursor_pagination_has_more_and_next_cursor(self, repo, db_session):
        # Seed 3 projects in the same org
        p1 = ProjectRecord(id=PROJECT_1, name="P1", org_id=ORG_1)
        p2 = ProjectRecord(id=PROJECT_2, name="P2", org_id=ORG_1)
        p3 = ProjectRecord(id=PROJECT_3, name="P3", org_id=ORG_1)
        db_session.add(p1)
        db_session.add(p2)
        db_session.add(p3)
        await db_session.commit()

        # Page 1: limit=2, expect 2 items, has_more=True, next_cursor set
        items_p1, cursor_p1, has_more_p1 = await repo.list_projects(org_id=ORG_1, limit=2)
        assert len(items_p1) == 2
        # Order: desc by id (UUIDv7 = chronological). Highest id first = PROJECT_3.
        assert [i["id"] for i in items_p1] == [PROJECT_3, PROJECT_2]
        assert has_more_p1 is True
        assert cursor_p1 is not None

        # Page 2: use cursor, expect remaining 1 item, has_more=False
        items_p2, cursor_p2, has_more_p2 = await repo.list_projects(org_id=ORG_1, cursor=cursor_p1, limit=2)
        assert [i["id"] for i in items_p2] == [PROJECT_1]
        assert has_more_p2 is False
        assert cursor_p2 is None

    async def test_unpaginated_when_limit_none(self, repo, db_session):
        # With limit=None, returns ALL rows and always has_more=False, cursor=None
        p1 = ProjectRecord(id=PROJECT_1, name="P1", org_id=ORG_1)
        p2 = ProjectRecord(id=PROJECT_2, name="P2", org_id=ORG_1)
        db_session.add(p1)
        db_session.add(p2)
        await db_session.commit()

        items, cursor, has_more = await repo.list_projects(org_id=ORG_1, limit=None)
        assert len(items) == 2
        assert cursor is None
        assert has_more is False
