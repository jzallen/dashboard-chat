"""Tests that db commit/rollback failures are wrapped as Failure by the decorator stack.

The decorator order @handle_returns (outer) / @with_repositories (inner) ensures that
exceptions raised during commit() or rollback() inside with_repositories are caught by
handle_returns and returned as Failure — not propagated as unhandled exceptions.
"""

from unittest.mock import AsyncMock

import pytest
from returns.result import Failure, Success
from sqlalchemy.exc import OperationalError

from app.auth.context import clear_auth_user, set_auth_user
from app.auth.types import AuthUser
from app.repositories import set_session, with_repositories
from app.use_cases import handle_returns
from tests.uuidv7_fixtures import ORG_1, USER_1

TEST_USER = AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User")


@pytest.fixture(autouse=True)
def auth_user():
    set_auth_user(TEST_USER)
    yield
    clear_auth_user()


def _make_mock_session(commit_error=None, rollback_error=None):
    """Create a mock AsyncSession with configurable commit/rollback behavior."""
    session = AsyncMock()
    if commit_error:
        session.commit.side_effect = commit_error
    if rollback_error:
        session.rollback.side_effect = rollback_error
    return session


@handle_returns
@with_repositories
async def _dummy_use_case(*, repositories):
    """A trivial use case that always succeeds — errors come from the session."""
    return "ok"


@handle_returns
@with_repositories
async def _failing_use_case(*, repositories):
    """A use case whose body raises — commit is never attempted."""
    raise ValueError("business logic error")


class TestUseCaseBodyFailureWrappedAsFailure:
    async def test_use_case_body_error_returns_failure(self):
        session = _make_mock_session()
        set_session(session)

        result = await _failing_use_case()

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ValueError)
        assert str(result.failure()) == "business logic error"

    async def test_use_case_body_error_triggers_rollback(self):
        session = _make_mock_session()
        set_session(session)

        await _failing_use_case()

        session.rollback.assert_awaited_once()
        session.commit.assert_not_awaited()


class TestCommitFailureWrappedAsFailure:
    async def test_commit_error_returns_failure(self):
        commit_err = OperationalError("db gone", params=None, orig=Exception("connection lost"))
        session = _make_mock_session(commit_error=commit_err)
        set_session(session)

        result = await _dummy_use_case()

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), OperationalError)

    async def test_commit_error_does_not_propagate_as_exception(self):
        commit_err = OperationalError("db gone", params=None, orig=Exception("connection lost"))
        session = _make_mock_session(commit_error=commit_err)
        set_session(session)

        # Must not raise — the whole point of the decorator order fix
        result = await _dummy_use_case()
        assert not isinstance(result, Success)

    async def test_rollback_error_after_commit_failure_returns_failure(self):
        commit_err = OperationalError("commit failed", params=None, orig=Exception("disk full"))
        rollback_err = OperationalError("rollback failed", params=None, orig=Exception("connection lost"))
        session = _make_mock_session(commit_error=commit_err, rollback_error=rollback_err)
        set_session(session)

        result = await _dummy_use_case()

        assert isinstance(result, Failure)
        # The rollback error is the one that escapes with_repositories
        assert isinstance(result.failure(), OperationalError)

    async def test_successful_commit_returns_success(self):
        session = _make_mock_session()
        set_session(session)

        result = await _dummy_use_case()

        assert isinstance(result, Success)
        assert result.unwrap() == "ok"
        session.commit.assert_awaited_once()

    async def test_commit_error_triggers_rollback(self):
        commit_err = OperationalError("db gone", params=None, orig=Exception("connection lost"))
        session = _make_mock_session(commit_error=commit_err)
        set_session(session)

        await _dummy_use_case()

        session.rollback.assert_awaited_once()

    async def test_runtime_error_during_commit_also_caught(self):
        """Non-SQLAlchemy exceptions during commit are also wrapped."""
        session = _make_mock_session(commit_error=RuntimeError("unexpected commit error"))
        set_session(session)

        result = await _dummy_use_case()

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), RuntimeError)
