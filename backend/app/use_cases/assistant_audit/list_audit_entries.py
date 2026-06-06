"""List a project's assistant-audit entries (rich-catalog §2.11).

The driving port for the audit read that backs the UI's ``getAudit``. It
verifies the requesting org owns the project, then returns the project's
``assistant_audit_entries`` LEFT-JOINed to ``transforms`` on the reversed FK,
projecting each row to the flat audit shape the UI groups by ``node_id``:

    { node_id, node_kind, tool, say, tag, transform_id, enabled }

``tool``/``say``/``tag`` are read from the entry's JSON ``payload``;
``transform_id``/``enabled`` come from the join (present iff a Transform points
UP at the entry → toggleable; ``None`` for log-only entries). Read-only.
"""

from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.exceptions import ProjectNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
async def list_audit_entries_for_project(
    project_id: str,
    *,
    org_id: str,
    repositories: "RepositoryContainer",
) -> Result[list[dict[str, Any]], str]:
    """Return the project's assistant-audit rows (org-scoped).

    Args:
        project_id: The parent project UUID.
        org_id: The requesting org — both the ownership boundary and the
            row-level scope on ``assistant_audit_entries.org_id``.

    Raises:
        ProjectNotFound: If the project does not exist OR is owned by another org
            (cross-org access is indistinguishable from not-found by design).
    """
    metadata_repo = repositories.metadata
    project = await metadata_repo.get_project(project_id)
    if project is None or (project.get("org_id") and project["org_id"] != org_id):
        raise ProjectNotFound(project_id)

    rows = await metadata_repo.list_audit_entries_for_project(project_id, org_id=org_id)
    return [_to_audit_row(row) for row in rows]


def _to_audit_row(row: dict[str, Any]) -> dict[str, Any]:
    """Flatten a join row's JSON payload into the audit projection shape."""
    payload = row["payload"] or {}
    return {
        "id": row["id"],
        "node_id": row["node_id"],
        "node_kind": row["node_kind"],
        "tool": payload.get("tool"),
        "say": payload.get("say"),
        "tag": payload.get("tag"),
        "transform_id": row["transform_id"],
        "enabled": row["enabled"],
    }
