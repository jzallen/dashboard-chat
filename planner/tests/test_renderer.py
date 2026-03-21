"""Tests for the Vizro builder and chart functions."""

from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import plotly.graph_objects as go
import pytest
import vizro.models as vm
from vizro import Vizro

from planner.data.types import SemanticQuery, SemanticQueryResult
from planner.renderer.charts import CHART_REGISTRY, build_bar, build_kpi_card, build_pie
from planner.renderer.data_manager import register_data_sources
from planner.schema.manifest import Column, DataSource, Dimension, Metric, SemanticManifest
from planner.schema.plan import DashboardPlan
from planner.schema.vizro_builder import build_vizro_dashboard


@pytest.fixture(autouse=True)
def _reset_vizro():
    """Reset Vizro's global model manager between tests."""
    Vizro._reset()
    yield
    Vizro._reset()


class TestChartFunctions:
    def test_bar_chart(self):
        df = pd.DataFrame({"x": ["A", "B", "C"], "y": [1, 2, 3]})
        fig = build_bar(df, x="x", y="y")
        assert isinstance(fig, go.Figure)
        assert len(fig.data) > 0

    def test_kpi_card(self):
        df = pd.DataFrame({"metric": [42.5]})
        fig = build_kpi_card(df, metric_id="metric")
        assert isinstance(fig, go.Figure)

    def test_pie_chart(self):
        df = pd.DataFrame({"names": ["A", "B"], "values": [30, 70]})
        fig = build_pie(df, names="names", values="values")
        assert isinstance(fig, go.Figure)

    def test_chart_registry_has_all_types(self):
        expected = {"bar", "line", "area", "scatter", "pie", "histogram", "kpi_card"}
        assert set(CHART_REGISTRY.keys()) == expected

    def test_all_registry_functions_return_figures(self):
        df = pd.DataFrame({"x": ["A", "B"], "y": [1, 2], "metric": [100, 200]})
        for chart_type, fn in CHART_REGISTRY.items():
            if chart_type == "kpi_card":
                fig = fn(df, metric_id="metric")
            elif chart_type == "pie":
                fig = fn(df, names="x", values="y")
            elif chart_type == "histogram":
                fig = fn(df, x="y")
            else:
                fig = fn(df, x="x", y="y")
            assert isinstance(fig, go.Figure), f"{chart_type} did not return a Figure"


class TestDataManager:
    def test_metric_dimension_classification(self):
        """Verify that columns matching manifest metrics go to metrics, rest to group_by."""
        manifest = SemanticManifest(
            data_sources=[
                DataSource(
                    id="sales",
                    label="Sales",
                    columns=[
                        Column(id="revenue", label="Revenue", type="number"),
                        Column(id="region", label="Region", type="string"),
                        Column(id="order_count", label="Orders", type="number"),
                    ],
                )
            ],
            metrics=[
                Metric(id="revenue", label="Revenue", expression="SUM(revenue)"),
                Metric(id="order_count", label="Orders", expression="COUNT(*)"),
            ],
            dimensions=[
                Dimension(id="region", label="Region", column_id="region", type="categorical"),
            ],
        )

        captured_queries: list[SemanticQuery] = []

        mock_warehouse = MagicMock()

        async def mock_query(query: SemanticQuery) -> SemanticQueryResult:
            captured_queries.append(query)
            return SemanticQueryResult(columns=[], rows=[])

        mock_warehouse.query = mock_query

        # Capture the loader function before Vizro wraps it
        registered_loaders = {}
        with patch("planner.renderer.data_manager.data_manager", registered_loaders):
            register_data_sources(mock_warehouse, manifest)

        # Call the raw loader function directly
        loader = registered_loaders["sales"]
        loader()

        assert len(captured_queries) == 1
        q = captured_queries[0]
        assert set(q.metrics) == {"revenue", "order_count"}
        assert q.group_by == ["region"]


class TestVizroBuilder:
    def test_build_dashboard_returns_vizro_model(self, sample_manifest, sample_dashboard_plan):
        manifest = SemanticManifest.model_validate(sample_manifest)
        plan = DashboardPlan.model_validate(sample_dashboard_plan)
        dashboard = build_vizro_dashboard(plan, manifest)
        assert isinstance(dashboard, vm.Dashboard)

    def test_dashboard_has_one_page(self, sample_manifest, sample_dashboard_plan):
        manifest = SemanticManifest.model_validate(sample_manifest)
        plan = DashboardPlan.model_validate(sample_dashboard_plan)
        dashboard = build_vizro_dashboard(plan, manifest)
        assert len(dashboard.pages) == 1

    def test_page_has_correct_title(self, sample_manifest, sample_dashboard_plan):
        manifest = SemanticManifest.model_validate(sample_manifest)
        plan = DashboardPlan.model_validate(sample_dashboard_plan)
        dashboard = build_vizro_dashboard(plan, manifest)
        assert dashboard.pages[0].title == plan.title

    def test_page_has_components(self, sample_manifest, sample_dashboard_plan):
        manifest = SemanticManifest.model_validate(sample_manifest)
        plan = DashboardPlan.model_validate(sample_dashboard_plan)
        dashboard = build_vizro_dashboard(plan, manifest)
        page = dashboard.pages[0]
        # Total components from all sections: 3 (KPI) + 3 (trends) + 2 (detail) = 8
        assert len(page.components) == 8

    def test_page_has_controls(self, sample_manifest, sample_dashboard_plan):
        manifest = SemanticManifest.model_validate(sample_manifest)
        plan = DashboardPlan.model_validate(sample_dashboard_plan)
        dashboard = build_vizro_dashboard(plan, manifest)
        page = dashboard.pages[0]
        assert len(page.controls) == 3

    def test_page_has_grid_layout(self, sample_manifest, sample_dashboard_plan):
        manifest = SemanticManifest.model_validate(sample_manifest)
        plan = DashboardPlan.model_validate(sample_dashboard_plan)
        dashboard = build_vizro_dashboard(plan, manifest)
        page = dashboard.pages[0]
        assert page.layout is not None
        assert isinstance(page.layout, vm.Grid)
