"""Generate dbt macros file with custom DuckDB functions.

Reuses the macro definitions from app.utils.sql_functions so the dbt project
uses the same title_case, snake_case, and kebab_case functions as the live
SQL Preview.
"""

from app.utils.sql_functions import KEBAB_CASE_MACRO, SNAKE_CASE_MACRO, TITLE_CASE_MACRO


def generate_macros_sql() -> str:
    """Generate macros/custom_functions.sql for the dbt project.

    Wraps each DuckDB macro in a dbt on-run-start-compatible format using
    {% macro %} blocks that call run_query() to register the macros.
    """
    return f"""{{% macro register_custom_functions() %}}

  {{% set title_case_sql %}}
{TITLE_CASE_MACRO.strip()}
  {{% endset %}}

  {{% set snake_case_sql %}}
{SNAKE_CASE_MACRO.strip()}
  {{% endset %}}

  {{% set kebab_case_sql %}}
{KEBAB_CASE_MACRO.strip()}
  {{% endset %}}

  {{% do run_query(title_case_sql) %}}
  {{% do run_query(snake_case_sql) %}}
  {{% do run_query(kebab_case_sql) %}}

{{% endmacro %}}
"""
