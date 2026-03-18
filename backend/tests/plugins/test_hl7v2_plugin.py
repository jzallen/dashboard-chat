"""Tests for Hl7v2Plugin — 3-phase pipeline with Mirth Connect."""

import json
from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.plugins.hl7v2_plugin import Hl7v2Plugin
from app.plugins.protocol import MultiProcessingResult, PluginValidationError

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

# FHIR bundle that Mirth would return after converting HL7v2
MOCK_FHIR_BUNDLE = {
    "resourceType": "Bundle",
    "type": "transaction",
    "entry": [
        {
            "resource": {
                "resourceType": "Patient",
                "id": "1",
                "name": [{"family": "DOE", "given": ["JOHN"]}],
                "gender": "male",
                "birthDate": "1980-01-01",
            }
        },
        {
            "resource": {
                "resourceType": "Encounter",
                "id": "2",
                "status": "finished",
                "class": [{"text": "inpatient"}],
            }
        },
    ],
}


def _mock_settings(mirth_url="http://mirth:8443", mirth_key="test-key", mirth_timeout=60):
    """Create a mock settings object with Mirth Connect config."""
    settings = MagicMock()
    settings.mirth_connect_url = mirth_url
    settings.mirth_connect_api_key = mirth_key
    settings.mirth_connect_timeout = mirth_timeout
    return settings


def _mock_mirth_response(bundle=None, status_code=200):
    """Create a mock httpx response."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = bundle or MOCK_FHIR_BUNDLE
    return resp


class TestMirthConnectClient:
    def test_rejects_http_in_production(self):
        import os
        from unittest.mock import patch

        from app.plugins.mirth_client import MirthConnectClient

        with patch.dict(os.environ, {"ENVIRONMENT": "production"}), pytest.raises(ValueError, match="must use HTTPS"):
            MirthConnectClient(base_url="http://mirth:8443", api_key="key")

    def test_allows_https_in_production(self):
        import os
        from unittest.mock import patch

        from app.plugins.mirth_client import MirthConnectClient

        with patch.dict(os.environ, {"ENVIRONMENT": "production"}):
            client = MirthConnectClient(base_url="https://mirth:8443", api_key="key")
            assert client.base_url == "https://mirth:8443"

    def test_allows_http_in_development(self):
        from app.plugins.mirth_client import MirthConnectClient

        client = MirthConnectClient(base_url="http://mirth:8443", api_key="key")
        assert client.base_url == "http://mirth:8443"


class TestHl7v2PluginMetadata:
    def test_plugin_metadata(self):
        plugin = Hl7v2Plugin()
        assert plugin.name == "hl7v2"
        assert plugin.extensions == [".hl7"]
        assert plugin.label == "HL7v2"
        assert plugin.dbt_macros is not None
        assert "parse_hl7_date" in plugin.dbt_macros

    def test_dbt_macros_class_attribute(self):
        assert Hl7v2Plugin.dbt_macros is not None
        assert "parse_hl7_date" in Hl7v2Plugin.dbt_macros
        assert "strptime" in Hl7v2Plugin.dbt_macros["parse_hl7_date"]

    def test_detect_choices_returns_none(self):
        plugin = Hl7v2Plugin()
        content = SAMPLE_MESSAGE.encode("utf-8")
        assert plugin.detect_choices(content, "test.hl7") is None


class TestHl7v2PluginValidation:
    def setup_method(self):
        self.plugin = Hl7v2Plugin()

    @patch("app.plugins.hl7v2_plugin.get_settings")
    def test_valid_file_passes_validation(self, mock_get_settings):
        mock_get_settings.return_value = _mock_settings()
        content = SAMPLE_MESSAGE.encode("utf-8")
        self.plugin.validate(content, "test.hl7")

    def test_empty_file_raises_validation_error(self):
        with pytest.raises(PluginValidationError, match="File is empty"):
            self.plugin.validate(b"", "empty.hl7")

    @patch("app.plugins.hl7v2_plugin.get_settings")
    def test_invalid_file_no_msh_raises_validation_error(self, mock_get_settings):
        mock_get_settings.return_value = _mock_settings()
        content = b"This is not an HL7v2 file\nJust some random text"
        with pytest.raises(PluginValidationError, match="does not contain valid HL7v2"):
            self.plugin.validate(content, "bad.hl7")

    @patch("app.plugins.hl7v2_plugin.get_settings")
    def test_missing_mirth_config_raises_error(self, mock_get_settings):
        mock_get_settings.return_value = _mock_settings(mirth_url="")
        content = SAMPLE_MESSAGE.encode("utf-8")
        with pytest.raises(PluginValidationError, match="not configured"):
            self.plugin.validate(content, "test.hl7")

    @patch("app.plugins.hl7v2_plugin.get_settings")
    def test_latin1_fallback_decoding(self, mock_get_settings):
        mock_get_settings.return_value = _mock_settings()
        content = "MSH|^~\\&|SEND\xe9R|FAC".encode("latin-1")
        self.plugin.validate(content, "test.hl7")


class TestHl7v2PluginProcess:
    """Tests for the 3-phase process pipeline with mocked Mirth Connect."""

    def setup_method(self):
        self.plugin = Hl7v2Plugin()

    @patch("app.plugins.mirth_client.httpx.post")
    @patch("app.plugins.hl7v2_plugin.get_settings")
    def test_successful_conversion(self, mock_get_settings, mock_post):
        mock_get_settings.return_value = _mock_settings()
        mock_post.return_value = _mock_mirth_response()

        content = SAMPLE_MESSAGE.encode("utf-8")
        result = self.plugin.process(content, "test.hl7")

        assert isinstance(result, MultiProcessingResult)
        assert len(result.results) >= 1
        names = [r.name for r in result.results]
        assert "Patient" in names

    @patch("app.plugins.mirth_client.httpx.post")
    @patch("app.plugins.hl7v2_plugin.get_settings")
    def test_multi_resource_type_output(self, mock_get_settings, mock_post):
        mock_get_settings.return_value = _mock_settings()
        mock_post.return_value = _mock_mirth_response()

        content = SAMPLE_MESSAGE.encode("utf-8")
        result = self.plugin.process(content, "test.hl7")

        names = [r.name for r in result.results]
        assert "Patient" in names
        assert "Encounter" in names

    @patch("app.plugins.mirth_client.httpx.post", side_effect=httpx.ConnectError("Connection refused"))
    @patch("app.plugins.hl7v2_plugin.get_settings")
    def test_mirth_unreachable(self, mock_get_settings, mock_post):
        mock_get_settings.return_value = _mock_settings()

        content = SAMPLE_MESSAGE.encode("utf-8")
        with pytest.raises(PluginValidationError, match="unavailable"):
            self.plugin.process(content, "test.hl7")

    @patch("app.plugins.mirth_client.httpx.post")
    @patch("app.plugins.hl7v2_plugin.get_settings")
    def test_mirth_error_response(self, mock_get_settings, mock_post):
        mock_get_settings.return_value = _mock_settings()
        mock_post.return_value = _mock_mirth_response(status_code=500)

        content = SAMPLE_MESSAGE.encode("utf-8")
        with pytest.raises(PluginValidationError, match="returned 500"):
            self.plugin.process(content, "test.hl7")

    @patch("app.plugins.mirth_client.httpx.post", side_effect=httpx.ReadTimeout("timeout"))
    @patch("app.plugins.hl7v2_plugin.get_settings")
    def test_mirth_timeout(self, mock_get_settings, mock_post):
        mock_get_settings.return_value = _mock_settings()

        content = SAMPLE_MESSAGE.encode("utf-8")
        with pytest.raises(PluginValidationError, match="timed out"):
            self.plugin.process(content, "test.hl7")

    @patch("app.plugins.mirth_client.httpx.post")
    @patch("app.plugins.hl7v2_plugin.get_settings")
    def test_converted_content_stored(self, mock_get_settings, mock_post):
        """Process should store the converted FHIR bundle for persistence."""
        mock_get_settings.return_value = _mock_settings()
        mock_post.return_value = _mock_mirth_response()

        content = SAMPLE_MESSAGE.encode("utf-8")
        self.plugin.process(content, "test.hl7")

        assert hasattr(self.plugin, "_converted_content")
        converted = json.loads(self.plugin._converted_content)
        assert converted["resourceType"] == "Bundle"
