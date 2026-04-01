"""Backfill script to create project_memories rows for all existing projects.

Usage:
    cd backend && uv run python scripts/backfill_project_memories.py
"""

import asyncio

from sqlalchemy import select

from app.database import async_session, init_db
from app.repositories.metadata import ProjectMemoryRecord, ProjectRecord
from app.utils.compact_id import memory_channel_id


async def backfill():
    await init_db()

    async with async_session() as session:
        # Find all projects without a memory
        result = await session.execute(
            select(ProjectRecord).where(~ProjectRecord.id.in_(select(ProjectMemoryRecord.project_id)))
        )
        projects = result.scalars().all()

        if not projects:
            print("No projects need backfilling.")
            return

        print(f"Found {len(projects)} projects without memories. Backfilling...")

        for project in projects:
            channel_id = memory_channel_id(project.org_id or "", project.id)
            memory = ProjectMemoryRecord(
                project_id=project.id,
                org_id=project.org_id or "",
                stream_channel_id=channel_id,
            )
            session.add(memory)
            print(f"  Created memory for project {project.id} ({project.name})")

        await session.commit()
        print(f"Done. Backfilled {len(projects)} project memories.")


if __name__ == "__main__":
    asyncio.run(backfill())
