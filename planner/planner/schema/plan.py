"""Dashboard plan models — intermediate format between LLM agents and Vizro."""

from __future__ import annotations

from typing import Any, Literal, Union

from pydantic import BaseModel, Field, model_validator


class ChartSpec(BaseModel):
    chart_type: Literal["bar", "line", "area", "scatter", "pie", "histogram", "kpi_card"]
    title: str
    x_axis: str | None = None
    y_axis: str | list[str] | None = None
    color_by: str | None = None
    metric_id: str | None = None
    format: str | None = None


class TableSpec(BaseModel):
    title: str
    columns: list[str]
    sortable: bool = True
    page_size: int = 20


class TextSpec(BaseModel):
    content: str
    style: Literal["header", "card", "body"] = "body"


_TYPE_TO_SPEC = {"chart": ChartSpec, "table": TableSpec, "text": TextSpec}


class ComponentSpec(BaseModel):
    id: str
    type: Literal["chart", "table", "text"]
    spec: Union[ChartSpec, TableSpec, TextSpec]

    @model_validator(mode="before")
    @classmethod
    def _resolve_spec(cls, data: Any) -> Any:
        if isinstance(data, dict):
            t = data.get("type")
            s = data.get("spec")
            if isinstance(s, dict) and t in _TYPE_TO_SPEC:
                data = {**data, "spec": _TYPE_TO_SPEC[t](**s)}
        return data


class SectionPlan(BaseModel):
    id: str
    title: str
    description: str | None = None
    components: list[ComponentSpec]
    grid: list[list[int]]


class FilterSpec(BaseModel):
    dimension_id: str
    widget_type: Literal["dropdown", "checklist", "slider", "range_slider", "date_picker"]
    label: str | None = None


class DashboardPlan(BaseModel):
    version: str = "1.0"
    title: str
    description: str | None = None
    data_source_ids: list[str] = Field(default_factory=list)
    filters: list[FilterSpec] = Field(default_factory=list)
    sections: list[SectionPlan] = Field(default_factory=list)
