"""HL7v2 file format plugin — 3-phase pipeline: validate → Mirth Convert → FHIR normalize."""

import json
from typing import ClassVar

from app.config import get_settings

from .fhir_plugin import FhirPlugin
from .mirth_client import MirthConnectClient
from .protocol import MultiProcessingResult, PluginValidationError, ProcessingResult

_CHAT_GUIDANCE = (
    "This dataset contains HL7v2 message data with columns named {segment}_{field_index}. "
    "Key fields: MSH_9=Message Type, PID_3=Patient ID, PID_5=Patient Name, "
    "PID_7=Date of Birth, PID_8=Sex, PV1_2=Patient Class, PV1_7=Attending Doctor."
)


def _decode(file_content: bytes) -> str:
    """Decode file content as UTF-8 with latin-1 fallback."""
    try:
        return file_content.decode("utf-8")
    except UnicodeDecodeError:
        return file_content.decode("latin-1")


def _has_msh_segments(text: str) -> bool:
    """Check if text contains MSH segments."""
    for line in text.splitlines():
        if line.strip().startswith("MSH"):
            return True
    return False


class Hl7v2Plugin:
    """Plugin for HL7v2 message file processing.

    Implements a 3-phase pipeline:
    1. Validate: check MSH segments and Mirth Connect config
    2. Convert: send HL7v2 to Mirth Connect, receive FHIR R4 Bundle
    3. Normalize: pass FHIR bundle through FhirPlugin for resource splitting
    """

    name: ClassVar[str] = "hl7v2"
    extensions: ClassVar[list[str]] = [".hl7"]
    label: ClassVar[str] = "HL7v2"
    dbt_macros: ClassVar[dict[str, str] | None] = {
        "parse_hl7_date": (
            "CREATE MACRO parse_hl7_date(val) AS "
            "CASE WHEN length(val) >= 8 THEN strptime(val[:8], '%Y%m%d') ELSE NULL END;"
        ),
    }

    def validate(self, file_content: bytes, filename: str) -> None:
        if not file_content:
            raise PluginValidationError("File is empty")

        text = _decode(file_content)
        if not _has_msh_segments(text):
            raise PluginValidationError("File does not contain valid HL7v2 messages")

        settings = get_settings()
        if not settings.mirth_connect_url:
            raise PluginValidationError(
                "HL7v2 conversion is not configured. Set MIRTH_CONNECT_URL."
            )

    def detect_choices(self, file_content: bytes, filename: str) -> list | None:
        return None

    def process(
        self,
        file_content: bytes,
        filename: str,
        choices: dict[str, str] | None = None,
    ) -> MultiProcessingResult:
        """3-phase pipeline: validate → convert via Mirth → normalize via FHIR plugin."""
        text = _decode(file_content)

        # Phase 1: Already validated in validate(). Re-check MSH as safety.
        if not _has_msh_segments(text):
            raise PluginValidationError("File does not contain valid HL7v2 messages")

        # Phase 2: Convert via Mirth Connect
        settings = get_settings()
        if not settings.mirth_connect_url:
            raise PluginValidationError(
                "HL7v2 conversion is not configured. Set MIRTH_CONNECT_URL."
            )

        client = MirthConnectClient(
            base_url=settings.mirth_connect_url,
            api_key=settings.mirth_connect_api_key,
            timeout=settings.mirth_connect_timeout,
        )
        fhir_bundle = client.convert_hl7v2_to_fhir(text)

        # Store converted content for the upload use case to persist
        self._converted_content = json.dumps(fhir_bundle).encode("utf-8")

        # Phase 3: Normalize via FHIR plugin
        fhir_plugin = FhirPlugin()
        fhir_content = json.dumps(fhir_bundle).encode("utf-8")
        return fhir_plugin.process(fhir_content, filename)
