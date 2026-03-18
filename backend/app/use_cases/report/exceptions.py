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
