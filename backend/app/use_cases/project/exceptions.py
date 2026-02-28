"""Project domain exceptions."""

from app.use_cases.exceptions import DomainException


class ProjectIdRequired(DomainException):
    """Raised when project_id is required but not provided."""

    _type = "PROJECT_ID_REQUIRED"
    _title = "Project ID Required"
    _status_code = 400

    def __init__(self):
        super().__init__("project_id is required")


class ProjectNotFound(DomainException):
    """Raised when a project is not found."""

    _type = "PROJECT_NOT_FOUND"
    _title = "Project Not Found"
    _status_code = 404

    def __init__(self, project_id: str | None = None):
        msg = f"Project with ID '{project_id}' not found" if project_id else "Project with ID"
        super().__init__(msg)


class ProjectHasNoDatasets(DomainException):
    """Raised when trying to enable SQL access on a project with no datasets."""

    _type = "PROJECT_HAS_NO_DATASETS"
    _title = "Project Has No Datasets"
    _status_code = 400

    def __init__(self, project_id: str):
        super().__init__(f"Project '{project_id}' has no datasets to expose")
