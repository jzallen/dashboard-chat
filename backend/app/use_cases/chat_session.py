"""Use cases for chat session management."""

from typing import TYPE_CHECKING

from app.use_cases import handle_returns
from app.repositories import with_repositories
from app.models.chat_session import ChatSession, ChatTurn

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


def _record_to_turn(record) -> ChatTurn:
    """Convert a ChatTurnRecord to a ChatTurn domain model."""
    return ChatTurn(
        id=record.id,
        session_id=record.session_id,
        sequence=record.sequence,
        user_message=record.user_message,
        system_prompt=record.system_prompt,
        tool_definitions=record.tool_definitions or [],
        assistant_content=record.assistant_content,
        tool_calls=record.tool_calls,
        tool_results=record.tool_results,
        table_schema=record.table_schema or {},
        created_at=record.created_at.isoformat() if record.created_at else "",
    )


def _record_to_session(record, include_turns: bool = True) -> ChatSession:
    """Convert a ChatSessionRecord to a ChatSession domain model."""
    turns = []
    if include_turns and record.turns:
        turns = sorted(
            [_record_to_turn(t) for t in record.turns],
            key=lambda t: t.sequence,
        )

    return ChatSession(
        id=record.id,
        dataset_id=record.dataset_id,
        turns=turns,
        created_at=record.created_at.isoformat() if record.created_at else "",
        updated_at=record.updated_at.isoformat() if record.updated_at else "",
    )


@with_repositories
@handle_returns
async def create_session(
    dataset_id: str | None = None,
    *,
    repositories: 'RepositoryContainer',
) -> dict:
    """Create a new chat session."""
    repo = repositories['metadata_repository']
    record = await repo.create_chat_session(dataset_id=dataset_id)
    session = _record_to_session(record, include_turns=False)
    return _serialize_session(session)


@with_repositories
@handle_returns
async def get_session(
    session_id: str,
    *,
    repositories: 'RepositoryContainer',
) -> dict:
    """Get a chat session with all its turns."""
    repo = repositories['metadata_repository']
    record = await repo.get_chat_session(session_id)
    if record is None:
        raise ValueError(f"Session {session_id} not found")
    session = _record_to_session(record)
    return _serialize_session(session)


@with_repositories
@handle_returns
async def list_sessions(
    dataset_id: str,
    *,
    repositories: 'RepositoryContainer',
) -> list[dict]:
    """List all chat sessions for a dataset."""
    repo = repositories['metadata_repository']
    records = await repo.list_chat_sessions(dataset_id)
    return [_serialize_session(_record_to_session(r, include_turns=True)) for r in records]


@with_repositories
@handle_returns
async def log_turn(
    session_id: str,
    turn_data: dict,
    *,
    repositories: 'RepositoryContainer',
) -> dict:
    """Append a turn to a chat session."""
    repo = repositories['metadata_repository']
    record = await repo.append_chat_turn(session_id, turn_data)
    turn = _record_to_turn(record)
    return _serialize_turn(turn)


def _serialize_session(session: ChatSession) -> dict:
    """Serialize a ChatSession to a JSON-compatible dict."""
    return {
        'id': session.id,
        'dataset_id': session.dataset_id,
        'turns': [_serialize_turn(t) for t in session.turns],
        'created_at': session.created_at,
        'updated_at': session.updated_at,
    }


def _serialize_turn(turn: ChatTurn) -> dict:
    """Serialize a ChatTurn to a JSON-compatible dict."""
    return {
        'id': turn.id,
        'session_id': turn.session_id,
        'sequence': turn.sequence,
        'user_message': turn.user_message,
        'system_prompt': turn.system_prompt,
        'tool_definitions': turn.tool_definitions,
        'assistant_content': turn.assistant_content,
        'tool_calls': turn.tool_calls,
        'tool_results': turn.tool_results,
        'table_schema': turn.table_schema,
        'created_at': turn.created_at,
    }
