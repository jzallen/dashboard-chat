"""Assembler — pure code that merges section results + filter results into a DashboardPlan."""

from __future__ import annotations

from planner.schema.plan import DashboardPlan, FilterSpec, SectionPlan


def assemble_dashboard(state: dict) -> dict:
    """LangGraph node: merge all section_results and filter_results into a DashboardPlan.

    This is pure code — no LLM calls.
    """
    section_plan = state.get("section_plan", {})
    section_results = state.get("section_results", [])
    filter_results = state.get("filter_results", {})
    existing_plan = state.get("existing_plan")

    # Build section list, preserving "keep" sections from existing plan
    sections = []
    kept_ids = set()

    if existing_plan and section_plan:
        for outline in section_plan.get("sections", []):
            if outline.get("action") == "keep" and existing_plan:
                # Find the original section
                for orig in existing_plan.get("sections", []):
                    if orig["id"] == outline["id"]:
                        sections.append(SectionPlan.model_validate(orig))
                        kept_ids.add(outline["id"])
                        break
            elif outline.get("action") == "remove":
                continue

    # Add generated sections (from section agents)
    for sr in section_results:
        section = SectionPlan.model_validate(sr)
        if section.id not in kept_ids:
            sections.append(section)

    # Build filters
    filters = []
    if filter_results and "filters" in filter_results:
        filters = [FilterSpec.model_validate(f) for f in filter_results["filters"]]

    # Collect data source IDs from manifest
    manifest = state.get("manifest", {})
    data_source_ids = [ds["id"] for ds in manifest.get("data_sources", [])]

    # Build the title from section plan or user prompt
    title = state.get("user_prompt", "Dashboard")[:100]
    if existing_plan:
        title = existing_plan.get("title", title)

    plan = DashboardPlan(
        title=title,
        data_source_ids=data_source_ids,
        filters=filters,
        sections=sections,
    )

    return {"assembled_plan": plan.model_dump()}
