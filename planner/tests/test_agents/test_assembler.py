"""Tests for the assembler — pure code, no mocks needed."""

from planner.agents.assembler import assemble_dashboard
from planner.schema.plan import DashboardPlan


class TestAssembler:
    def test_merges_sections_and_filters(self, sample_manifest):
        state = {
            "user_prompt": "Patient dashboard",
            "manifest": sample_manifest,
            "existing_plan": None,
            "section_plan": {
                "sections": [
                    {"id": "s1", "title": "Section 1", "action": "add"},
                    {"id": "s2", "title": "Section 2", "action": "add"},
                ]
            },
            "section_results": [
                {
                    "id": "s1",
                    "title": "Key Metrics",
                    "components": [
                        {
                            "id": "c1",
                            "type": "chart",
                            "spec": {
                                "chart_type": "kpi_card",
                                "title": "Total Patients",
                                "metric_id": "patient_count",
                            },
                        }
                    ],
                    "grid": [[0]],
                },
                {
                    "id": "s2",
                    "title": "Trends",
                    "components": [
                        {
                            "id": "c2",
                            "type": "chart",
                            "spec": {
                                "chart_type": "line",
                                "title": "LOS Over Time",
                                "x_axis": "admission_month",
                                "y_axis": "avg_length_of_stay",
                            },
                        }
                    ],
                    "grid": [[0]],
                },
            ],
            "filter_results": {
                "filters": [
                    {
                        "dimension_id": "department",
                        "widget_type": "dropdown",
                        "label": "Department",
                    }
                ]
            },
        }

        result = assemble_dashboard(state)
        plan = DashboardPlan.model_validate(result["assembled_plan"])

        assert len(plan.sections) == 2
        assert len(plan.filters) == 1
        assert plan.data_source_ids == ["patients", "encounters"]

    def test_edit_preserves_kept_sections(self, sample_manifest, sample_dashboard_plan):
        state = {
            "user_prompt": "Add a readmission chart",
            "manifest": sample_manifest,
            "existing_plan": sample_dashboard_plan,
            "section_plan": {
                "sections": [
                    {"id": "kpi_overview", "title": "Key Metrics", "action": "keep"},
                    {"id": "trends", "title": "Trends", "action": "remove"},
                    {"id": "new_section", "title": "Readmissions", "action": "add"},
                ]
            },
            "section_results": [
                {
                    "id": "new_section",
                    "title": "Readmission Analysis",
                    "components": [
                        {
                            "id": "readmit_chart",
                            "type": "chart",
                            "spec": {
                                "chart_type": "line",
                                "title": "Readmission Rate",
                                "x_axis": "admission_month",
                                "y_axis": "readmission_rate",
                            },
                        }
                    ],
                    "grid": [[0]],
                },
            ],
            "filter_results": {
                "filters": [
                    {
                        "dimension_id": "department",
                        "widget_type": "dropdown",
                    }
                ]
            },
        }

        result = assemble_dashboard(state)
        plan = DashboardPlan.model_validate(result["assembled_plan"])

        section_ids = [s.id for s in plan.sections]
        assert "kpi_overview" in section_ids  # kept
        assert "trends" not in section_ids  # removed
        assert "new_section" in section_ids  # added

        # Verify the kept section preserves original components
        kept = next(s for s in plan.sections if s.id == "kpi_overview")
        assert len(kept.components) == 3  # original 3 KPI cards
