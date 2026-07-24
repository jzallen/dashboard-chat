"""Normalized relation component models shared by views and reports.

Home for the typed component kernel that lifts the dict-soup embedded in
``views``/``reports`` JSON columns onto Pydantic models. The projection kernel
(``ProjectionColumn`` / ``Measure``) is the first component to move: a report's
``columns_metadata`` list hydrates through a discriminated union over
``semantic_role`` rather than being validated by a free function at render time.
"""

from app.models.relation.projection import (
    ProjectionColumn,
    hydrate_projection_columns,
)

__all__ = [
    "ProjectionColumn",
    "hydrate_projection_columns",
]
