"""Shared preamble + access-record guard for sql_access use cases.

Each of the five sql_access use cases begins with the same prelude:
optionally fetch the project, load the external-access record for the
project (via one of three fetch variants), and optionally enforce a
guard on whether access is currently enabled. This module extracts
that prelude into a single helper so the use cases can delegate.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from app.use_cases.project.project_service import ProjectService
from app.use_cases.sql_access.exceptions import (
    SqlAccessAlreadyEnabled,
    SqlAccessNotEnabled,
)

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


FetchVariant = Literal["plain", "for_update", "with_hash"]


@dataclass(frozen=True)
class SqlAccessContext:
    """Result of the shared sql_access prelude.

    Attributes:
        project: The project dict as returned by ProjectService.fetch_project,
            or the caller-supplied dict if one was passed in.
        access_record: The external-access ORM record (duck-typed; must expose
            ``.enabled``), or ``None`` when no record exists for the project.
    """

    project: dict
    access_record: object | None


async def load_context(
    project_id: str,
    project: dict | None,
    repositories: "RepositoryContainer",
    *,
    fetch_variant: FetchVariant = "plain",
    require_enabled: bool = False,
    forbid_enabled: bool = False,
) -> SqlAccessContext:
    """Run the shared preamble and return a SqlAccessContext.

    If ``project`` is ``None``, it is fetched via ``ProjectService``. The
    external-access record is then loaded using the method selected by
    ``fetch_variant``. Finally, at most one of the two guards may fire:

    * ``forbid_enabled=True`` raises ``SqlAccessAlreadyEnabled`` when the
      access record exists and is enabled.
    * ``require_enabled=True`` raises ``SqlAccessNotEnabled`` when no
      access record exists, or when the record is not enabled.

    When neither guard fires, the context is returned unchanged -- callers
    that support a "disabled" early return (e.g. ``get_sql_access``) can
    inspect ``ctx.access_record`` themselves.
    """
    if project is None:
        project_service = ProjectService(repositories)
        project = await project_service.fetch_project(project_id)

    external_access_repo = repositories.external_access
    if fetch_variant == "for_update":
        access_record = await external_access_repo.get_by_project_id_for_update(project_id)
    elif fetch_variant == "with_hash":
        access_record = await external_access_repo.get_by_project_id_with_hash(project_id)
    else:
        access_record = await external_access_repo.get_by_project_id(project_id)

    if forbid_enabled and access_record is not None and access_record.enabled:
        raise SqlAccessAlreadyEnabled(project_id)

    if require_enabled and (access_record is None or not access_record.enabled):
        raise SqlAccessNotEnabled(project_id)

    return SqlAccessContext(project=project, access_record=access_record)
