"""Characterization tests for ProjectMemory operations on MetadataRepository.

Covers `create_project_memory` and `get_project_memory`. Memories map a
project to its Stream channel (1:1 with a project, unique channel_id).
"""

from tests.uuidv7_fixtures import ORG_1, PROJECT_1


class TestCreateProjectMemory:
    async def test_returns_dict_with_generated_id_and_timestamps(self, repo_with_project):
        result = await repo_with_project.create_project_memory(
            project_id=PROJECT_1,
            org_id=ORG_1,
            stream_channel_id="stream-channel-abc",
        )
        assert result["project_id"] == PROJECT_1
        assert result["org_id"] == ORG_1
        assert result["stream_channel_id"] == "stream-channel-abc"
        assert result["id"] is not None
        assert result["created_at"] is not None


class TestGetProjectMemory:
    async def test_returns_none_when_no_memory_for_project(self, repo_with_project):
        assert await repo_with_project.get_project_memory(PROJECT_1) is None

    async def test_round_trip_create_then_read(self, repo_with_project):
        created = await repo_with_project.create_project_memory(
            project_id=PROJECT_1,
            org_id=ORG_1,
            stream_channel_id="ch-roundtrip",
        )
        fetched = await repo_with_project.get_project_memory(PROJECT_1)
        assert fetched is not None
        assert fetched["id"] == created["id"]
        assert fetched["stream_channel_id"] == "ch-roundtrip"
