"""Tests for transform service.

Note: RAQB to SQL conversion tests have been moved to the frontend.
SQL generation is now handled by src/lib/raqb/toSql.ts.
See src/test/raqb/toSql.test.ts for the equivalent test coverage.

Run with: pytest backend/tests/test_pipelines.py
"""

import pytest


class TestVersioning:
    """Tests for pipeline versioning documentation."""

    def test_version_documented(self):
        """Document: Version should increment when condition_json changes.

        This is implemented in the transform update logic.
        The service checks if condition_json changed and increments version.
        """
        pass  # Documentation test

    def test_condition_sql_from_frontend(self):
        """Document: condition_sql is now provided by the frontend.

        SQL generation is handled by the frontend using RAQB.
        The backend stores condition_sql directly without regenerating it.
        See src/lib/raqb/toSql.ts for the implementation.
        """
        pass  # Documentation test
