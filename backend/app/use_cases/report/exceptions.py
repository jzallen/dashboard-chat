"""Report domain exceptions."""

from app.use_cases.exceptions import DomainException


class ReportNotFound(DomainException):
    """Raised when a report is not found."""

    _type = "REPORT_NOT_FOUND"
    _title = "Report Not Found"
    _status_code = 404

    def __init__(self, report_id: str | None = None):
        msg = f"Report with ID '{report_id}' not found" if report_id else "Report not found"
        super().__init__(msg)


class InvalidReportReference(DomainException):
    """Raised when a report references another report (mart-to-mart dependency)."""

    _type = "INVALID_REPORT_REFERENCE"
    _title = "Invalid Report Reference"
    _status_code = 400

    def __init__(self):
        super().__init__("Reports cannot reference other reports (no mart-to-mart dependencies)")


class DeprecatedSqlDefinitionField(DomainException):
    """Raised when a caller supplies the deprecated free-form ``sql_definition``.

    Per ADR-026 §"Decision outcome" item 2 the report-creation use case no
    longer accepts free-form SQL — the storage ``sql_definition`` is now
    ALWAYS derived by :class:`ReportIbisCompiler` from structured
    ``columns_metadata``. A caller still supplying the deprecated input
    receives this structured rejection naming the field, rather than a
    silent drop (DWD-5: rejection lives at the use-case boundary so the
    analyst sees a NAMED structured error).
    """

    _type = "DEPRECATED_SQL_DEFINITION_FIELD"
    _title = "Deprecated Report SQL Definition Field"
    _status_code = 400

    def __init__(self):
        super().__init__(
            "The 'sql_definition' input is deprecated and no longer accepted. "
            "Compose the report via structured 'columns_metadata' (dimensions + "
            "measures); the compiled SQL is derived end-to-end from the "
            "structured composition."
        )
