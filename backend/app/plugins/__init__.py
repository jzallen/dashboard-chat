"""File format plugin system.

Plugins are registered explicitly at startup. No magic scanning.
"""

from .csv_plugin import CsvPlugin
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
    ])
