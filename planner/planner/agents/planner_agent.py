"""Planner agent — decides section structure for a dashboard."""

from __future__ import annotations

from typing import Literal

from langchain_anthropic import ChatAnthropic
from pydantic import BaseModel, Field

from planner.agents.prompts.planner import (
    PLANNER_EDIT_CONTEXT,
    PLANNER_EDIT_CONTEXT_EMPTY,
    PLANNER_SYSTEM,
    PLANNER_USER,
)
from planner.config import get_settings
from planner.schema.manifest import SemanticManifest


class SectionOutline(BaseModel):
    id: str
    title: str
    purpose: str
    metric_ids: list[str] = Field(default_factory=list)
    dimension_ids: list[str] = Field(default_factory=list)
    action: Literal["keep", "modify", "add", "remove"] = "add"


class PlannerOutput(BaseModel):
    sections: list[SectionOutline]


def _summarize_manifest(manifest: SemanticManifest) -> dict[str, str]:
    metrics = ", ".join(f"{m.id} ({m.label})" for m in manifest.metrics)
    dimensions = ", ".join(f"{d.id} ({d.label}, {d.type})" for d in manifest.dimensions)
    sources = ", ".join(f"{ds.id} ({ds.label})" for ds in manifest.data_sources)
    return {
        "metrics_summary": metrics,
        "dimensions_summary": dimensions,
        "data_sources_summary": sources,
    }


def _format_existing_sections(existing_plan: dict | None) -> str:
    if not existing_plan:
        return PLANNER_EDIT_CONTEXT_EMPTY
    sections = existing_plan.get("sections", [])
    lines = []
    for s in sections:
        lines.append(f"- {s['id']}: {s['title']} ({len(s.get('components', []))} components)")
    return PLANNER_EDIT_CONTEXT.format(existing_sections="\n".join(lines))


async def planner_node(state: dict) -> dict:
    """LangGraph node: produce section outlines from user prompt + manifest."""
    settings = get_settings()
    llm = ChatAnthropic(
        model=settings.model,
        temperature=settings.temperature,
        api_key=settings.anthropic_api_key or None,
    )
    structured_llm = llm.with_structured_output(PlannerOutput)

    manifest = SemanticManifest.model_validate(state["manifest"])
    summaries = _summarize_manifest(manifest)

    edit_context = _format_existing_sections(state.get("existing_plan"))

    user_msg = PLANNER_USER.format(
        user_prompt=state["user_prompt"],
        edit_context=edit_context,
        **summaries,
    )

    # Include validation errors from previous iteration if any
    validation_errors = state.get("validation_errors", [])
    if validation_errors:
        user_msg += "\n\nPrevious validation errors to fix:\n"
        for err in validation_errors:
            user_msg += f"- {err}\n"

    result: PlannerOutput = await structured_llm.ainvoke(
        [
            {"role": "system", "content": PLANNER_SYSTEM},
            {"role": "user", "content": user_msg},
        ]
    )

    return {"section_plan": result.model_dump()}
