"""Pydantic schemas for Session."""

from pydantic import BaseModel


class SessionUpdate(BaseModel):
    """Schema for updating a Session.

    J-002 MR-2 (DWD-2): `active_dataset_id` exposed on the wire as part of
    the session-bound dataset-attachment contract. The use case
    `update_session` already allowlists this field at the domain boundary;
    the schema mirror lets clients pass it through PATCH.
    """

    title: str | None = None
    active_dataset_id: str | None = None
