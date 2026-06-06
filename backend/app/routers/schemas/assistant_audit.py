"""Pydantic schemas for the assistant-audit create endpoint (rich-catalog §2.7)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class AuditEntryPayload(BaseModel):
    """The variable audit content persisted in the spine's JSON payload."""

    tool: str
    say: str
    tag: str
    args: dict[str, Any] | None = None


class AuditEntryCreate(BaseModel):
    """Request body for POST /api/projects/{id}/audit.

    ``node_id`` is the lineage node (dataset/view/report id) the entry acted on;
    ``node_kind`` disambiguates its namespace. The ``tag`` inside ``payload`` is
    validated against the audit-tag vocabulary in the use case (the inbound
    boundary), so an unknown tag returns a 400 domain failure.
    """

    node_id: str
    node_kind: str
    payload: AuditEntryPayload


class AuditEntryToggle(BaseModel):
    """Request body for PATCH /api/projects/{id}/audit/{audit_entry_id}.

    ``enabled`` is the desired state of the transform the entry produced: ``True``
    enables it, ``False`` disables it (recompiling the dataset's staging SQL on
    read). Only transform-type entries are toggleable.
    """

    enabled: bool
