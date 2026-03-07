"""Tests for FhirPlugin with fhir.resources validation and MultiProcessingResult."""

import json

import pytest

from app.plugins.fhir_plugin import FhirPlugin, MAX_RESOURCE_TYPES
from app.plugins.protocol import MultiProcessingResult, PluginValidationError


PATIENT_BUNDLE = json.dumps(
    {
        "resourceType": "Bundle",
        "type": "searchset",
        "entry": [
            {
                "resource": {
                    "resourceType": "Patient",
                    "id": "1",
                    "active": True,
                    "name": [{"family": "Doe", "given": ["John"]}],
                    "birthDate": "1980-01-01",
                    "gender": "male",
                }
            },
            {
                "resource": {
                    "resourceType": "Patient",
                    "id": "2",
                    "active": False,
                    "name": [{"family": "Smith", "given": ["Jane"]}],
                    "birthDate": "1990-06-15",
                    "gender": "female",
                }
            },
        ],
    }
)

MIXED_BUNDLE = json.dumps(
    {
        "resourceType": "Bundle",
        "type": "searchset",
        "entry": [
            {
                "resource": {
                    "resourceType": "Patient",
                    "id": "1",
                    "name": [{"family": "Doe"}],
                }
            },
            {
                "resource": {
                    "resourceType": "Observation",
                    "id": "2",
                    "status": "final",
                    "code": {"text": "BP"},
                }
            },
        ],
    }
)

NDJSON = (
    '{"resourceType": "Patient", "id": "1", "active": true}\n'
    '{"resourceType": "Patient", "id": "2", "active": false}'
)


class TestFhirPlugin:
    """Tests for FHIR file processing plugin."""

    def setup_method(self):
        self.plugin = FhirPlugin()

    def test_plugin_metadata(self):
        assert self.plugin.name == "fhir"
        assert self.plugin.extensions == [".ndjson", ".fhir.json"]
        assert self.plugin.label == "FHIR"
        assert self.plugin.dbt_macros is None

    def test_validate_accepts_valid_bundle(self):
        self.plugin.validate(PATIENT_BUNDLE.encode(), "patients.fhir.json")

    def test_validate_accepts_valid_ndjson(self):
        self.plugin.validate(NDJSON.encode(), "patients.ndjson")

    def test_validate_raises_on_empty_file(self):
        with pytest.raises(PluginValidationError, match="File is empty"):
            self.plugin.validate(b"", "empty.ndjson")

    def test_validate_raises_on_invalid_json(self):
        with pytest.raises(PluginValidationError, match="no resources"):
            self.plugin.validate(b"not json at all", "bad.ndjson")

    def test_validate_raises_on_json_without_resource_type(self):
        content = json.dumps({"id": "1", "name": "test"}).encode()
        with pytest.raises(PluginValidationError, match="no resources"):
            self.plugin.validate(content, "no_type.fhir.json")

    def test_validate_rejects_unknown_resource_type(self):
        content = json.dumps({"resourceType": "FakeResource", "id": "1"}).encode()
        with pytest.raises(PluginValidationError, match="Unknown FHIR resource type"):
            self.plugin.validate(content, "fake.fhir.json")

    # --- process() returns MultiProcessingResult ---

    def test_single_type_bundle_returns_multi_result(self):
        result = self.plugin.process(PATIENT_BUNDLE.encode(), "patients.fhir.json")

        assert isinstance(result, MultiProcessingResult)
        assert len(result.results) == 1
        assert result.results[0].name == "Patient"
        df = result.results[0].df
        assert len(df) == 2
        assert "id" in df.columns
        assert "gender" in df.columns
        assert "birth_date" in df.columns
        assert df["id"].tolist() == ["1", "2"]

    def test_nested_fields_use_dot_notation(self):
        result = self.plugin.process(PATIENT_BUNDLE.encode(), "patients.fhir.json")
        df = result.results[0].df

        assert "name.0.family" in df.columns
        assert df["name.0.family"].tolist() == ["Doe", "Smith"]
        assert "name.0.given.0" in df.columns
        assert df["name.0.given.0"].tolist() == ["John", "Jane"]

    def test_mixed_bundle_produces_multiple_datasets(self):
        result = self.plugin.process(MIXED_BUNDLE.encode(), "mixed.fhir.json")

        assert isinstance(result, MultiProcessingResult)
        assert len(result.results) == 2
        names = [r.name for r in result.results]
        assert "Observation" in names
        assert "Patient" in names

    def test_detect_choices_returns_none(self):
        assert self.plugin.detect_choices(MIXED_BUNDLE.encode(), "mixed.fhir.json") is None

    def test_ndjson_parses_correctly(self):
        result = self.plugin.process(NDJSON.encode(), "patients.ndjson")

        assert isinstance(result, MultiProcessingResult)
        assert len(result.results) == 1
        df = result.results[0].df
        assert len(df) == 2
        assert df["id"].tolist() == ["1", "2"]
        assert df["active"].tolist() == [True, False]

    def test_schema_hints_for_date_fields(self):
        result = self.plugin.process(PATIENT_BUNDLE.encode(), "patients.fhir.json")
        hints = result.results[0].schema_hints

        assert hints is not None
        assert hints.get("birth_date") == "datetime"

    def test_schema_hints_for_active_field(self):
        result = self.plugin.process(PATIENT_BUNDLE.encode(), "patients.fhir.json")
        hints = result.results[0].schema_hints

        assert hints is not None
        assert hints.get("active") == "boolean"

    def test_chat_guidance_per_resource_type(self):
        result = self.plugin.process(PATIENT_BUNDLE.encode(), "patients.fhir.json")
        guidance = result.results[0].chat_guidance

        assert guidance is not None
        assert "FHIR" in guidance
        assert "Patient" in guidance
        assert "dot notation" in guidance

    def test_overall_chat_guidance(self):
        result = self.plugin.process(MIXED_BUNDLE.encode(), "mixed.fhir.json")

        assert result.chat_guidance is not None
        assert "Observation" in result.chat_guidance
        assert "Patient" in result.chat_guidance

    def test_cross_resource_references_in_guidance(self):
        result = self.plugin.process(MIXED_BUNDLE.encode(), "mixed.fhir.json")
        obs_result = next(r for r in result.results if r.name == "Observation")

        assert "Patient" in obs_result.chat_guidance

    def test_single_resource_json(self):
        resource = json.dumps(
            {"resourceType": "Patient", "id": "solo", "active": True}
        ).encode()
        result = self.plugin.process(resource, "patient.fhir.json")

        assert isinstance(result, MultiProcessingResult)
        assert len(result.results) == 1
        assert result.results[0].df["id"].iloc[0] == "solo"

    def test_validate_rejects_oversized_file(self):
        """Files exceeding 100 MB should be rejected."""
        large_content = b"x" * (FhirPlugin.MAX_FILE_SIZE + 1)
        with pytest.raises(PluginValidationError, match="File too large"):
            self.plugin.validate(large_content, "huge.ndjson")

    def test_resource_type_cap_exceeded(self):
        """Bundle with >20 resource types should be rejected."""
        from unittest.mock import patch

        # Create 21 fake validated resource dicts — bypass fhir.resources validation
        # to test the cap logic itself
        fake_validated = []
        for i in range(MAX_RESOURCE_TYPES + 1):
            fake_validated.append({"resourceType": f"Type{i}", "id": f"id-{i}"})

        entries = [{"resource": r} for r in fake_validated]
        bundle = json.dumps({"resourceType": "Bundle", "type": "searchset", "entry": entries}).encode()

        with patch("app.plugins.fhir_plugin._validate_resources", return_value=fake_validated):
            with pytest.raises(PluginValidationError, match="exceeding the maximum"):
                self.plugin.process(bundle, "huge.fhir.json")
