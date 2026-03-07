"""Pydantic schemas for report endpoints."""

from pydantic import BaseModel


class ReportCreate(BaseModel):
    """Schema for creating a new report."""

    name: str
    sql_definition: str
    report_type: str
    source_refs: list[dict] = []
    description: str | None = None
    domain: str = "Organization"
    columns_metadata: list[dict] = []
    materialization: str = "view"


class ReportUpdate(BaseModel):
    """Schema for updating a report."""

    name: str | None = None
    sql_definition: str | None = None
    source_refs: list[dict] | None = None
    description: str | None = None
    domain: str | None = None
    columns_metadata: list[dict] | None = None
    materialization: str | None = None
