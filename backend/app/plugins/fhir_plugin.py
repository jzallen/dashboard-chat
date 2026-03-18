"""FHIR file format plugin — parses FHIR Bundles and NDJSON with fhir.resources."""

import json
import re
from collections import defaultdict
from datetime import date, datetime, time
from typing import ClassVar

import pandas as pd
from pydantic import ValidationError

from .protocol import MultiProcessingResult, PluginValidationError, ProcessingResult

MAX_RESOURCE_TYPES = 20

_DATE_FIELDS: set[str] = {
    "birth_date",
    "deceased_date_time",
    "effective_date_time",
    "issued",
    "authored",
    "recorded_date",
    "onset_date_time",
    "abatement_date_time",
}

_DATE_SUFFIXES: tuple[str, ...] = ("date", "_date", "date_time", "_date_time")

_BOOLEAN_FIELDS: set[str] = {"active", "deceased_boolean"}

_REFERENCE_MAP: dict[str, list[str]] = {
    "Observation": ["Patient", "Encounter"],
    "Condition": ["Patient", "Encounter"],
    "Encounter": ["Patient"],
    "MedicationRequest": ["Patient", "Encounter", "Practitioner"],
    "Procedure": ["Patient", "Encounter"],
    "DiagnosticReport": ["Patient", "Encounter"],
    "AllergyIntolerance": ["Patient"],
    "Immunization": ["Patient"],
    "Claim": ["Patient", "Practitioner"],
}


def _to_snake_case(name: str) -> str:
    """Convert camelCase to snake_case."""
    s1 = re.sub("(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub("([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def _flatten_resource(resource: dict, prefix: str = "") -> dict:
    """Flatten a FHIR resource dict using dot notation for nesting."""
    result: dict = {}
    for key, value in resource.items():
        col_name = f"{prefix}{_to_snake_case(key)}" if prefix else _to_snake_case(key)
        if isinstance(value, (str, int, float, bool, date, datetime, time)) or value is None:
            result[col_name] = value
        elif isinstance(value, list):
            for i, item in enumerate(value[:5]):
                indexed = f"{col_name}.{i}"
                if isinstance(item, dict):
                    if not prefix:
                        nested = _flatten_resource(item, f"{indexed}.")
                        result.update(nested)
                else:
                    result[indexed] = item
        elif isinstance(value, dict) and not prefix:
            nested = _flatten_resource(value, f"{col_name}.")
            result.update(nested)
    return result


def _parse_fhir_content(file_content: bytes) -> list[dict]:
    """Parse FHIR content from JSON Bundle or NDJSON format."""
    text = file_content.decode("utf-8").strip()
    if not text:
        return []

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


def _validate_resources(resources: list[dict]) -> list[dict]:
    """Validate resources with fhir.resources and return cleaned dicts."""
    from fhir.resources import construct_fhir_element

    validated: list[dict] = []
    for r in resources:
        resource_type = r.get("resourceType")
        if not resource_type:
            continue
        try:
            model = construct_fhir_element(resource_type, r)
            validated.append(model.dict(exclude_none=True))
        except LookupError as err:
            raise PluginValidationError(
                f"Unknown FHIR resource type: {resource_type}. Only FHIR R4 resources are supported."
            ) from err
        except ValidationError as e:
            raise PluginValidationError(f"Invalid FHIR R4 {resource_type}: {e.errors()[0]['msg']}") from e
    return validated


def _build_schema_hints(df: pd.DataFrame) -> dict[str, str] | None:
    hints: dict[str, str] = {}
    for col in df.columns:
        lower = col.lower()
        if lower in _BOOLEAN_FIELDS:
            hints[col] = "boolean"
        elif lower in _DATE_FIELDS or lower.endswith(_DATE_SUFFIXES):
            hints[col] = "datetime"
    return hints if hints else None


def _build_chat_guidance(resource_type: str, df: pd.DataFrame, all_types: list[str]) -> str:
    cols = ", ".join(sorted(df.columns)[:10])
    guidance = (
        f"This dataset contains FHIR {resource_type} resources. "
        f"Columns include: {cols}. "
        f"Nested fields use dot notation (e.g., name.0.family). "
        f"Array items are indexed (e.g., identifier.0.value)."
    )
    refs = _REFERENCE_MAP.get(resource_type, [])
    present_refs = [t for t in refs if t in all_types]
    if present_refs:
        guidance += f" References: {', '.join(present_refs)} (join via reference fields)."
    return guidance


class FhirPlugin:
    """Plugin for FHIR Bundle (JSON) and NDJSON file processing.

    Uses fhir.resources for R4 validation. Returns MultiProcessingResult
    with one dataset per resource type.
    """

    name: ClassVar[str] = "fhir"
    extensions: ClassVar[list[str]] = [".ndjson", ".fhir.json"]
    label: ClassVar[str] = "FHIR"
    dbt_macros: ClassVar[dict[str, str] | None] = None

    MAX_FILE_SIZE = 100_000_000  # 100 MB

    def validate(self, file_content: bytes, filename: str) -> None:
        if not file_content or not file_content.strip():
            raise PluginValidationError("File is empty")
        if len(file_content) > self.MAX_FILE_SIZE:
            raise PluginValidationError(
                f"File too large ({len(file_content)} bytes). Maximum size is {self.MAX_FILE_SIZE} bytes."
            )
        resources = _parse_fhir_content(file_content)
        if not resources:
            raise PluginValidationError("Not a valid FHIR file: no resources with 'resourceType' found")
        _validate_resources(resources)

    def detect_choices(self, file_content: bytes, filename: str) -> list | None:
        return None

    def process(
        self,
        file_content: bytes,
        filename: str,
        choices: dict[str, str] | None = None,
    ) -> MultiProcessingResult:
        raw_resources = _parse_fhir_content(file_content)
        if not raw_resources:
            raise PluginValidationError("No FHIR resources found")

        validated = _validate_resources(raw_resources)

        by_type: dict[str, list[dict]] = defaultdict(list)
        for r in validated:
            by_type[r.get("resourceType", "Unknown")].append(r)

        if len(by_type) > MAX_RESOURCE_TYPES:
            raise PluginValidationError(
                f"Bundle contains {len(by_type)} resource types, exceeding the maximum of {MAX_RESOURCE_TYPES}"
            )

        all_types = sorted(by_type.keys())

        results: list[ProcessingResult] = []
        for resource_type in all_types:
            rows = [_flatten_resource(r) for r in by_type[resource_type]]
            df = pd.DataFrame(rows)
            results.append(
                ProcessingResult(
                    df=df,
                    name=resource_type,
                    schema_hints=_build_schema_hints(df),
                    chat_guidance=_build_chat_guidance(resource_type, df, all_types),
                )
            )

        overall_guidance = (
            f"This upload contains {len(validated)} FHIR resources across "
            f"{len(all_types)} type(s): {', '.join(all_types)}."
        )

        return MultiProcessingResult(results=results, chat_guidance=overall_guidance)
