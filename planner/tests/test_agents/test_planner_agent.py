"""Tests for the planner agent with mock LLM."""

from unittest.mock import AsyncMock, patch

import pytest

from planner.agents.planner_agent import PlannerOutput, SectionOutline, planner_node


@pytest.fixture
def mock_planner_output():
    return PlannerOutput(
        sections=[
            SectionOutline(
                id="kpi_overview",
                title="Key Metrics",
                purpose="Display high-level KPIs",
                metric_ids=["patient_count", "avg_length_of_stay"],
                dimension_ids=[],
                action="add",
            ),
            SectionOutline(
                id="trends",
                title="Trends",
                purpose="Show metrics over time",
                metric_ids=["total_charges"],
                dimension_ids=["admission_month", "department"],
                action="add",
            ),
        ]
    )


class TestPlannerAgent:
    async def test_new_dashboard_produces_section_outlines(
        self, sample_manifest, mock_settings, mock_planner_output
    ):
        mock_llm = AsyncMock(return_value=mock_planner_output)

        with patch("planner.agents.planner_agent.ChatAnthropic") as MockChat:
            instance = MockChat.return_value
            instance.with_structured_output.return_value.ainvoke = mock_llm

            state = {
                "user_prompt": "Build a patient overview dashboard",
                "manifest": sample_manifest,
                "existing_plan": None,
                "validation_errors": [],
            }

            result = await planner_node(state)

        assert "section_plan" in result
        sections = result["section_plan"]["sections"]
        assert len(sections) == 2
        assert sections[0]["id"] == "kpi_overview"
        assert sections[1]["id"] == "trends"

    async def test_edit_workflow_includes_actions(
        self, sample_manifest, sample_dashboard_plan, mock_settings
    ):
        edit_output = PlannerOutput(
            sections=[
                SectionOutline(
                    id="kpi_overview",
                    title="Key Metrics",
                    purpose="Keep existing KPIs",
                    action="keep",
                ),
                SectionOutline(
                    id="new_section",
                    title="Readmission Analysis",
                    purpose="Add readmission trends",
                    metric_ids=["readmission_rate"],
                    dimension_ids=["admission_month"],
                    action="add",
                ),
            ]
        )
        mock_llm = AsyncMock(return_value=edit_output)

        with patch("planner.agents.planner_agent.ChatAnthropic") as MockChat:
            instance = MockChat.return_value
            instance.with_structured_output.return_value.ainvoke = mock_llm

            state = {
                "user_prompt": "Add a readmission trend chart",
                "manifest": sample_manifest,
                "existing_plan": sample_dashboard_plan,
                "validation_errors": [],
            }

            result = await planner_node(state)

        sections = result["section_plan"]["sections"]
        actions = [s["action"] for s in sections]
        assert "keep" in actions
        assert "add" in actions
