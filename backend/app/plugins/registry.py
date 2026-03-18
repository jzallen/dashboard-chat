"""Plugin registry for file format plugins."""

import os

from .protocol import FileFormatPlugin


class PluginRegistry:
    """Registry that maps file extensions to plugin instances.

    Raises ValueError at construction time if two plugins claim the same extension.
    """

    def __init__(self, plugins: list[FileFormatPlugin]):
        self._plugins: dict[str, FileFormatPlugin] = {}  # extension → plugin
        self._by_name: dict[str, FileFormatPlugin] = {}  # name → plugin

        for plugin in plugins:
            if plugin.name in self._by_name:
                raise ValueError(f"Duplicate plugin name: '{plugin.name}'")
            self._by_name[plugin.name] = plugin

            for ext in plugin.extensions:
                ext = ext.lower()
                if ext in self._plugins:
                    existing = self._plugins[ext]
                    raise ValueError(f"Extension '{ext}' claimed by both '{existing.name}' and '{plugin.name}'")
                self._plugins[ext] = plugin

    def get_for_extension(self, ext: str) -> FileFormatPlugin | None:
        return self._plugins.get(ext.lower())

    def get_for_filename(self, filename: str) -> FileFormatPlugin | None:
        """Match a filename against registered extensions, trying compound extensions first."""
        name = filename.lower()
        # Try compound extensions first (e.g., .fhir.json)
        for ext in sorted(self._plugins, key=len, reverse=True):
            if name.endswith(ext):
                return self._plugins[ext]
        # Fallback to simple extension
        ext = os.path.splitext(name)[1]
        return self._plugins.get(ext)

    def get_by_name(self, name: str) -> FileFormatPlugin | None:
        return self._by_name.get(name)

    def supported_extensions(self) -> list[str]:
        return sorted(self._plugins.keys())

    def all_plugins(self) -> list[FileFormatPlugin]:
        return list(self._by_name.values())
