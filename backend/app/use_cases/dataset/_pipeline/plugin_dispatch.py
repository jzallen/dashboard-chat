"""Plugin dispatch coordinator for the upload pipeline.

Owns plugin lookup precedence (``get_by_name`` then ``get_for_filename``),
threaded plugin invocation with a 120s timeout, ``_converted_content``
side-channel persistence (HL7v2 -> FHIR), and the no-registry CSV
fallback. Always returns a ``MultiProcessingResult`` so the caller can
loop linearly regardless of single- vs multi-dataset plugins (the
canonicalization that lets the use case drop its ``isinstance`` branch;
ADR-022 §Decision-Outcome).
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from app.plugins.protocol import MultiProcessingResult, ProcessingResult
from app.repositories.outbox.events import UploadFileReceived
from app.utils.csv_parser import parse_and_clean_csv

if TYPE_CHECKING:
    from app.plugins import PluginRegistry
    from app.repositories.lake import LakeRepository
    from app.repositories.outbox import OutboxRepository


DEFAULT_PLUGIN_TIMEOUT_SECONDS = 120.0


class UploadPluginDispatcher:
    """Per-call coordinator that resolves a plugin, runs it, and canonicalizes the output."""

    def __init__(
        self,
        registry: PluginRegistry | None,
        lake_repo: LakeRepository,
        outbox_repo: OutboxRepository,
        timeout: float = DEFAULT_PLUGIN_TIMEOUT_SECONDS,
    ) -> None:
        self._registry = registry
        self._lake_repo = lake_repo
        self._outbox_repo = outbox_repo
        self._timeout = timeout

    async def dispatch(
        self,
        event: UploadFileReceived,
        raw_content: bytes,
        upload_id: str,
        choices: dict[str, str] | None = None,
    ) -> MultiProcessingResult:
        plugin = self._resolve_plugin(event)

        if plugin is None:
            df = await asyncio.to_thread(parse_and_clean_csv, raw_content)
            return MultiProcessingResult(results=[ProcessingResult(df=df)])

        result = await asyncio.wait_for(
            asyncio.to_thread(plugin.process, raw_content, event.original_filename, choices),
            timeout=self._timeout,
        )

        await self._persist_converted_artifact(plugin, event, upload_id)

        if isinstance(result, MultiProcessingResult):
            return result
        return MultiProcessingResult(results=[result])

    def _resolve_plugin(self, event: UploadFileReceived):
        if self._registry is None:
            return None
        plugin = None
        plugin_name = getattr(event, "plugin_name", None)
        if plugin_name:
            plugin = self._registry.get_by_name(plugin_name)
        if plugin is None:
            plugin = self._registry.get_for_filename(event.original_filename)
        return plugin

    async def _persist_converted_artifact(
        self,
        plugin,
        event: UploadFileReceived,
        upload_id: str,
    ) -> None:
        converted_content = getattr(plugin, "_converted_content", None)
        if not converted_content:
            return
        converted_path = event.raw_storage_path.rsplit(".", 1)[0] + ".converted.fhir.json"
        await asyncio.to_thread(self._lake_repo.write_raw_file, converted_content, converted_path)
        await self._outbox_repo.update_payload(upload_id, {"converted_storage_path": converted_path})
