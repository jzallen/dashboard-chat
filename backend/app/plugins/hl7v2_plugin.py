"""HL7v2 file format plugin — parses HL7v2 messages into tabular data."""

from typing import ClassVar

import pandas as pd

from .protocol import PluginChoice, PluginValidationError, ProcessingResult

# Well-known HL7v2 field names for chat guidance.
_FIELD_LABELS: dict[str, str] = {
    "MSH_9": "Message Type",
    "MSH_10": "Message Control ID",
    "PID_3": "Patient ID",
    "PID_5": "Patient Name",
    "PID_7": "Date of Birth",
    "PID_8": "Sex",
    "PV1_2": "Patient Class",
    "PV1_3": "Assigned Patient Location",
    "PV1_7": "Attending Doctor",
}

# Segments we extract columns from.
_SEGMENTS_OF_INTEREST = ("MSH", "PID", "PV1")

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


def _split_messages(text: str) -> list[str]:
    """Split raw text into individual HL7v2 messages.

    Messages are separated by blank lines or each MSH segment starts a new message.
    """
    lines = text.strip().splitlines()
    messages: list[str] = []
    current: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            # Blank line — end current message if any.
            if current:
                messages.append("\n".join(current))
                current = []
            continue
        if stripped.startswith("MSH") and current:
            # New MSH starts a new message.
            messages.append("\n".join(current))
            current = [stripped]
        else:
            current.append(stripped)

    if current:
        messages.append("\n".join(current))

    return messages


def _parse_message(message: str) -> dict[str, str]:
    """Parse a single HL7v2 message into a flat dict of {segment}_{index} -> value."""
    row: dict[str, str] = {}
    lines = message.strip().splitlines()

    for line in lines:
        line = line.strip()
        if len(line) < 3:
            continue

        segment_name = line[:3]
        if segment_name not in _SEGMENTS_OF_INTEREST:
            continue

        # MSH is special: position 3 is the field separator itself (usually |).
        if segment_name == "MSH":
            if len(line) < 4:
                continue
            separator = line[3]
            # MSH fields: MSH_1 is the separator itself, MSH_2 starts after.
            # Standard: split on separator, but first field (index 0) is segment name "MSH".
            # In HL7v2, MSH|^~\&|... means MSH_1=|, MSH_2=^~\&, etc.
            # We split on separator and skip the segment name part.
            parts = line.split(separator)
            # parts[0] = "MSH", parts[1] = encoding chars, parts[2..] = fields
            # MSH_1 = separator (implicit), MSH_2 = parts[1], MSH_3 = parts[2], etc.
            for i, val in enumerate(parts[1:], start=2):
                col = f"MSH_{i}"
                row[col] = val
        else:
            # For non-MSH segments, first character after segment name should be separator.
            separator = "|"
            # Try to detect separator from the line.
            if len(line) > 3:
                separator = line[3]
            parts = line.split(separator)
            # parts[0] = segment name, parts[1] = field 1, etc.
            for i, val in enumerate(parts[1:], start=1):
                col = f"{segment_name}_{i}"
                row[col] = val

    return row


class Hl7v2Plugin:
    """Plugin for HL7v2 message file processing.

    HL7v2 is a pipe-delimited healthcare messaging format. This plugin
    parses messages and flattens segments into tabular columns using
    {segment}_{field_index} naming (e.g., PID_3 = Patient ID).
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
        """Raise PluginValidationError if the file does not contain an MSH segment."""
        if not file_content:
            raise PluginValidationError("File is empty")

        text = _decode(file_content)
        if "MSH" not in text:
            raise PluginValidationError(
                "Not a valid HL7v2 file: no MSH segment found"
            )

    def detect_choices(
        self, file_content: bytes, filename: str
    ) -> list[PluginChoice] | None:
        """HL7v2 files require no user choices."""
        return None

    def process(
        self,
        file_content: bytes,
        filename: str,
        choices: dict[str, str] | None = None,
    ) -> ProcessingResult:
        """Parse HL7v2 messages into a DataFrame with one row per message."""
        text = _decode(file_content)
        messages = _split_messages(text)

        rows: list[dict[str, str]] = []
        for msg in messages:
            parsed = _parse_message(msg)
            if parsed:
                rows.append(parsed)

        df = pd.DataFrame(rows) if rows else pd.DataFrame()

        # Sort columns for deterministic output: MSH first, then PID, then PV1.
        if not df.empty:
            sorted_cols = sorted(
                df.columns,
                key=lambda c: (
                    0 if c.startswith("MSH") else 1 if c.startswith("PID") else 2,
                    int(c.split("_")[1]) if "_" in c else 0,
                ),
            )
            df = df[sorted_cols]

        return ProcessingResult(
            df=df,
            dbt_macros=self.dbt_macros,
            chat_guidance=_CHAT_GUIDANCE,
        )
