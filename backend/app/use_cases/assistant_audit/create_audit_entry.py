"""Create an assistant-audit entry (rich-catalog §2.7 Option A).

The driving port the agent POSTs to after executing a transform tool. It
verifies the requesting org owns the project, validates the audit ``tag`` against
the recognized vocabulary at the boundary, and inserts an
``assistant_audit_entries`` row (the generic spine) from
``{node_id, node_kind, payload:{tool, say, tag}}``.

The created entry (including its server-generated ``id``) is returned so the
caller can establish the reversed FK: a follow-up transform-create call passes
``assistant_audit_entry_id`` and the ``Transform`` is written pointing UP at this
entry.
"""

from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.assistant_audit.exceptions import InvalidAuditTag
from app.use_cases.project.exceptions import ProjectNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

# The audit-tag vocabulary (mirrors ui/src/lib/catalog/lineage.ts AUDIT_TAGS).
# The agent resolves the tag from the tool name; the backend validates it here
# at the inbound boundary (domain-modeling: validate untrusted input at the edge).
AUDIT_TAGS = frozenset(
    {
        "create",
        "source",
        "join",
        "filter",
        "grain",
        "measure",
        "config",
        "clean",
        "fix",
        "cast",
        "shape",
    }
)


@handle_returns
@with_repositories
async def create_audit_entry(
    project_id: str,
    *,
    node_id: str,
    node_kind: str,
    payload: dict[str, Any],
    org_id: str,
    repositories: "RepositoryContainer",
) -> Result[dict[str, Any], str]:
    """Insert an assistant-audit entry for a project (org-scoped).

    Args:
        project_id: The parent project UUID.
        node_id: The lineage node (dataset/view/report id) the entry acted on.
        node_kind: ``dataset`` | ``view`` | ``report`` — disambiguates ``node_id``.
        payload: The variable audit content ``{tool, say, tag, args?}``.
        org_id: The requesting org — ownership boundary + row-level scope.

    Raises:
        ProjectNotFound: If the project does not exist OR is owned by another org.
        InvalidAuditTag: If ``payload['tag']`` is outside AUDIT_TAGS.
    """
    metadata_repo = repositories.metadata
    project = await metadata_repo.get_project(project_id)
    if project is None or (project.get("org_id") and project["org_id"] != org_id):
        raise ProjectNotFound(project_id)

    tag = payload.get("tag")
    if tag not in AUDIT_TAGS:
        raise InvalidAuditTag(tag)

    return await metadata_repo.create_audit_entry(
        org_id=org_id,
        project_id=project_id,
        node_id=node_id,
        node_kind=node_kind,
        payload=payload,
    )
