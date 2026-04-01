"""Pydantic schemas for Session."""

from pydantic import BaseModel


class SessionUpdate(BaseModel):
    """Schema for updating a Session."""

    title: str | None = None
