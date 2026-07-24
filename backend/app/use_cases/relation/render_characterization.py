"""Render-equivalence characterization harness (ADR-052, Phase 00 — RED scaffold).

Mandate-7 RED scaffold. The walking-skeleton acceptance suite
(``tests/acceptance/normalize-view-report-operations/render-sql-characterization-snapshot.feature``)
drives this module through the driving port; every entry point raises
``AssertionError("Not yet implemented — RED scaffold")`` so the walking skeleton
is RED-by-assertion, not BROKEN by an import error.

DELIVER (Phase 00) implements the harness:

- ``render_all_relations`` re-derives each seeded relation's SQL from its
  persisted component state via the real compilers
  (``ViewIbisCompiler.generate_executable`` /
  ``ReportIbisCompiler.generate_executable`` today; the consolidated kernel
  visitor after Phase 02) and returns a ``{relation_key: duckdb_sql}`` map. The
  map is deterministic — stable ordering, no timestamps — so it pins as a golden
  snapshot.
- ``diff_against_baseline`` returns the set of relation keys whose rendered SQL
  drifted from a pinned baseline, so a deliberate change surfaces a per-relation
  diff rather than passing through.

The reproducibility invariant (AC1) means the rendered SQL is derivable from the
persisted relation rows alone; nothing reads compiled SQL back as authority.
"""
from __future__ import annotations

from typing import Any

__SCAFFOLD__ = True

_NOT_IMPLEMENTED = "Not yet implemented — RED scaffold"


async def render_all_relations(container: Any, relations: list[dict[str, Any]]) -> dict[str, str]:
    """Render every seeded relation to DuckDB SQL, keyed by relation identity.

    DELIVER (Phase 00): for each relation, re-hydrate it from its persisted rows
    through ``container.metadata`` and render via the real compiler, returning a
    deterministic ``{relation_key: sql}`` map suitable for golden-snapshot
    pinning.
    """
    raise AssertionError(_NOT_IMPLEMENTED)


def diff_against_baseline(*, baseline: dict[str, str], current: dict[str, str]) -> set[str]:
    """Return the set of relation keys whose rendered SQL drifted from baseline.

    DELIVER (Phase 00): compare ``current`` against the pinned ``baseline`` and
    return exactly the keys whose SQL changed, so a per-relation diff is
    reportable (the net is not a pass-through).
    """
    raise AssertionError(_NOT_IMPLEMENTED)
