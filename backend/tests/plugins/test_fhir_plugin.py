"""Tests for FhirPlugin."""

import json

import pytest

from app.plugins.fhir_plugin import FhirPlugin
from app.plugins.protocol import PluginChoice, PluginValidationError, ProcessingResult


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
        """FhirPlugin should expose correct name, extensions, and label."""
        assert self.plugin.name == "fhir"
        assert self.plugin.extensions == [".ndjson", ".fhir.json"]
        assert self.plugin.label == "FHIR"
        assert self.plugin.dbt_macros is None

    def test_validate_accepts_valid_bundle(self):
        """validate should not raise for a valid FHIR Bundle."""
        self.plugin.validate(PATIENT_BUNDLE.encode(), "patients.fhir.json")

    def test_validate_accepts_valid_ndjson(self):
        """validate should not raise for valid FHIR NDJSON."""
        self.plugin.validate(NDJSON.encode(), "patients.ndjson")

    def test_validate_raises_on_empty_file(self):
        """validate should raise PluginValidationError for empty content."""
        with pytest.raises(PluginValidationError, match="File is empty"):
            self.plugin.validate(b"", "empty.ndjson")

    def test_validate_raises_on_invalid_json(self):
        """validate should raise PluginValidationError for invalid JSON."""
        with pytest.raises(PluginValidationError, match="no resources"):
            self.plugin.validate(b"not json at all", "bad.ndjson")

    def test_validate_raises_on_json_without_resource_type(self):
        """validate should raise PluginValidationError when resourceType is missing."""
        content = json.dumps({"id": "1", "name": "test"}).encode()
        with pytest.raises(PluginValidationError, match="no resources"):
            self.plugin.validate(content, "no_type.fhir.json")

    def test_single_type_bundle_returns_dataframe(self):
        """process should return a DataFrame with correct columns for a single-type bundle."""
        result = self.plugin.process(PATIENT_BUNDLE.encode(), "patients.fhir.json")

        assert isinstance(result, ProcessingResult)
        assert len(result.df) == 2
        assert "id" in result.df.columns
        assert "gender" in result.df.columns
        assert "birth_date" in result.df.columns
        assert result.df["id"].tolist() == ["1", "2"]
        assert result.df["gender"].tolist() == ["male", "female"]

    def test_nested_fields_are_flattened(self):
        """process should flatten nested fields with underscore notation."""
        result = self.plugin.process(PATIENT_BUNDLE.encode(), "patients.fhir.json")

        # name[0].family -> name_0_family
        assert "name_0_family" in result.df.columns
        assert result.df["name_0_family"].tolist() == ["Doe", "Smith"]
        # name[0].given[0] -> name_0_given_0
        assert "name_0_given_0" in result.df.columns
        assert result.df["name_0_given_0"].tolist() == ["John", "Jane"]

    def test_mixed_bundle_detect_choices_returns_types(self):
        """detect_choices should return resource types when multiple types exist."""
        choices = self.plugin.detect_choices(MIXED_BUNDLE.encode(), "mixed.fhir.json")

        assert choices is not None
        assert len(choices) == 1
        assert isinstance(choices[0], PluginChoice)
        assert choices[0].key == "resource_type"
        assert choices[0].options == ["Observation", "Patient"]

    def test_single_type_bundle_detect_choices_returns_none(self):
        """detect_choices should return None when only one resource type exists."""
        choices = self.plugin.detect_choices(PATIENT_BUNDLE.encode(), "patients.fhir.json")
        assert choices is None

    def test_mixed_bundle_process_with_resource_type_choice(self):
        """process should filter to selected resource type."""
        result = self.plugin.process(
            MIXED_BUNDLE.encode(),
            "mixed.fhir.json",
            choices={"resource_type": "Patient"},
        )

        assert len(result.df) == 1
        assert result.df["resource_type"].iloc[0] == "Patient"

    def test_ndjson_parses_correctly(self):
        """process should parse NDJSON format correctly."""
        result = self.plugin.process(NDJSON.encode(), "patients.ndjson")

        assert len(result.df) == 2
        assert result.df["id"].tolist() == ["1", "2"]
        assert result.df["active"].tolist() == [True, False]

    def test_schema_hints_for_date_fields(self):
        """schema_hints should mark date fields as datetime."""
        result = self.plugin.process(PATIENT_BUNDLE.encode(), "patients.fhir.json")

        assert result.schema_hints is not None
        assert result.schema_hints.get("birth_date") == "datetime"

    def test_schema_hints_for_active_field(self):
        """schema_hints should mark 'active' as boolean."""
        result = self.plugin.process(PATIENT_BUNDLE.encode(), "patients.fhir.json")

        assert result.schema_hints is not None
        assert result.schema_hints.get("active") == "boolean"

    def test_chat_guidance_is_set(self):
        """process should return chat_guidance describing the FHIR structure."""
        result = self.plugin.process(PATIENT_BUNDLE.encode(), "patients.fhir.json")

        assert result.chat_guidance is not None
        assert "FHIR" in result.chat_guidance
        assert "Patient" in result.chat_guidance

    def test_single_resource_json(self):
        """process should handle a single FHIR resource (not a Bundle)."""
        resource = json.dumps(
            {"resourceType": "Patient", "id": "solo", "active": True}
        ).encode()

        result = self.plugin.process(resource, "patient.fhir.json")

        assert len(result.df) == 1
        assert result.df["id"].iloc[0] == "solo"
