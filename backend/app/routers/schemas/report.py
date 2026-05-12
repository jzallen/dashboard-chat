"""Pydantic schemas for report endpoints."""

from pydantic import BaseModel


class ReportCreate(BaseModel):
    """Schema for creating a new report.

    Per ADR-026 §"Decision outcome" item 2 (MR-3 / Phase 03-03): the legacy
    ``sql_definition`` input is deprecated. The field is preserved here as
    an OPTIONAL parameter so a legacy caller still supplying it surfaces a
    NAMED structured error from :func:`app.use_cases.report.create_report`
    rather than a silent schema-layer drop (DWD-5: rejection at the use-case
    boundary). The agent-tool-schema rip-out lands separately at step 03-05.
    """

    name: str
    report_type: str
    source_refs: list[dict] = []
    description: str | None = None
    domain: str = "Organization"
    columns_metadata: list[dict] = []
    materialization: str = "view"
    sql_definition: str | None = None


class ReportUpdate(BaseModel):
    """Schema for updating a report."""

    name: str | None = None
    sql_definition: str | None = None
    source_refs: list[dict] | None = None
    description: str | None = None
    domain: str | None = None
    columns_metadata: list[dict] | None = None
    materialization: str | None = None
