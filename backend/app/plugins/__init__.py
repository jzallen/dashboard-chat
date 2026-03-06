"""File format plugin system.

Plugins are registered explicitly at startup. No magic scanning.
"""

from .csv_plugin import CsvPlugin
from .excel_plugin import ExcelPlugin
from .fhir_plugin import FhirPlugin
from .hl7v2_plugin import Hl7v2Plugin
from .protocol import FileFormatPlugin, PluginChoice, PluginValidationError, ProcessingResult
from .registry import PluginRegistry

__all__ = [
    "FileFormatPlugin",
    "PluginChoice",
    "PluginRegistry",
    "PluginValidationError",
    "ProcessingResult",
    "create_plugin_registry",
]


def create_plugin_registry() -> PluginRegistry:
    """Factory function called at app startup. Explicit registration."""
    return PluginRegistry([
        CsvPlugin(),
        ExcelPlugin(),
        FhirPlugin(),
        Hl7v2Plugin(),
    ])
