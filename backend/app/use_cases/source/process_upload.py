"""Process-upload use case (slice 2) — UI-triggered ingestion.

Consumes the pending ``UploadRecorded`` event minted by ``record_upload``,
reads the object the browser PUT directly to MinIO back into the app server,
runs plugin validation / choice-detection, ingests the file (CSV -> parquet),
and — for the FIRST upload to a Source — creates the public SELECT * Dataset,
links it to the Source, and locks the Source schema. Marks the event processed
and emits ``DatasetSyncRequested`` so the query engine sync path is unchanged.

Subsequent uploads (slice 5) compare the inferred schema to the Source's
locked ``schema_config``: on a match the new file's parquet is appended to the
existing Dataset's storage prefix and the result reports ``status="appended"``;
on a mismatch a ``SchemaMismatch`` (422) is raised with the offending columns
and nothing is appended.
"""

import asyncio
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.models.dataset import Dataset
from app.plugins.protocol import PluginValidationError
from app.repositories import with_repositories
from app.repositories.outbox.events import UploadFileReceived, to_event
from app.use_cases import handle_returns
from app.use_cases.dataset._pipeline import create_single_dataset, read_raw_file
from app.use_cases.dataset._pipeline.ingestion import analyze_dataframe
from app.use_cases.dataset._pipeline.plugin_dispatch import UploadPluginDispatcher
from app.use_cases.source.exceptions import SchemaMismatch, SourceNotFound, UploadNotPending

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

_PLUGIN_TIMEOUT_SECONDS = 120.0


@dataclass(frozen=True, slots=True)
class ProcessedUpload:
    """Result of a processed upload: the linked/appended Dataset plus a status.

    ``status`` is ``"linked"`` for the first upload (a new SELECT * Dataset was
    created and linked to the Source) or ``"appended"`` for a subsequent
    schema-matching upload (parquet appended to the existing Dataset). Exposes
    the Dataset's identity fields for callers and serializes to the standard
    ``datasets`` resource shape with ``status`` added.
    """

    dataset: Dataset
    status: str

    @property
    def id(self) -> str:
        return self.dataset.id

    @property
    def project_id(self) -> str | None:
        return self.dataset.project_id

    @property
    def name(self) -> str:
        return self.dataset.name

    @property
    def schema_config(self) -> dict[str, Any]:
        return self.dataset.schema_config

    @property
    def source_id(self) -> str | None:
        return self.dataset.source_id

    @property
    def row_count(self) -> int | None:
        return self.dataset.row_count

    def serialize(self) -> dict[str, Any]:
        return {**self.dataset.serialize(), "status": self.status}


def _field_types(schema_config: dict[str, Any]) -> dict[str, str]:
    """Extract ``{column: type}`` from the nested ``{fields:{col:{type,...}}}`` shape."""
    fields = (schema_config or {}).get("fields", {})
    return {name: spec.get("type") for name, spec in fields.items()}


def _compare_schemas(locked: dict[str, Any], incoming: dict[str, Any]) -> SchemaMismatch | None:
    """Compare an incoming inferred schema to the source's locked schema.

    Match rule: identical field-name set AND identical type per field. Returns a
    populated ``SchemaMismatch`` (not raised) describing the differences, or
    ``None`` when the schemas match.
    """
    locked_types = _field_types(locked)
    incoming_types = _field_types(incoming)

    missing = sorted(set(locked_types) - set(incoming_types))
    extra = sorted(set(incoming_types) - set(locked_types))
    type_mismatch = [
        {"column": name, "expected": locked_types[name], "actual": incoming_types[name]}
        for name in sorted(set(locked_types) & set(incoming_types))
        if locked_types[name] != incoming_types[name]
    ]

    if missing or extra or type_mismatch:
        return SchemaMismatch(missing=missing, extra=extra, type_mismatch=type_mismatch)
    return None


async def _detect_choices(plugin, raw_content: bytes, filename: str):
    """Run the plugin's validate + detect_choices (or None when no plugin)."""
    if plugin is None:
        return None
    try:
        await asyncio.wait_for(
            asyncio.to_thread(plugin.validate, raw_content, filename), timeout=_PLUGIN_TIMEOUT_SECONDS
        )
    except TimeoutError as err:
        raise PluginValidationError(f"Plugin '{plugin.name}' validation timed out") from err
    return await asyncio.wait_for(
        asyncio.to_thread(plugin.detect_choices, raw_content, filename), timeout=_PLUGIN_TIMEOUT_SECONDS
    )


@handle_returns
@with_repositories
async def process_upload(
    source_id: str,
    upload_id: str,
    partition_fields: list[str] | None = None,
    plugin_registry: Any = None,
    choices: dict[str, str] | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[Dataset | dict, str]:
    """Ingest a previously-recorded upload and create/link the Source's Dataset.

    Args:
        source_id: The target Source UUID.
        upload_id: The pending UploadRecorded upload UUID.
        partition_fields: Optional hive partition fields for the parquet write.
        plugin_registry: Optional plugin registry for format-specific handling.
        choices: Optional user choices (e.g. ``{"sheet_name": "Sheet1"}``) to
            resolve an ``awaiting_input`` step from a prior call.

    Returns:
        Success with a ``ProcessedUpload`` (``status="linked"`` for the first
        upload, ``status="appended"`` for a subsequent schema-matching upload),
        or an ``awaiting_input`` marker dict ``{status, upload_id, choices}`` when
        the plugin needs a choice and none was supplied, or Failure on error.

    Raises:
        SourceNotFound: If the source does not exist.
        UploadNotPending: If there is no pending UploadRecorded for the upload.
        SchemaMismatch: If a subsequent upload's schema differs from the source's
            locked schema (422); the file is not appended.
    """
    metadata_repo = repositories.metadata
    lake_repo = repositories.lake
    outbox_repo = repositories.outbox
    partition_fields = partition_fields or []

    if await metadata_repo.get_source(source_id) is None:
        raise SourceNotFound(source_id)

    pending = await outbox_repo.get_pending_event("upload", upload_id, "UploadRecorded")
    if pending is None:
        raise UploadNotPending(upload_id)

    recorded = to_event("UploadRecorded", pending.payload)
    raw_content = await read_raw_file(lake_repo, recorded.storage_key, upload_id)

    plugin = _resolve_plugin(plugin_registry, recorded.original_filename)
    detected = await _detect_choices(plugin, raw_content, recorded.original_filename)
    if detected and not choices:
        return {
            "status": "awaiting_input",
            "upload_id": upload_id,
            "choices": [{"key": c.key, "label": c.label, "options": c.options} for c in detected],
        }

    synthetic_event = UploadFileReceived(
        project_id=recorded.project_id,
        raw_storage_path=recorded.storage_key,
        original_filename=recorded.original_filename,
        file_size=recorded.file_size,
        plugin_name=plugin.name if plugin else None,
    )
    dispatcher = UploadPluginDispatcher(plugin_registry, lake_repo, outbox_repo)
    multi_result = await dispatcher.dispatch(synthetic_event, raw_content, upload_id, choices)
    result_item = multi_result.results[0]

    existing = await metadata_repo.get_dataset_by_source(source_id)
    if existing is not None:
        return await _append_to_existing(
            repositories, source_id, pending.id, upload_id, recorded.project_id, result_item, existing
        )

    return await _link_first_upload(
        repositories, source_id, pending.id, upload_id, recorded.project_id, result_item, partition_fields
    )


async def _link_first_upload(
    repositories: "RepositoryContainer",
    source_id: str,
    pending_id: Any,
    upload_id: str,
    project_id: str,
    result_item: Any,
    partition_fields: list[str],
) -> ProcessedUpload:
    """First upload: create the SELECT * Dataset, link it, and lock the schema."""
    metadata_repo = repositories.metadata
    dataset = await create_single_dataset(
        metadata_repo, repositories.lake, project_id, result_item, None, partition_fields, upload_id
    )

    await metadata_repo.link_dataset_to_source(dataset_id=dataset.id, source_id=source_id)
    await metadata_repo.update_source_schema(source_id=source_id, schema_config=dataset.schema_config)
    await repositories.outbox.update_payload(pending_id, {"row_count": dataset.row_count})
    await repositories.outbox.mark_processed([pending_id])
    await _emit_sync_event(repositories.external_access, repositories.outbox, project_id, dataset)

    linked = Dataset(
        id=dataset.id,
        project_id=dataset.project_id,
        name=dataset.name,
        description=dataset.description,
        schema_config=dataset.schema_config,
        partition_fields=dataset.partition_fields,
        transforms=dataset.transforms,
        preview_rows=dataset.preview_rows,
        column_profiles=dataset.column_profiles,
        format_context=dataset.format_context,
        row_count=dataset.row_count,
        source_id=source_id,
    )
    return ProcessedUpload(dataset=linked, status="linked")


async def _append_to_existing(
    repositories: "RepositoryContainer",
    source_id: str,
    pending_id: Any,
    upload_id: str,
    project_id: str,
    result_item: Any,
    existing: dict[str, Any],
) -> ProcessedUpload:
    """Subsequent upload: schema-match against the source, append parquet on match.

    On a mismatch raises ``SchemaMismatch`` — nothing is appended. The raise
    propagates through ``with_repositories``, which rolls back the use-case
    transaction, so the ``UploadRecorded`` event stays pending: reprocessing the
    same upload deterministically replays the same mismatch (idempotent failure).
    The user's recovery is to upload a NEW, corrected file (the UI surfaces the
    offending columns and offers retry / pick-a-different-file).
    """
    metadata_repo = repositories.metadata
    incoming_schema, _profiles, _preview, incoming_rows = analyze_dataframe(
        result_item.df, result_item.schema_hints
    )

    source = await metadata_repo.get_source(source_id)
    mismatch = _compare_schemas(source["schema_config"], incoming_schema)
    if mismatch is not None:
        raise SchemaMismatch(
            source_id, missing=mismatch.missing, extra=mismatch.extra, type_mismatch=mismatch.type_mismatch
        )

    existing_dataset = Dataset(
        id=existing["id"],
        project_id=existing["project_id"],
        name=existing["name"],
        schema_config=existing["schema_config"],
        partition_fields=existing.get("partition_fields") or [],
        row_count=existing.get("row_count"),
        source_id=source_id,
    )
    # Append under a uniform per-upload hive partition ``upload_id={upload_id}/``
    # beneath the dataset's base ``storage_path`` (same layout as the first/link
    # upload). The new parquet does NOT overwrite the existing dataset's parquet:
    # the reader globs ``**/*.parquet`` across the whole storage prefix, so every
    # per-upload partition accumulates into one unioned table. The column-explicit
    # staging SQL (``SELECT <fields>`` only) excludes the physical ``upload_id``
    # partition column from the default view — it stays as internal provenance.
    await _write_append_parquet(
        repositories.lake,
        result_item.df,
        existing_dataset.storage_path,
        existing_dataset.partition_fields,
        upload_id,
    )

    # NOTE: row_count uses snapshot arithmetic (existing + incoming). A true
    # COUNT(*) re-derive is now possible since partitions accumulate under the
    # base prefix, but that is out of scope here.
    new_row_count = (existing.get("row_count") or 0) + incoming_rows
    await metadata_repo.update_dataset(existing_dataset.id, row_count=new_row_count)
    await repositories.outbox.update_payload(pending_id, {"row_count": incoming_rows})
    await repositories.outbox.mark_processed([pending_id])
    await _emit_sync_event(repositories.external_access, repositories.outbox, project_id, existing_dataset)

    appended = Dataset(
        id=existing_dataset.id,
        project_id=existing_dataset.project_id,
        name=existing_dataset.name,
        schema_config=existing_dataset.schema_config,
        partition_fields=existing_dataset.partition_fields,
        row_count=new_row_count,
        source_id=source_id,
    )
    return ProcessedUpload(dataset=appended, status="appended")


async def _write_append_parquet(
    lake_repo, df, storage_prefix: str, partition_fields: list[str], upload_id: str
) -> None:
    """Write an appended file's parquet under the per-upload hive partition.

    Injects ``upload_id`` as a constant column on a COPY of the df (provenance
    only — analysis already ran on the original df) and partitions by
    ``[*partition_fields, "upload_id"]`` so the write lands at
    ``{storage_prefix}upload_id={upload_id}/data_0.parquet`` without overwriting
    earlier uploads.
    """
    partitioned_df = df.copy()
    partitioned_df["upload_id"] = upload_id
    cleaned_csv = partitioned_df.to_csv(index=False).encode("utf-8")
    await asyncio.to_thread(
        lambda: lake_repo.write_csv_as_partitioned_parquet(
            csv_content=cleaned_csv,
            storage_prefix=storage_prefix,
            partition_fields=[*partition_fields, "upload_id"],
        )
    )


def _resolve_plugin(plugin_registry, filename: str):
    if plugin_registry is None:
        return None
    return plugin_registry.get_for_filename(filename)


async def _emit_sync_event(external_access_repo, outbox_repo, project_id: str, dataset: Dataset) -> None:
    """Emit a DatasetSyncRequested event if the project has SQL access enabled."""
    engine_node_id = await external_access_repo.get_active_engine_node_id(project_id)
    if not engine_node_id:
        return
    await outbox_repo.submit_dataset_sync_event(
        project_id=project_id,
        dataset_id=dataset.id,
        engine_node_id=engine_node_id,
    )
