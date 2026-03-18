from app.use_cases.project._dbt.naming import deduplicate_names, to_snake_case


class TestToSnakeCase:
    def test_to_snake_case_when_spaces_in_name_converts_to_underscores(self):
        assert to_snake_case("Customer List") == "customer_list"

    def test_to_snake_case_when_special_characters_strips_and_underscores(self):
        assert to_snake_case("Hello@World#2024") == "hello_world_2024"

    def test_to_snake_case_when_only_special_chars_returns_fallback(self):
        assert to_snake_case("---") == "dataset"

    def test_to_snake_case_when_mixed_case_lowercases_all(self):
        assert to_snake_case("MyProject") == "myproject"

    def test_to_snake_case_when_all_numbers_keeps_digits(self):
        assert to_snake_case("12345") == "12345"

    def test_to_snake_case_when_unicode_chars_strips_non_ascii(self):
        result = to_snake_case("Café Data")
        assert result == "caf_data"

    def test_to_snake_case_when_consecutive_special_chars_collapses_to_single_underscore(self):
        assert to_snake_case("a---b___c") == "a_b_c"

    def test_to_snake_case_when_empty_string_returns_fallback(self):
        assert to_snake_case("") == "dataset"


class TestDeduplicateNames:
    def test_deduplicate_names_when_collisions_exist_appends_suffix(self):
        result = deduplicate_names(["Sales Data", "Sales-Data"])
        assert result == ["sales_data", "sales_data_1"]

    def test_deduplicate_names_when_triple_duplicates_appends_incremental_suffix(self):
        result = deduplicate_names(["A", "A", "A"])
        assert result == ["a", "a_1", "a_2"]
