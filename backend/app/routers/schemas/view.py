"""Pydantic schemas for view endpoints."""

from pydantic import BaseModel


class ViewCreate(BaseModel):
    """Schema for creating a new view."""

    name: str
    sql_definition: str = ""
    source_refs: list[dict] = []
    columns: list[dict] = []
    joins: list[dict] = []
    filters: list[dict] = []
    grain: dict | None = None
    description: str | None = None
    materialization: str = "ephemeral"


class ViewUpdate(BaseModel):
    """Schema for updating a view."""

    name: str | None = None
    sql_definition: str | None = None
    source_refs: list[dict] | None = None
    columns: list[dict] | None = None
    joins: list[dict] | None = None
    filters: list[dict] | None = None
    grain: dict | None = None
    description: str | None = None
    materialization: str | None = None
