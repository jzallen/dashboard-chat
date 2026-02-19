from app.use_cases.project.dbt.macros_sql import generate_macros_sql


class TestMacrosSql:
    def test_contains_register_macro_block(self):
        output = generate_macros_sql()
        assert "{% macro register_custom_functions() %}" in output
        assert "{% endmacro %}" in output

    def test_contains_title_case_macro(self):
        output = generate_macros_sql()
        assert "CREATE OR REPLACE MACRO title_case(s)" in output

    def test_contains_snake_case_macro(self):
        output = generate_macros_sql()
        assert "CREATE OR REPLACE MACRO snake_case(s)" in output

    def test_contains_kebab_case_macro(self):
        output = generate_macros_sql()
        assert "CREATE OR REPLACE MACRO kebab_case(s)" in output

    def test_uses_run_query_to_register(self):
        output = generate_macros_sql()
        assert "{% do run_query(title_case_sql) %}" in output
        assert "{% do run_query(snake_case_sql) %}" in output
        assert "{% do run_query(kebab_case_sql) %}" in output
