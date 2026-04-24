"""Characterization tests for the @handle_repository_exceptions decorator.

Pins the cross-cutting contract: any SQLAlchemyError raised inside a
MetadataRepository method is wrapped and re-raised as
MetadataRepositoryError.
"""

import pytest

from app.repositories.exceptions import MetadataRepositoryError


class TestSQLAlchemyErrorWrapping:
    async def test_foreign_key_violation_wraps_as_metadata_repository_error(self, repo):
        # Creating a project_memory referencing a non-existent project
        # triggers a FK violation (IntegrityError, a SQLAlchemyError
        # subclass). The decorator must translate this into a
        # MetadataRepositoryError so callers catch the repository-layer
        # exception, not the SQLAlchemy-specific one.
        with pytest.raises(MetadataRepositoryError):
            await repo.create_project_memory(
                project_id="nonexistent-project-id",
                org_id="any-org",
                stream_channel_id="any-channel",
            )

    async def test_duplicate_primary_key_wraps_as_metadata_repository_error(self, repo):
        # Creating the same organization ID twice triggers a unique/PK
        # violation on flush. The decorator must translate the
        # IntegrityError into a MetadataRepositoryError.
        await repo.create_organization(name="First", id="dup-org-id")
        with pytest.raises(MetadataRepositoryError):
            await repo.create_organization(name="Second", id="dup-org-id")
