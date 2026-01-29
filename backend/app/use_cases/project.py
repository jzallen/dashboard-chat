"""Project use cases."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..db_context import with_db
from ..models import Project


@with_db
async def list_projects(db: AsyncSession) -> list[Project]:
    """List all projects."""
    result = await db.execute(
        select(Project).order_by(Project.created_at.desc())
    )
    return list(result.scalars().all())


@with_db
async def get_project(
    db: AsyncSession,
    project_id: str,
) -> dict[str, Any] | None:
    """Get a single project by ID with sparse dataset references.
    
    Returns None if project not found.
    """
    query = select(Project).where(Project.id == project_id).options(
        selectinload(Project.datasets)
    )
    
    result = await db.execute(query)
    project = result.scalar_one_or_none()
    if not project:
        return None
    
    # Return sparse dataset info with links
    datasets_sparse = [
        {
            "id": ds.id,
            "name": ds.name,
            "link": f"/api/datasets/{ds.id}",
            "description": ds.description,
            "row_count": ds.row_count,
            "schema_config": ds.schema_config,
        }
        for ds in project.datasets
    ]
    
    return {
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
        "datasets": datasets_sparse,
    }


@with_db
async def create_project(
    db: AsyncSession,
    name: str,
    description: str | None = None,
) -> Project:
    """Create a new project."""
    project = Project(name=name, description=description)
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


@with_db
async def update_project(
    db: AsyncSession,
    project_id: str,
    update_dict: dict[str, Any],
) -> Project | None:
    """Update a project.
    
    Returns None if project not found.
    """
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        return None
    
    for key, value in update_dict.items():
        setattr(project, key, value)
    
    await db.commit()
    await db.refresh(project)
    return project


@with_db
async def delete_project(db: AsyncSession, project_id: str) -> bool:
    """Delete a project.
    
    Returns False if project not found.
    """
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        return False
    
    await db.delete(project)
    await db.commit()
    return True
