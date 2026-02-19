from app.use_cases.project.dbt.naming import to_snake_case, deduplicate_names


class TestToSnakeCase:
    def test_simple_conversion(self):
        assert to_snake_case("Customer List") == "customer_list"

    def test_special_characters(self):
        assert to_snake_case("Hello@World#2024") == "hello_world_2024"

    def test_empty_after_conversion(self):
        assert to_snake_case("---") == "dataset"

    def test_mixed_case(self):
        assert to_snake_case("MyProject") == "myproject"


class TestToSnakeCaseEdgeCases:
    def test_all_numbers(self):
        assert to_snake_case("12345") == "12345"

    def test_unicode_characters(self):
        # Non-ASCII characters are stripped by the regex, keeping only [a-z0-9]
        result = to_snake_case("Café Data")
        assert result == "caf_data"

    def test_consecutive_special_chars(self):
        assert to_snake_case("a---b___c") == "a_b_c"

    def test_empty_string(self):
        assert to_snake_case("") == "dataset"


class TestDeduplicateNames:
    def test_duplicate_detection(self):
        result = deduplicate_names(["Sales Data", "Sales-Data"])
        assert result == ["sales_data", "sales_data_1"]

    def test_triple_duplicates(self):
        result = deduplicate_names(["A", "A", "A"])
        assert result == ["a", "a_1", "a_2"]
