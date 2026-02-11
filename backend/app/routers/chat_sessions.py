"""API routes for chat session management."""

from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from returns.result import Success, Failure

from app.database import get_db
from app.repositories import set_session
from app.use_cases.chat_session import create_session, get_session, list_sessions, log_turn

router = APIRouter(tags=["sessions"])


async def use_db_context(db: AsyncSession = Depends(get_db)) -> AsyncSession:
    """Dependency that sets the db session in context for use cases."""
    set_session(db)
    return db


class CreateSessionBody(BaseModel):
    dataset_id: str | None = None


class LogTurnBody(BaseModel):
    user_message: str
    system_prompt: str
    tool_definitions: list[dict[str, Any]]
    assistant_content: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    tool_results: list[dict[str, Any]] | None = None
    table_schema: dict[str, Any]


@router.post("/api/sessions")
async def create(data: CreateSessionBody, _: AsyncSession = Depends(use_db_context)):
    """Create a new chat session."""
    result = await create_session(dataset_id=data.dataset_id)
    match result:
        case Success(value):
            return JSONResponse(content={"data": value}, status_code=201)
        case Failure(error):
            return JSONResponse(content={"error": error}, status_code=400)


@router.get("/api/sessions/{session_id}")
async def get(session_id: str, _: AsyncSession = Depends(use_db_context)):
    """Get a chat session with all turns."""
    result = await get_session(session_id)
    match result:
        case Success(value):
            return JSONResponse(content={"data": value}, status_code=200)
        case Failure(error):
            return JSONResponse(content={"error": error}, status_code=400)


@router.get("/api/datasets/{dataset_id}/sessions")
async def list_by_dataset(dataset_id: str, _: AsyncSession = Depends(use_db_context)):
    """List all chat sessions for a dataset."""
    result = await list_sessions(dataset_id)
    match result:
        case Success(value):
            return JSONResponse(content={"data": value}, status_code=200)
        case Failure(error):
            return JSONResponse(content={"error": error}, status_code=400)


@router.post("/api/sessions/{session_id}/turns")
async def append_turn(session_id: str, data: LogTurnBody, _: AsyncSession = Depends(use_db_context)):
    """Append a turn to a chat session."""
    turn_data = data.model_dump()
    result = await log_turn(session_id, turn_data)
    match result:
        case Success(value):
            return JSONResponse(content={"data": value}, status_code=201)
        case Failure(error):
            return JSONResponse(content={"error": error}, status_code=400)
