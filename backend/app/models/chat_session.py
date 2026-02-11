"""Chat session and turn domain models - authoritative business objects."""

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class ChatTurn:
    """A single turn in a chat session."""

    id: str
    session_id: str
    sequence: int
    user_message: str
    system_prompt: str
    tool_definitions: list[dict]
    assistant_content: str | None
    tool_calls: list[dict] | None
    tool_results: list[dict] | None
    table_schema: dict
    created_at: str


@dataclass(frozen=True, slots=True)
class ChatSession:
    """A chat session containing multiple turns."""

    id: str
    dataset_id: str | None
    turns: list[ChatTurn] = field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""
