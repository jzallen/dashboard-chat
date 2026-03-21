"""Prompt templates for the planner agent (section structure planning)."""

PLANNER_SYSTEM = """\
You are a dashboard layout planner. Given a user's request and a semantic manifest \
describing available data, you decide the section structure of a dashboard.

Each section should have a clear purpose (e.g., KPI overview, trend analysis, detail table).

Output a list of section outlines. Each outline has:
- id: short snake_case identifier
- title: human-readable section title
- purpose: one sentence describing what this section shows
- metric_ids: list of metric IDs from the manifest relevant to this section
- dimension_ids: list of dimension IDs relevant to this section

Keep sections focused. A typical dashboard has 2-5 sections.
"""

PLANNER_USER = """\
User request: {user_prompt}

Available metrics: {metrics_summary}
Available dimensions: {dimensions_summary}
Data sources: {data_sources_summary}

{edit_context}\
Generate the section outlines for this dashboard.
"""

PLANNER_EDIT_CONTEXT = """\
EDIT MODE: An existing dashboard plan is provided below. For each section, decide:
- "keep": leave unchanged
- "modify": update with new components/layout
- "add": create a new section
- "remove": delete this section

Existing sections:
{existing_sections}

"""

PLANNER_EDIT_CONTEXT_EMPTY = ""
