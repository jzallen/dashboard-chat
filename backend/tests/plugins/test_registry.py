"""Tests for PluginRegistry."""

import pytest

from app.plugins.registry import PluginRegistry

from .conftest import AnotherStubPlugin, MultiExtPlugin, StubPlugin


class TestPluginRegistry:
    """Tests for registering and looking up plugins."""

    def test_register_and_lookup_by_extension(self):
        """Registry should map each extension to its plugin."""
        plugin = StubPlugin()
        registry = PluginRegistry([plugin])

        assert registry.get_for_extension(".stub") is plugin

    def test_lookup_by_name(self):
        """get_by_name should return the plugin with the given name."""
        plugin = StubPlugin()
        registry = PluginRegistry([plugin])

        assert registry.get_by_name("stub") is plugin

    def test_lookup_by_name_returns_none_for_unknown(self):
        """get_by_name should return None for an unregistered name."""
        registry = PluginRegistry([StubPlugin()])

        assert registry.get_by_name("nonexistent") is None

    def test_supported_extensions_returns_sorted_list(self):
        """supported_extensions should return all extensions in sorted order."""
        registry = PluginRegistry([MultiExtPlugin(), StubPlugin()])

        assert registry.supported_extensions() == [".ext1", ".ext2", ".stub"]

    def test_all_plugins_returns_all_registered(self):
        """all_plugins should return every registered plugin."""
        stub = StubPlugin()
        another = AnotherStubPlugin()
        registry = PluginRegistry([stub, another])

        result = registry.all_plugins()
        assert len(result) == 2
        assert stub in result
        assert another in result

    def test_duplicate_extension_raises_value_error(self):
        """Constructing a registry with two plugins claiming the same extension should fail."""

        class ConflictPlugin:
            name = "conflict"
            extensions = [".stub"]  # same as StubPlugin
            label = "Conflict"
            dbt_macros = None

            def validate(self, file_content, filename):
                pass

            def detect_choices(self, file_content, filename):
                return None

            def process(self, file_content, filename, choices=None):
                pass

        with pytest.raises(ValueError, match="Extension '.stub' claimed by both"):
            PluginRegistry([StubPlugin(), ConflictPlugin()])

    def test_duplicate_name_raises_value_error(self):
        """Constructing a registry with two plugins having the same name should fail."""

        class DuplicateNamePlugin:
            name = "stub"  # same as StubPlugin
            extensions = [".different"]
            label = "Duplicate"
            dbt_macros = None

            def validate(self, file_content, filename):
                pass

            def detect_choices(self, file_content, filename):
                return None

            def process(self, file_content, filename, choices=None):
                pass

        with pytest.raises(ValueError, match="Duplicate plugin name: 'stub'"):
            PluginRegistry([StubPlugin(), DuplicateNamePlugin()])

    def test_get_for_extension_returns_none_for_unknown(self):
        """get_for_extension should return None for an unregistered extension."""
        registry = PluginRegistry([StubPlugin()])

        assert registry.get_for_extension(".unknown") is None

    def test_case_insensitive_extension_lookup(self):
        """Extension lookup should be case-insensitive."""
        plugin = StubPlugin()
        registry = PluginRegistry([plugin])

        assert registry.get_for_extension(".STUB") is plugin
        assert registry.get_for_extension(".Stub") is plugin
        assert registry.get_for_extension(".stub") is plugin

    def test_empty_registry(self):
        """A registry with no plugins should work without errors."""
        registry = PluginRegistry([])

        assert registry.supported_extensions() == []
        assert registry.all_plugins() == []
        assert registry.get_for_extension(".any") is None
        assert registry.get_by_name("any") is None

    def test_multi_extension_plugin_maps_all_extensions(self):
        """A plugin with multiple extensions should be reachable via each one."""
        plugin = MultiExtPlugin()
        registry = PluginRegistry([plugin])

        assert registry.get_for_extension(".ext1") is plugin
        assert registry.get_for_extension(".ext2") is plugin
