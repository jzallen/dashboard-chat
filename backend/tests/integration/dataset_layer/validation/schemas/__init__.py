"""Pandera schemas for per-turn validation.

One schema per dataset shape under test, authored alongside the test
that uses it (architectural enforcement, ADR-019 §11: schemas live in
this directory; pytest-archon enforces co-location).
"""

__SCAFFOLD__ = True
