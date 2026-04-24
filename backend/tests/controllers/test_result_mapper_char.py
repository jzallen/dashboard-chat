"""Characterization tests — Seam 0: Shared HTTP plumbing (_serialize, _error_response).

Pins the CURRENT observable behavior of the two module-level helpers in
`app/controllers/http_controller.py` (L29-57). These tests must remain green
after extraction to `_result_mapper.py`.

Existing coverage in test_http_controller.py::TestErrorResponse already hits:
- DatasetNotFound (404), ProjectNotFound (404), RuntimeError (500),
  UploadAlreadyProcessed (409), InvalidFileType (400), EmptyFile (400),
  ProjectIdRequired (400).
Gaps pinned here:
- `_serialize` — recursion over list/tuple, passthrough for dict/primitive,
  .serialize() dispatch for models.
- `_error_response` retry_after branch (CredentialCooldown).
- DomainException status-code dispatch breadth beyond the smoke-tested subset
  (parameterized over the 5xx and 4xx buckets across domains).
"""

from dataclasses import dataclass
from typing import Any

import pytest

from app.controllers.http_controller import _error_response, _serialize
from app.use_cases.dataset.exceptions import (
    ColumnTypeMismatch,
    DatasetNotFound,
    PreviewNotSupported,
)
from app.use_cases.exceptions import DomainException
from app.use_cases.organization.exceptions import ExternalServiceError
from app.use_cases.project.exceptions import (
    ProjectHasNoDatasets,
    ProjectNotFound,
)
from app.use_cases.report.exceptions import InvalidReportReference, ReportNotFound
from app.use_cases.session.exceptions import SessionAccessDenied, SessionNotFound
from app.use_cases.sql_access.exceptions import (
    CredentialCooldown,
    QueryEngineUnreachable,
    SqlAccessAlreadyEnabled,
    SqlAccessNotEnabled,
)
from app.use_cases.view.exceptions import (
    CircularDependency,
    InvalidSourceReference,
    ViewNotFound,
)

# ---------------------------------------------------------------------------
# _serialize characterization
# ---------------------------------------------------------------------------


@dataclass
class _ModelWithSerialize:
    id: str
    name: str

    def serialize(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name}


class TestSerializeDispatch:
    """Verify the three-way match in _serialize (L34-40)."""

    def test_model_with_serialize_method_calls_it(self):
        model = _ModelWithSerialize(id="x1", name="thing")
        result = _serialize(model)
        assert result == {"id": "x1", "name": "thing"}

    def test_list_of_models_recurses(self):
        models = [_ModelWithSerialize("a", "A"), _ModelWithSerialize("b", "B")]
        result = _serialize(models)
        assert result == [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}]

    def test_tuple_of_models_recurses(self):
        models = (_ModelWithSerialize("a", "A"), _ModelWithSerialize("b", "B"))
        result = _serialize(models)
        assert result == [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}]

    def test_mixed_list_passes_through_non_models(self):
        mixed = [_ModelWithSerialize("a", "A"), {"id": "b"}, "raw"]
        result = _serialize(mixed)
        assert result == [{"id": "a", "name": "A"}, {"id": "b"}, "raw"]

    def test_empty_list_returns_empty_list(self):
        assert _serialize([]) == []

    def test_dict_passes_through_unchanged(self):
        d = {"id": "p1", "name": "Proj"}
        assert _serialize(d) is d  # identity preserved — no wrapping

    def test_primitive_string_passes_through(self):
        assert _serialize("hello") == "hello"

    def test_primitive_int_passes_through(self):
        assert _serialize(42) == 42

    def test_none_passes_through(self):
        assert _serialize(None) is None


# ---------------------------------------------------------------------------
# _error_response characterization — DomainException dispatch matrix
# ---------------------------------------------------------------------------


class TestErrorResponseDomainExceptionDispatch:
    """The 29x repeated `case Failure(error): return _error_response(error)`
    pattern in the controller relies on DomainException carrying `_status_code`
    and `_title`. Exercise the full breadth to pin the dispatch contract.
    """

    @pytest.mark.parametrize(
        ("exc_factory", "expected_status", "expected_title"),
        [
            # 400 family
            (lambda: InvalidSourceReference(["v1"]), 400, "Invalid Source Reference"),
            (lambda: CircularDependency("v1"), 400, "Circular Dependency"),
            (lambda: InvalidReportReference(), 400, "Invalid Report Reference"),
            (lambda: ProjectHasNoDatasets("p1"), 400, "Project Has No Datasets"),
            (lambda: PreviewNotSupported("OP"), 400, "Preview Not Supported"),
            # 403
            (lambda: SessionAccessDenied("s1"), 403, "Session Access Denied"),
            # 404 family
            (lambda: DatasetNotFound("d1"), 404, "Dataset Not Found"),
            (lambda: ProjectNotFound("p1"), 404, "Project Not Found"),
            (lambda: ViewNotFound("v1"), 404, "View Not Found"),
            (lambda: ReportNotFound("r1"), 404, "Report Not Found"),
            (lambda: SessionNotFound("s1"), 404, "Session Not Found"),
            (lambda: SqlAccessNotEnabled("p1"), 404, "SQL Access Not Enabled"),
            # 409 family
            (lambda: SqlAccessAlreadyEnabled("p1"), 409, "SQL Access Already Enabled"),
            # 422
            (
                lambda: ColumnTypeMismatch("col", "int", "op"),
                422,
                "Column Type Mismatch",
            ),
            # 502 family
            (lambda: ExternalServiceError("boom"), 502, "External Service Error"),
            (lambda: QueryEngineUnreachable("qe1"), 502, "Query Engine Unreachable"),
        ],
    )
    def test_domain_exception_maps_to_jsonapi_error(
        self, exc_factory, expected_status, expected_title
    ):
        body, status = _error_response(exc_factory())
        assert status == expected_status
        assert body["errors"][0]["status"] == str(expected_status)
        assert body["errors"][0]["title"] == expected_title
        # detail comes from str(exception)
        assert "detail" in body["errors"][0]


class TestErrorResponseRetryAfter:
    """L51-52: `if hasattr(error, 'retry_after'): body['errors'][0]['retry_after'] = ...`.
    CredentialCooldown is the only DomainException that sets this today.
    """

    def test_credential_cooldown_includes_retry_after(self):
        body, status = _error_response(CredentialCooldown(seconds_remaining=42))
        assert status == 429
        assert body["errors"][0]["title"] == "Credential Regeneration Too Soon"
        assert body["errors"][0]["retry_after"] == 42

    def test_non_cooldown_exception_omits_retry_after(self):
        body, _ = _error_response(DatasetNotFound("d1"))
        assert "retry_after" not in body["errors"][0]


class TestErrorResponseFallback:
    """Non-DomainException exceptions funnel through the generic 500 path (L55-57)."""

    def test_generic_exception_returns_500(self):
        body, status = _error_response(ValueError("bad input"))
        assert status == 500
        assert body["errors"][0]["status"] == "500"
        assert body["errors"][0]["title"] == "Internal Server Error"
        assert "check server logs" in body["errors"][0]["detail"].lower()

    def test_generic_exception_detail_does_not_leak_message(self):
        """The fallback message is static — raw exception text is NOT returned
        to the client (prevents accidental info-disclosure)."""
        body, _ = _error_response(RuntimeError("secret-password=hunter2"))
        assert "hunter2" not in body["errors"][0]["detail"]

    def test_base_domain_exception_still_dispatches_as_domain(self):
        """A bare DomainException (not a subclass) uses the base _status_code=500
        and _title='Internal Error'. This is the fallback-but-still-domain path."""
        body, status = _error_response(DomainException("base"))
        assert status == 500
        assert body["errors"][0]["title"] == "Internal Error"
