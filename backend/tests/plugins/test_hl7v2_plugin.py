"""Tests for Hl7v2Plugin."""

import pytest

from app.plugins.hl7v2_plugin import Hl7v2Plugin
from app.plugins.protocol import PluginValidationError, ProcessingResult


SAMPLE_MESSAGE = (
    "MSH|^~\\&|SENDING|FACILITY|RECEIVING|FACILITY|20230101120000||ADT^A01|MSG001|P|2.3\n"
    "PID|||12345^^^MRN||DOE^JOHN||19800101|M\n"
    "PV1||I|ICU^101^A|||7890^SMITH^JANE"
)

SAMPLE_MESSAGE_2 = (
    "MSH|^~\\&|SENDING|FACILITY|RECEIVING|FACILITY|20230201||ADT^A08|MSG002|P|2.3\n"
    "PID|||67890^^^MRN||SMITH^ALICE||19900515|F\n"
    "PV1||O|ER^201^B|||1234^JONES^BOB"
)


class TestHl7v2Plugin:
    """Tests for HL7v2 file processing plugin."""

    def setup_method(self):
        self.plugin = Hl7v2Plugin()

    def test_plugin_metadata(self):
        """Hl7v2Plugin should expose correct name, extensions, label, and dbt_macros."""
        assert self.plugin.name == "hl7v2"
        assert self.plugin.extensions == [".hl7"]
        assert self.plugin.label == "HL7v2"
        assert self.plugin.dbt_macros is not None
        assert "parse_hl7_date" in self.plugin.dbt_macros

    def test_single_message_produces_one_row(self):
        """process should return a DataFrame with 1 row for a single message."""
        content = SAMPLE_MESSAGE.encode("utf-8")

        result = self.plugin.process(content, "test.hl7")

        assert isinstance(result, ProcessingResult)
        assert len(result.df) == 1

    def test_single_message_has_correct_columns(self):
        """process should create columns with {segment}_{field_index} naming."""
        content = SAMPLE_MESSAGE.encode("utf-8")

        result = self.plugin.process(content, "test.hl7")
        cols = set(result.df.columns)

        # MSH fields (MSH_2 through MSH_12 for our sample)
        assert "MSH_9" in cols  # Message Type = ADT^A01
        assert "MSH_10" in cols  # Message Control ID = MSG001

        # PID fields
        assert "PID_3" in cols  # Patient ID = 12345^^^MRN
        assert "PID_5" in cols  # Patient Name = DOE^JOHN
        assert "PID_7" in cols  # Date of Birth = 19800101
        assert "PID_8" in cols  # Sex = M

        # PV1 fields
        assert "PV1_2" in cols  # Patient Class = I
        assert "PV1_3" in cols  # Assigned Patient Location = ICU^101^A

    def test_single_message_field_values(self):
        """process should extract correct field values from the message."""
        content = SAMPLE_MESSAGE.encode("utf-8")

        result = self.plugin.process(content, "test.hl7")
        row = result.df.iloc[0]

        assert row["MSH_9"] == "ADT^A01"
        assert row["MSH_10"] == "MSG001"
        assert row["PID_3"] == "12345^^^MRN"
        assert row["PID_5"] == "DOE^JOHN"
        assert row["PID_7"] == "19800101"
        assert row["PID_8"] == "M"
        assert row["PV1_2"] == "I"
        assert row["PV1_3"] == "ICU^101^A"

    def test_multiple_messages_produce_multiple_rows(self):
        """process should return one row per HL7v2 message."""
        content = (SAMPLE_MESSAGE + "\n\n" + SAMPLE_MESSAGE_2).encode("utf-8")

        result = self.plugin.process(content, "test.hl7")

        assert len(result.df) == 2
        assert result.df.iloc[0]["PID_5"] == "DOE^JOHN"
        assert result.df.iloc[1]["PID_5"] == "SMITH^ALICE"

    def test_multiple_messages_separated_by_msh(self):
        """process should split on MSH when messages are not blank-line separated."""
        # Two messages back-to-back with no blank line between them.
        content = (SAMPLE_MESSAGE + "\n" + SAMPLE_MESSAGE_2).encode("utf-8")

        result = self.plugin.process(content, "test.hl7")

        assert len(result.df) == 2

    def test_missing_pid_segment_produces_null_columns(self):
        """When PID is missing, PID columns should be NaN/absent."""
        # Message with only MSH and PV1, no PID.
        message = (
            "MSH|^~\\&|SENDING|FACILITY|RECEIVING|FACILITY|20230101120000||ADT^A01|MSG001|P|2.3\n"
            "PV1||I|ICU^101^A"
        )
        content = message.encode("utf-8")

        result = self.plugin.process(content, "test.hl7")

        assert len(result.df) == 1
        # PID columns should not exist or be NaN.
        if "PID_3" in result.df.columns:
            assert result.df.iloc[0]["PID_3"] != result.df.iloc[0]["PID_3"]  # NaN check
        else:
            # Column simply doesn't exist, which is also acceptable.
            pass

    def test_invalid_file_no_msh_raises_validation_error(self):
        """validate should raise PluginValidationError when no MSH segment found."""
        content = b"This is not an HL7v2 file\nJust some random text"

        with pytest.raises(PluginValidationError, match="no MSH segment found"):
            self.plugin.validate(content, "bad.hl7")

    def test_empty_file_raises_validation_error(self):
        """validate should raise PluginValidationError for empty content."""
        with pytest.raises(PluginValidationError, match="File is empty"):
            self.plugin.validate(b"", "empty.hl7")

    def test_valid_file_passes_validation(self):
        """validate should not raise for a valid HL7v2 file."""
        content = SAMPLE_MESSAGE.encode("utf-8")
        self.plugin.validate(content, "test.hl7")  # Should not raise.

    def test_detect_choices_returns_none(self):
        """detect_choices should always return None for HL7v2 files."""
        content = SAMPLE_MESSAGE.encode("utf-8")
        assert self.plugin.detect_choices(content, "test.hl7") is None

    def test_chat_guidance_is_set(self):
        """process should set chat_guidance in the ProcessingResult."""
        content = SAMPLE_MESSAGE.encode("utf-8")

        result = self.plugin.process(content, "test.hl7")

        assert result.chat_guidance is not None
        assert "HL7v2" in result.chat_guidance
        assert "MSH_9" in result.chat_guidance
        assert "PID_3" in result.chat_guidance

    def test_dbt_macros_class_attribute(self):
        """dbt_macros should contain parse_hl7_date macro."""
        assert Hl7v2Plugin.dbt_macros is not None
        assert "parse_hl7_date" in Hl7v2Plugin.dbt_macros
        assert "strptime" in Hl7v2Plugin.dbt_macros["parse_hl7_date"]

    def test_dbt_macros_in_processing_result(self):
        """process should include dbt_macros in the ProcessingResult."""
        content = SAMPLE_MESSAGE.encode("utf-8")

        result = self.plugin.process(content, "test.hl7")

        assert result.dbt_macros is not None
        assert "parse_hl7_date" in result.dbt_macros

    def test_latin1_fallback_decoding(self):
        """validate and process should handle latin-1 encoded files."""
        # Create content with a latin-1 specific byte (e.g., 0xe9 = e-acute).
        content = "MSH|^~\\&|SEND\xe9R|FAC".encode("latin-1")

        # Should not raise.
        self.plugin.validate(content, "test.hl7")

    def test_columns_sorted_msh_pid_pv1(self):
        """Columns should be ordered MSH_* then PID_* then PV1_*."""
        content = SAMPLE_MESSAGE.encode("utf-8")

        result = self.plugin.process(content, "test.hl7")

        cols = list(result.df.columns)
        msh_end = max(i for i, c in enumerate(cols) if c.startswith("MSH"))
        pid_start = min(i for i, c in enumerate(cols) if c.startswith("PID"))
        pid_end = max(i for i, c in enumerate(cols) if c.startswith("PID"))
        pv1_start = min(i for i, c in enumerate(cols) if c.startswith("PV1"))

        assert msh_end < pid_start, "MSH columns should come before PID"
        assert pid_end < pv1_start, "PID columns should come before PV1"
