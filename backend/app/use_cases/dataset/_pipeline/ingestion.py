"""Ingestion pipeline helpers for creating datasets from uploads."""

import asyncio
import json
import re

import pandas as pd

from app.models.dataset import Dataset
from app.repositories.outbox import OutboxRepository
from app.use_cases.project._dbt.naming import to_snake_case
from app.use_cases.upload.exceptions import UploadNotFound
from app.utils.column_profiler import compute_column_profiles
from app.utils.schema_inference import infer_schema_from_dataframe

# A trailing token that "looks like" a file extension: a dot followed by 1-5
# ASCII letters at the very end of the string (e.g. ``.csv``, ``.xlsx``).
_EXTENSION_RE = re.compile(r"\.[A-Za-z]{1,5}$")
# Separator runs to fold into a single space when humanizing a raw label.
_SEPARATOR_RE = re.compile(r"[_\-.\s]+")

_FALLBACK_LABEL = "New Dataset"


def title_case_label(raw: str) -> str:
    """Derive a human-readable, title-cased display label from a raw name.

    Used to seed a freshly-created dataset's ``display_name`` from its linked
    Source name (or the uploaded filename). The immutable ``name`` is never
    touched — this only produces the editable label.

    Rules:
        1. Strip a single trailing file extension (a dot + <=5 ASCII letters).
        2. Replace ``_``, ``-``, ``.`` and whitespace runs with a single space,
           then collapse and strip.
        3. Title-case each word (ASCII ``.title()``).
        4. An empty result falls back to ``"New Dataset"`` (never empty).

    Examples:
        ``customers.csv`` -> ``Customers``
        ``orders_csv`` -> ``Orders Csv``
        ``q1-revenue.xlsx`` -> ``Q1 Revenue``
    """
    if not raw:
        return _FALLBACK_LABEL

    without_extension = _EXTENSION_RE.sub("", raw.strip())
    spaced = _SEPARATOR_RE.sub(" ", without_extension).strip()
    if not spaced:
        return _FALLBACK_LABEL
    return spaced.title()


def stg_model_name(display_name: str) -> str:
    """Derive a dataset's persisted dbt machine name (``model_name``) at creation.

    The ``model_name`` is the staging-model identifier the dbt compiler binds to
    (e.g. ``stg_customers``). It is derived from the human ``display_name`` ONCE,
    at dataset creation, and is thereafter DECOUPLED from it — a later
    display-name edit must never reconcile back into ``model_name`` (independent
    editing with a warehouse-migration warning is a separate, later concern).

    Derivation:
        1. ``root = to_snake_case(display_name)`` — reuses the tested dbt naming
           helper (which folds an empty/punctuation-only input to ``"dataset"``).
        2. If ``root`` already starts with ``stg_``, return it unchanged so an
           already-prefixed display name does not become ``stg_stg_…``.
        3. Otherwise prefix it: ``f"stg_{root}"``.

    Examples:
        ``"Customers"`` -> ``stg_customers``
        ``"Q1 Revenue"`` -> ``stg_q1_revenue``
        ``"stg_orders"`` -> ``stg_orders``
        ``""`` -> ``stg_dataset``
    """
    root = to_snake_case(display_name)
    if root.startswith("stg_"):
        return root
    return f"stg_{root}"


async def fetch_upload_event(outbox_repo: OutboxRepository, upload_id: str):
    """Fetch and validate the upload outbox event."""
    event = await outbox_repo.get_file_received_event_by_id(upload_id)
    if event is None:
        raise UploadNotFound(upload_id)
    return event


async def read_raw_file(lake_repo, storage_path: str, upload_id: str) -> bytes:
    """Read the raw uploaded file from storage."""
    raw_content = await asyncio.to_thread(lake_repo.read_raw_file, storage_path)
    if not raw_content:
        raise UploadNotFound(upload_id)
    return raw_content


def analyze_dataframe(
    df: pd.DataFrame, schema_hints: dict[str, str] | None = None
) -> tuple[dict, list[dict], list[dict], int]:
    """Infer schema, compute column profiles, generate preview rows, and snapshot row count.

    Args:
        df: The DataFrame to analyze.
        schema_hints: Optional dict of column_name → type to override inference.

    Returns:
        ``(schema_config, column_profiles, preview_rows, row_count)``. The
        row count is the dataframe's length at ingestion — surfaced by the
        dataset GET response so callers don't have to page through previews.
    """
    schema_config = infer_schema_from_dataframe(df)

    if schema_hints:
        fields = schema_config.get("fields", {})
        for col_name, col_type in schema_hints.items():
            if col_name in fields:
                fields[col_name]["type"] = col_type

    column_profiles = compute_column_profiles(df, schema_config)
    preview_rows = json.loads(df.head(10).to_json(orient="records", date_format="iso"))
    row_count = len(df)
    return schema_config, column_profiles, preview_rows, row_count


async def create_dataset_record(
    metadata_repo,
    project_id: str,
    schema_config: dict,
    description: str | None,
    partition_fields: list[str],
    column_profiles: list[dict],
    preview_rows: list[dict],
    format_context: str | None = None,
    name: str | None = None,
    row_count: int | None = None,
    display_name: str | None = None,
    model_name: str | None = None,
) -> Dataset:
    """Create the dataset metadata record and return a Dataset domain object.

    ``display_name`` is the editable human label seeded at creation; ``name`` is
    the immutable filename (defaults to ``"New Dataset"`` only when unset).
    ``model_name`` is the dbt machine name (``stg_<snake>``) derived from
    ``display_name`` once at creation, decoupled thereafter.
    """
    dataset_dict = await metadata_repo.create_dataset(
        project_id=project_id,
        name=name or "New Dataset",
        schema_config=schema_config,
        description=description,
        partition_fields=partition_fields,
        column_profiles=column_profiles,
        format_context=format_context,
        row_count=row_count,
        display_name=display_name,
        model_name=model_name,
    )
    return Dataset(
        id=dataset_dict["id"],
        project_id=dataset_dict["project_id"],
        name=dataset_dict["name"],
        display_name=dataset_dict.get("display_name"),
        model_name=dataset_dict.get("model_name"),
        description=dataset_dict["description"],
        schema_config=dataset_dict["schema_config"],
        partition_fields=dataset_dict["partition_fields"],
        preview_rows=preview_rows,
        column_profiles=dataset_dict["column_profiles"],
        format_context=dataset_dict.get("format_context"),
        row_count=dataset_dict.get("row_count"),
    )


async def write_parquet(
    lake_repo, df: pd.DataFrame, dataset: Dataset, partition_fields: list[str], upload_id: str
) -> None:
    """Write the cleaned CSV as partitioned parquet files to storage.

    Every upload (first link AND subsequent appends) writes under a uniform
    per-upload hive partition ``upload_id={upload_id}/`` beneath the dataset's
    base ``storage_path``. ``upload_id`` is injected as a constant column on a
    COPY of the df at write time only — schema inference / preview_rows (which
    run on ``result.df`` before this call) never see it, so it stays out of the
    dataset's stored ``schema_config`` and ``partition_fields``. It is an
    internal provenance partition: the ``**/*.parquet`` glob unions all
    per-upload partitions, and the column-explicit staging SQL excludes the
    physical ``upload_id`` column from the default view.
    """
    partitioned_df = df.copy()
    partitioned_df["upload_id"] = upload_id
    cleaned_csv = partitioned_df.to_csv(index=False).encode("utf-8")
    await asyncio.to_thread(
        lambda: lake_repo.write_csv_as_partitioned_parquet(
            csv_content=cleaned_csv,
            storage_prefix=dataset.storage_path,
            partition_fields=[*partition_fields, "upload_id"],
        )
    )


async def create_single_dataset(
    metadata_repo,
    lake_repo,
    project_id: str,
    result,
    description: str | None,
    partition_fields: list[str],
    upload_id: str,
    display_name: str | None = None,
    model_name: str | None = None,
) -> Dataset:
    """Analyze one ProcessingResult, create its dataset record, and write parquet.

    Shared by the synchronous ``create_dataset_from_upload`` path and the
    UI-triggered ``source.process_upload`` path so the ingestion mechanics live
    in exactly one place. ``upload_id`` becomes a per-upload hive partition at
    write time (provenance only) — the stored ``partition_fields`` remain the
    caller's list.
    """
    schema_config, column_profiles, preview_rows, row_count = analyze_dataframe(result.df, result.schema_hints)
    dataset = await create_dataset_record(
        metadata_repo,
        project_id,
        schema_config,
        description,
        partition_fields,
        column_profiles,
        preview_rows,
        format_context=result.chat_guidance,
        name=result.name,
        row_count=row_count,
        display_name=display_name,
        model_name=model_name,
    )
    await write_parquet(lake_repo, result.df, dataset, partition_fields, upload_id)
    return dataset
