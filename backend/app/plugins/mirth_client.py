"""Mirth Connect HTTP client for HL7v2 to FHIR conversion."""

import httpx

from app.plugins.protocol import PluginValidationError


class MirthConnectClient:
    """HTTP client for Mirth Connect HL7v2-to-FHIR conversion."""

    def __init__(self, base_url: str, api_key: str, timeout: int = 60):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

        if not self.base_url.startswith("https://"):
            import os

            if os.environ.get("ENVIRONMENT", "development") == "production":
                raise ValueError("Mirth Connect URL must use HTTPS in production")

    def convert_hl7v2_to_fhir(self, hl7v2_content: str) -> dict:
        """Send HL7v2 content to Mirth Connect and return FHIR bundle JSON."""
        try:
            response = httpx.post(
                f"{self.base_url}/api/channels/_convert",
                content=hl7v2_content,
                headers={
                    "Content-Type": "text/plain",
                    "X-API-Key": self.api_key,
                    "Accept": "application/fhir+json",
                },
                timeout=self.timeout,
            )
        except httpx.ConnectError as err:
            raise PluginValidationError("HL7v2 conversion service is unavailable") from err
        except httpx.TimeoutException as err:
            raise PluginValidationError(f"HL7v2 conversion timed out after {self.timeout}s") from err

        if response.status_code != 200:
            raise PluginValidationError(f"HL7v2 conversion failed: Mirth Connect returned {response.status_code}")

        try:
            bundle = response.json()
        except ValueError as err:
            raise PluginValidationError("HL7v2 conversion failed: invalid JSON response from Mirth Connect") from err

        if not isinstance(bundle, dict) or bundle.get("resourceType") != "Bundle":
            raise PluginValidationError("HL7v2 conversion failed: Mirth Connect did not return a valid FHIR Bundle")

        return bundle
