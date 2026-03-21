"""Tests for the section agent with mock LLM."""

from unittest.mock import AsyncMock, patch

import pytest

from planner.agents.section_agent import section_node
from planner.schema.plan import (
    ChartSpec,
    ComponentSpec,
    SectionPlan,
)


@pytest.fixture
def mock_section_output():
    return SectionPlan(
        id="kpi_overview",
        title="Key Metrics",
        components=[
            ComponentSpec(
                id="kpi_patients",
                type="chart",
                spec=ChartSpec(
                    chart_type="kpi_card",
                    title="Total Patients",
                    metric_id="patient_count",
                ),
            ),
            ComponentSpec(
                id="kpi_los",
                type="chart",
                spec=ChartSpec(
                    chart_type="kpi_card",
                    title="Avg LOS",
                    metric_id="avg_length_of_stay",
                    format=".1f",
                ),
            ),
        ],
        grid=[[0, 1]],
    )


class TestSectionAgent:
    async def test_produces_section_plan(
        self, sample_manifest, mock_settings, mock_section_output
    ):
        mock_llm = AsyncMock(return_value=mock_section_output)

        with patch("planner.agents.section_agent.ChatAnthropic") as MockChat:
            instance = MockChat.return_value
            instance.with_structured_output.return_value.ainvoke = mock_llm

            state = {
                "section_outline": {
                    "id": "kpi_overview",
                    "title": "Key Metrics",
                    "purpose": "Display high-level KPIs",
                    "metric_ids": ["patient_count", "avg_length_of_stay"],
                    "dimension_ids": [],
                },
                "manifest": sample_manifest,
            }

            result = await section_node(state)

        assert "section_results" in result
        section = result["section_results"][0]
        assert section["id"] == "kpi_overview"
        assert len(section["components"]) == 2
        assert section["components"][0]["spec"]["chart_type"] == "kpi_card"

    async def test_section_has_valid_grid(
        self, sample_manifest, mock_settings, mock_section_output
    ):
        mock_llm = AsyncMock(return_value=mock_section_output)

        with patch("planner.agents.section_agent.ChatAnthropic") as MockChat:
            instance = MockChat.return_value
            instance.with_structured_output.return_value.ainvoke = mock_llm

            state = {
                "section_outline": {
                    "id": "kpi_overview",
                    "title": "Key Metrics",
                    "purpose": "Display KPIs",
                    "metric_ids": ["patient_count"],
                    "dimension_ids": [],
                },
                "manifest": sample_manifest,
            }

            result = await section_node(state)

        grid = result["section_results"][0]["grid"]
        assert isinstance(grid, list)
        assert all(isinstance(row, list) for row in grid)
