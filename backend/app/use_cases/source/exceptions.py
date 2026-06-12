"""Source domain exceptions."""

from app.use_cases.exceptions import DomainException


class SourceNotFound(DomainException):
    """Raised when a source is not found."""

    _type = "SOURCE_NOT_FOUND"
    _title = "Source Not Found"
    _status_code = 404

    def __init__(self, source_id: str | None = None):
        msg = f"Source with ID '{source_id}' not found" if source_id else "Source not found"
        super().__init__(msg)


class UploadNotPending(DomainException):
    """Raised when no pending UploadRecorded event exists for (source, upload)."""

    _type = "UPLOAD_NOT_PENDING"
    _title = "Upload Not Pending"
    _status_code = 404

    def __init__(self, upload_id: str | None = None):
        msg = f"No pending upload '{upload_id}' to process" if upload_id else "No pending upload to process"
        super().__init__(msg)


class SchemaMismatch(DomainException):
    """Raised when a subsequent upload's inferred schema does not match the
    Source's locked ``schema_config``.

    Schema-match equality rule (slice 5): the uploaded file matches iff it has
    the *exact same field-name set* AND the *same type for every field* as the
    Source's locked schema (both read from the nested ``{fields:{col:{type}}}``
    shape; field names are compared case-sensitively). Any missing field, extra
    field, or differing type fails the match — the file is NOT appended.

    Surfaced as a 422 (the upload is a well-formed file but is semantically
    incompatible with the Source's locked schema). The mismatch detail
    (``missing`` / ``extra`` / ``type_mismatch`` columns) rides the error body so
    the UI can show the user exactly why it was rejected and offer retry / pick a
    different file. Raising rolls back the use-case transaction, so the upload's
    event stays pending (reprocessing replays the same mismatch, idempotent); the
    user's recovery is to upload a NEW, corrected file.
    """

    _type = "SCHEMA_MISMATCH"
    _title = "Schema Mismatch"
    _status_code = 422

    def __init__(
        self,
        source_id: str | None = None,
        *,
        missing: list[str] | None = None,
        extra: list[str] | None = None,
        type_mismatch: list[dict[str, str]] | None = None,
    ):
        self.missing = missing or []
        self.extra = extra or []
        self.type_mismatch = type_mismatch or []
        parts: list[str] = []
        if self.missing:
            parts.append(f"missing columns: {', '.join(self.missing)}")
        if self.extra:
            parts.append(f"unexpected columns: {', '.join(self.extra)}")
        if self.type_mismatch:
            cols = ", ".join(
                f"{m['column']} (expected {m['expected']}, got {m['actual']})" for m in self.type_mismatch
            )
            parts.append(f"type mismatches: {cols}")
        detail = "; ".join(parts) if parts else "schema does not match the source"
        prefix = f"Upload schema does not match source '{source_id}'" if source_id else "Upload schema mismatch"
        super().__init__(f"{prefix} — {detail}")

    @property
    def detail(self) -> dict[str, list]:
        """Machine-readable mismatch detail for the error response body."""
        return {"missing": self.missing, "extra": self.extra, "type_mismatch": self.type_mismatch}
