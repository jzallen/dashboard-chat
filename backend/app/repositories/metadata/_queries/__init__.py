"""Repository-internal query objects (ADR-025).

Each module under this package defines exactly one ``<ResultShape>Query``
class: a pure SQLAlchemy ``Select`` builder that owns the eager-load
projection, default ordering, conditional filter assembly, and any
has-more probe arithmetic for one non-trivial read. The query class
produces a ``Select``; the repository method owns execution, mapping,
and pagination consumption.

Underscore-prefixed package: repository-internal, not part of the public
repository surface (same precedent as ``_pagination``, ``_mappers``,
``_base``).
"""

from .projects_with_datasets import ProjectsWithDatasetsQuery

__all__ = ["ProjectsWithDatasetsQuery"]
