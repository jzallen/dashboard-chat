"""Converts DashboardPlan + SemanticManifest into a Vizro Dashboard model."""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go
import vizro.models as vm
import vizro.plotly.express as vpx
from vizro.models.types import capture
from vizro.tables import dash_data_table

from planner.schema.manifest import SemanticManifest
from planner.schema.plan import (
    ChartSpec,
    ComponentSpec,
    DashboardPlan,
    FilterSpec,
    TableSpec,
    TextSpec,
)

_WIDGET_TO_SELECTOR = {
    "dropdown": vm.Dropdown,
    "checklist": vm.Checklist,
    "slider": vm.Slider,
    "range_slider": vm.RangeSlider,
    "date_picker": vm.DatePicker,
}


@capture("graph")
def _placeholder_chart(data_frame: pd.DataFrame, **kwargs) -> go.Figure:
    return vpx.bar(data_frame=data_frame, x=data_frame.columns[0], y=data_frame.columns[-1])


@capture("graph")
def _placeholder_kpi(data_frame: pd.DataFrame, **kwargs) -> go.Figure:
    fig = go.Figure(go.Indicator(mode="number", value=0))
    fig.update_layout(margin=dict(l=20, r=20, t=20, b=20), height=150)
    return fig


_PLACEHOLDER_DF = pd.DataFrame({"x": [0], "y": [0]})


def _build_chart_component(comp_id: str, spec: ChartSpec) -> vm.Graph:
    if spec.chart_type == "kpi_card":
        figure = _placeholder_kpi(data_frame=_PLACEHOLDER_DF)
    else:
        figure = _placeholder_chart(data_frame=_PLACEHOLDER_DF)
    return vm.Graph(id=comp_id, figure=figure, title=spec.title)


def _build_table_component(comp_id: str, spec: TableSpec) -> vm.Table:
    placeholder_df = pd.DataFrame({col: [] for col in spec.columns})
    return vm.Table(
        id=comp_id,
        figure=dash_data_table(data_frame=placeholder_df),
        title=spec.title,
    )


def _build_text_component(comp_id: str, spec: TextSpec) -> vm.Card:
    return vm.Card(id=comp_id, text=spec.content)


def _build_component(comp: ComponentSpec) -> vm.Graph | vm.Table | vm.Card:
    if comp.type == "chart" and isinstance(comp.spec, ChartSpec):
        return _build_chart_component(comp.id, comp.spec)
    elif comp.type == "table" and isinstance(comp.spec, TableSpec):
        return _build_table_component(comp.id, comp.spec)
    elif comp.type == "text" and isinstance(comp.spec, TextSpec):
        return _build_text_component(comp.id, comp.spec)
    raise ValueError(f"Unknown component type: {comp.type}")


def _build_filter(filter_spec: FilterSpec, graph_ids: list[str]) -> vm.Filter:
    selector_cls = _WIDGET_TO_SELECTOR.get(filter_spec.widget_type, vm.Dropdown)
    selector = selector_cls(title=filter_spec.label or filter_spec.dimension_id)
    return vm.Filter(
        column=filter_spec.dimension_id,
        targets=graph_ids,
        selector=selector,
    )


def build_vizro_dashboard(
    plan: DashboardPlan, manifest: SemanticManifest
) -> vm.Dashboard:
    """Convert a DashboardPlan into a Vizro Dashboard with one Page."""
    all_components = []
    grid_rows = []
    component_offset = 0

    for section in plan.sections:
        for row in section.grid:
            grid_rows.append([idx + component_offset for idx in row])
        for comp in section.components:
            all_components.append(_build_component(comp))
        component_offset += len(section.components)

    graph_ids = [c.id for c in all_components if isinstance(c, vm.Graph)]
    controls = [_build_filter(f, graph_ids) for f in plan.filters]

    # Vizro requires all grid rows to have the same column count — pad with last index
    if grid_rows:
        max_cols = max(len(row) for row in grid_rows)
        for row in grid_rows:
            while len(row) < max_cols:
                row.append(row[-1])

    layout = vm.Grid(grid=grid_rows) if grid_rows else None

    page = vm.Page(
        id="main_page",
        title=plan.title,
        components=all_components,
        layout=layout,
        controls=controls,
    )

    return vm.Dashboard(id="dashboard", pages=[page], title=plan.title)
