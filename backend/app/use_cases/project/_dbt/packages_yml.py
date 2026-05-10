"""packages.yml generator — emits dbt package dependencies.

Currently the only conditional dependency is ``dbt-labs/dbt_utils``,
required when any staging column emits a ``dbt_utils.expression_is_true``
test (driven by ``range`` constraints). Constraint-free or core-only
projects skip this file entirely so the eject-then-test cycle does not
have to invoke ``dbt deps`` for a no-op install.
"""

from __future__ import annotations

import yaml


def generate_packages_yml() -> str:
    """Render packages.yml referencing dbt-labs/dbt_utils.

    Pinned to ``>=1.1.0,<2.0.0`` to match the dbt 1.8.x runtime used by
    the eject-then-test orchestrator (see ADR-019). Bumping the major
    version requires re-validating macro signatures used by the
    constraint translator (currently only ``expression_is_true``).
    """
    config = {
        "packages": [
            {
                "package": "dbt-labs/dbt_utils",
                "version": [">=1.1.0", "<2.0.0"],
            }
        ]
    }
    return yaml.dump(config, default_flow_style=False, sort_keys=False)
