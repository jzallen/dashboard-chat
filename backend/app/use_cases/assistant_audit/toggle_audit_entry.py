"""Toggle a transform-type assistant-audit entry (rich-catalog §2.5-2.6).

The driving port for the FIRST audit/transform WRITE. Toggling enables/disables
the ``Transform`` that points UP at the entry (via the reversed FK
``transforms.assistant_audit_entry_id``); ``Dataset.staging_sql`` recompiles from
the ENABLED transforms on read, so this use case is a thin PROXY onto the existing
transform-status write path — no recompile logic is reimplemented here.

Org-scoped + project-ownership-checked. An entry with no transform pointing at it
(log-only) is not toggleable. Returns the entry (incl. ``node_id``) so the
controller/UI knows which node's audit to revalidate.
"""

from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.assistant_audit.exceptions import (
    AuditEntryNotFound,
    AuditEntryNotToggleable,
)

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
async def toggle_audit_entry(
    assistant_audit_entry_id: str,
    *,
    enabled: bool,
    org_id: str,
    repositories: "RepositoryContainer",
) -> Result[dict[str, Any], str]:
    """Enable/disable the transform a transform-type audit entry produced.

    Args:
        assistant_audit_entry_id: The audit entry the user is acting on.
        enabled: Desired state — ``True`` → transform ``"enabled"``, ``False`` →
            ``"disabled"``.
        org_id: The requesting org — the tenancy boundary on both the entry
            lookup and the transform resolution.

    Raises:
        AuditEntryNotFound: If the entry does not exist OR is out of org scope.
        AuditEntryNotToggleable: If no Transform points at the entry (log-only).
    """
    metadata_repo = repositories.metadata

    entry = await metadata_repo.get_audit_entry(assistant_audit_entry_id, org_id=org_id)
    if entry is None:
        raise AuditEntryNotFound(assistant_audit_entry_id)

    transform = await metadata_repo.get_transform_by_audit_entry(assistant_audit_entry_id, org_id=org_id)
    if transform is None:
        raise AuditEntryNotToggleable(assistant_audit_entry_id)

    status = "enabled" if enabled else "disabled"
    await metadata_repo.update_transform_status(transform["id"], status)

    return entry
