"""List-source-uploads use case.

Backs the upload modal's Files section: returns every file uploaded to a Source
(both ingested and still-pending), read from the ``UploadRecorded`` outbox
events. A source's upload history spans BOTH processed (ingested) and
unprocessed (pending) records, so this does not filter by ``processed``.
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.source.exceptions import SourceNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer
    from app.repositories.outbox import OutboxRecord


def _iso_utc_ms(dt: datetime | None) -> str | None:
    """Serialize a timestamp as UTC, millisecond-precision ISO with a ``Z`` suffix.

    OutboxRecord timestamps are stored naive-UTC; emitting them via bare
    ``isoformat()`` yields a 6-digit-microsecond, timezone-less string
    (``2026-06-12T01:09:25.524959``) that stricter browser engines (Safari)
    reject in ``Date.parse`` (→ blank "when"), and that every engine parses as
    *local* time (→ wrong relative age). Normalizing to ``…Z`` at milliseconds
    (``2026-06-12T01:09:25.524Z``) is unambiguous and parses everywhere.
    """
    if dt is None:
        return None
    aware = dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)
    return aware.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _to_upload_dict(record: "OutboxRecord") -> dict[str, Any]:
    """Map an UploadRecorded outbox record to the UI-facing upload dict.

    ``status`` is ``"ingested"`` once the event is processed, else the payload's
    pending status. ``row_count`` is the value stamped at ingest time (absent →
    ``None`` for still-pending uploads).
    """
    payload = record.payload
    status = "ingested" if record.processed else payload.get("status", "pending")
    return {
        "upload_id": payload.get("upload_id"),
        "original_filename": payload.get("original_filename"),
        "file_size": payload.get("file_size"),
        "status": status,
        "row_count": payload.get("row_count"),
        "created_at": _iso_utc_ms(record.created_at),
    }


@handle_returns
@with_repositories
async def list_source_uploads(
    source_id: str,
    *,
    repositories: "RepositoryContainer",
) -> Result[list[dict], str]:
    """List the uploads recorded against a source, oldest first.

    Raises:
        SourceNotFound: If the source does not exist.
    """
    if await repositories.metadata.get_source(source_id) is None:
        raise SourceNotFound(source_id)
    records = await repositories.outbox.list_uploads_for_source(source_id)
    return [_to_upload_dict(record) for record in records]
