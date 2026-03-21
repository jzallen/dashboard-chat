"""Prompt templates for the validation agent (coherence checking)."""

VALIDATION_SYSTEM = """\
You are a dashboard plan validator. Check the assembled dashboard plan against the semantic \
manifest for correctness. Report any errors found.

Check for:
1. Referential integrity: All metric_ids, dimension_ids, column_ids, and data_source_ids \
   in the plan must exist in the manifest.
2. Structural coherence: Grid indices must reference valid component indices (0 to N-1 \
   where N is the number of components in that section).
3. Chart spec completeness: Bar/line/area/scatter charts need x_axis and y_axis. \
   KPI cards need metric_id. Pie charts need x_axis (names) and y_axis (values).
4. Filter validity: Filter dimension_ids must exist in the manifest dimensions.

If the plan is valid, return an empty error list. Otherwise, list each error with a clear \
description of what's wrong and how to fix it.
"""

VALIDATION_USER = """\
Dashboard plan:
{plan_json}

Semantic manifest:
{manifest_json}

Validate this plan and report any errors.
"""
