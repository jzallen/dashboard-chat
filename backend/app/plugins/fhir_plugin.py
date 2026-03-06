"""FHIR file format plugin — parses FHIR Bundles and NDJSON."""

import json
import re
from typing import ClassVar

import pandas as pd

from .protocol import PluginChoice, PluginValidationError, ProcessingResult


def _to_snake_case(name: str) -> str:
    """Convert camelCase to snake_case."""
    s1 = re.sub("(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub("([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def _flatten_resource(resource: dict, prefix: str = "") -> dict:
    """Flatten a FHIR resource to one level of nesting with snake_case keys."""
    result: dict = {}
    for key, value in resource.items():
        col_name = f"{prefix}{_to_snake_case(key)}" if prefix else _to_snake_case(key)
        if isinstance(value, (str, int, float, bool)) or value is None:
            result[col_name] = value
        elif isinstance(value, list):
            for i, item in enumerate(value[:3]):  # Limit to first 3 items
                if isinstance(item, dict):
                    if not prefix:  # Only one level deep
                        nested = _flatten_resource(item, f"{col_name}_{i}_")
                        result.update(nested)
                else:
                    result[f"{col_name}_{i}"] = item
        elif isinstance(value, dict) and not prefix:  # Only one level deep
            nested = _flatten_resource(value, f"{col_name}_")
            result.update(nested)
    return result


def _parse_fhir_content(file_content: bytes) -> list[dict]:
    """Parse FHIR content from JSON Bundle or NDJSON format."""
    text = file_content.decode("utf-8").strip()
    if not text:
        return []

    # Try as single JSON document first
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            if data.get("resourceType") == "Bundle" and "entry" in data:
                return [e["resource"] for e in data["entry"] if "resource" in e]
            elif "resourceType" in data:
                return [data]
        return []
    except json.JSONDecodeError:
        pass

    # Try as NDJSON (one JSON object per line)
    resources: list[dict] = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            if isinstance(obj, dict) and "resourceType" in obj:
                resources.append(obj)
        except json.JSONDecodeError:
            continue
    return resources


class FhirPlugin:
    """Plugin for FHIR Bundle (JSON) and NDJSON file processing."""

    name: ClassVar[str] = "fhir"
    extensions: ClassVar[list[str]] = [".ndjson", ".fhir.json"]
    label: ClassVar[str] = "FHIR"
    dbt_macros: ClassVar[dict[str, str] | None] = None

    def validate(self, file_content: bytes, filename: str) -> None:
        if not file_content or not file_content.strip():
            raise PluginValidationError("File is empty")
        resources = _parse_fhir_content(file_content)
        if not resources:
            raise PluginValidationError("Not a valid FHIR file: no resources with 'resourceType' found")

    def detect_choices(self, file_content: bytes, filename: str) -> list[PluginChoice] | None:
        resources = _parse_fhir_content(file_content)
        resource_types = sorted({r["resourceType"] for r in resources if "resourceType" in r})
        if len(resource_types) > 1:
            return [
                PluginChoice(
                    key="resource_type",
                    label="Select a resource type to import",
                    options=resource_types,
                )
            ]
        return None

    def process(
        self,
        file_content: bytes,
        filename: str,
        choices: dict[str, str] | None = None,
    ) -> ProcessingResult:
        resources = _parse_fhir_content(file_content)

        # Filter by chosen resource type
        selected_type: str | None = None
        if choices and "resource_type" in choices:
            selected_type = choices["resource_type"]
            resources = [r for r in resources if r.get("resourceType") == selected_type]

        if not resources:
            raise PluginValidationError("No resources found after filtering")

        # Determine the resource type for guidance
        actual_type = selected_type or resources[0].get("resourceType", "Unknown")

        # Flatten resources into rows
        rows = [_flatten_resource(r) for r in resources]
        df = pd.DataFrame(rows)

        # Build schema hints for known FHIR patterns
        schema_hints: dict[str, str] = {}
        for col in df.columns:
            lower = col.lower()
            date_suffixes = ("date", "_date", "date_time", "_date_time")
            date_fields = ("birth_date", "deceased_date_time", "effective_date_time", "issued")
            if lower.endswith(date_suffixes) or lower in date_fields:
                schema_hints[col] = "datetime"
            elif lower in ("active", "deceased_boolean"):
                schema_hints[col] = "boolean"

        chat_guidance = (
            f"This dataset contains FHIR {actual_type} resources. "
            f"Nested fields have been flattened with underscore notation "
            f"(e.g., name_0_family). List items are indexed (0, 1, 2)."
        )

        return ProcessingResult(
            df=df,
            schema_hints=schema_hints if schema_hints else None,
            chat_guidance=chat_guidance,
        )
