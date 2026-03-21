"""Filter agent — produces FilterSpec entries for sidebar controls."""

from __future__ import annotations

from langchain_anthropic import ChatAnthropic
from pydantic import BaseModel, Field

from planner.agents.prompts.filter import FILTER_SYSTEM, FILTER_USER
from planner.config import get_settings
from planner.schema.manifest import SemanticManifest
from planner.schema.plan import FilterSpec


class FilterOutput(BaseModel):
    filters: list[FilterSpec] = Field(default_factory=list)


def _dimensions_detail(manifest: SemanticManifest) -> str:
    lines = []
    for d in manifest.dimensions:
        extra_parts = []
        if d.time_granularity:
            extra_parts.append(f"granularity={d.time_granularity}")
        if d.cardinality:
            extra_parts.append(f"cardinality={d.cardinality}")
        extra = f" ({', '.join(extra_parts)})" if extra_parts else ""
        lines.append(f"- {d.id}: {d.label} [{d.type}]{extra}")
    return "\n".join(lines)


async def filter_node(state: dict) -> dict:
    """LangGraph node: produce FilterSpec entries."""
    settings = get_settings()
    llm = ChatAnthropic(
        model=settings.model,
        temperature=settings.temperature,
        api_key=settings.anthropic_api_key or None,
    )
    structured_llm = llm.with_structured_output(FilterOutput)

    manifest = SemanticManifest.model_validate(state["manifest"])
    section_plan = state.get("section_plan", {})
    section_topics = ", ".join(
        s.get("title", "") for s in section_plan.get("sections", [])
    )

    user_msg = FILTER_USER.format(
        user_prompt=state["user_prompt"],
        dimensions_detail=_dimensions_detail(manifest),
        section_topics=section_topics,
    )

    result: FilterOutput = await structured_llm.ainvoke(
        [
            {"role": "system", "content": FILTER_SYSTEM},
            {"role": "user", "content": user_msg},
        ]
    )

    return {"filter_results": result.model_dump()}
