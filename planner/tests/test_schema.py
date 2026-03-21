"""Tests for schema models: manifest and plan."""

import pytest
from pydantic import ValidationError

from planner.schema.manifest import (
    Column,
    DataSource,
    Dimension,
    Metric,
    Relationship,
    SemanticManifest,
)
from planner.schema.plan import (
    ChartSpec,
    ComponentSpec,
    DashboardPlan,
    FilterSpec,
    SectionPlan,
    TableSpec,
    TextSpec,
)


# --- Manifest tests ---


class TestManifestModels:
    def test_column_types(self):
        for col_type in ("string", "number", "date", "boolean"):
            col = Column(id="c", label="C", type=col_type)
            assert col.type == col_type

    def test_column_invalid_type(self):
        with pytest.raises(ValidationError):
            Column(id="c", label="C", type="invalid")

    def test_metric_default_type(self):
        m = Metric(id="m", label="M", expression="SUM(x)")
        assert m.type == "simple"

    def test_dimension_time_with_granularity(self):
        d = Dimension(
            id="d", label="D", column_id="col", type="time", time_granularity="month"
        )
        assert d.time_granularity == "month"

    def test_relationship_default_type(self):
        r = Relationship(from_source="a", to_source="b", join_key="id")
        assert r.type == "many_to_one"

    def test_manifest_missing_data_sources(self):
        with pytest.raises(ValidationError):
            SemanticManifest(metrics=[], dimensions=[])

    def test_manifest_round_trip(self, sample_manifest):
        manifest = SemanticManifest.model_validate(sample_manifest)
        dumped = manifest.model_dump()
        restored = SemanticManifest.model_validate(dumped)
        assert manifest == restored

    def test_manifest_fixture_structure(self, sample_manifest):
        manifest = SemanticManifest.model_validate(sample_manifest)
        assert len(manifest.data_sources) == 2
        assert len(manifest.metrics) == 4
        assert len(manifest.dimensions) == 4
        assert len(manifest.relationships) == 1


# --- Plan tests ---


class TestPlanModels:
    def test_chart_spec_bar(self):
        spec = ChartSpec(chart_type="bar", title="Test", x_axis="dim", y_axis="metric")
        assert spec.chart_type == "bar"

    def test_chart_spec_kpi_card(self):
        spec = ChartSpec(chart_type="kpi_card", title="KPI", metric_id="m1")
        assert spec.metric_id == "m1"

    def test_chart_spec_invalid_type(self):
        with pytest.raises(ValidationError):
            ChartSpec(chart_type="invalid", title="Test")

    def test_table_spec_defaults(self):
        spec = TableSpec(title="T", columns=["a", "b"])
        assert spec.sortable is True
        assert spec.page_size == 20

    def test_text_spec_default_style(self):
        spec = TextSpec(content="hello")
        assert spec.style == "body"

    def test_component_spec_chart(self):
        chart = ChartSpec(chart_type="bar", title="Test", x_axis="x", y_axis="y")
        comp = ComponentSpec(id="c1", type="chart", spec=chart)
        assert comp.type == "chart"

    def test_section_plan_with_grid(self):
        comps = [
            ComponentSpec(
                id=f"c{i}",
                type="chart",
                spec=ChartSpec(chart_type="bar", title=f"C{i}", x_axis="x", y_axis="y"),
            )
            for i in range(4)
        ]
        section = SectionPlan(id="s1", title="S", components=comps, grid=[[0, 1], [2, 3]])
        assert len(section.grid) == 2
        assert section.grid[0] == [0, 1]

    def test_filter_spec(self):
        f = FilterSpec(dimension_id="dept", widget_type="dropdown", label="Department")
        assert f.widget_type == "dropdown"

    def test_dashboard_plan_defaults(self):
        plan = DashboardPlan(title="Test Dashboard")
        assert plan.version == "1.0"
        assert plan.filters == []
        assert plan.sections == []

    def test_dashboard_plan_round_trip(self, sample_dashboard_plan):
        plan = DashboardPlan.model_validate(sample_dashboard_plan)
        dumped = plan.model_dump()
        restored = DashboardPlan.model_validate(dumped)
        assert plan == restored

    def test_dashboard_plan_fixture_structure(self, sample_dashboard_plan):
        plan = DashboardPlan.model_validate(sample_dashboard_plan)
        assert plan.title == "Patient Demographics Dashboard"
        assert len(plan.sections) == 3
        assert len(plan.filters) == 3

    def test_component_spec_table_from_dict(self):
        data = {
            "id": "t1",
            "type": "table",
            "spec": {"title": "My Table", "columns": ["a", "b"]},
        }
        comp = ComponentSpec.model_validate(data)
        assert isinstance(comp.spec, TableSpec)
        assert comp.spec.title == "My Table"
        # Round-trip
        restored = ComponentSpec.model_validate(comp.model_dump())
        assert restored == comp

    def test_component_spec_text_from_dict(self):
        data = {
            "id": "txt1",
            "type": "text",
            "spec": {"content": "Hello world", "style": "header"},
        }
        comp = ComponentSpec.model_validate(data)
        assert isinstance(comp.spec, TextSpec)
        assert comp.spec.content == "Hello world"
        # Round-trip
        restored = ComponentSpec.model_validate(comp.model_dump())
        assert restored == comp

    def test_component_spec_type_mismatch(self):
        data = {
            "id": "bad",
            "type": "text",
            "spec": {"chart_type": "bar", "title": "Oops", "x_axis": "x", "y_axis": "y"},
        }
        with pytest.raises(ValidationError):
            ComponentSpec.model_validate(data)
