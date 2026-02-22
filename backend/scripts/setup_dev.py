"""Development setup script — creates local infrastructure.

Creates the MinIO datalake bucket and seeds the SQLite database.
Skips automatically for remote environments (S3, PostgreSQL).

Usage:
    python scripts/setup_dev.py              # run full setup
    python scripts/setup_dev.py --skip-seed  # skip everything (remote envs)
"""

import argparse
import asyncio
import sys
from pathlib import Path

# Allow imports from the backend package
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings


def setup_minio(settings) -> None:
    """Create the datalake bucket in MinIO if it doesn't exist."""
    if settings.storage_type != "minio":
        print(f"  Skipped (storage_type={settings.storage_type})")
        return

    import boto3
    from botocore.config import Config

    client = boto3.client(
        "s3",
        endpoint_url=f"http://{settings.minio_endpoint}",
        aws_access_key_id=settings.minio_access_key,
        aws_secret_access_key=settings.minio_secret_key,
        config=Config(
            signature_version="s3v4",
            retries={"max_attempts": settings.s3_max_retries, "mode": "standard"},
            connect_timeout=settings.s3_connect_timeout,
            read_timeout=settings.s3_read_timeout,
        ),
    )

    bucket = settings.storage_bucket
    try:
        client.head_bucket(Bucket=bucket)
        print(f"  Bucket '{bucket}' already exists")
    except Exception:
        try:
            client.create_bucket(Bucket=bucket)
            print(f"  Created bucket '{bucket}'")
        except Exception as e:
            print(f"  Failed to create bucket '{bucket}': {e}")

    # Create logs bucket for chat session JSONL files
    logs_bucket = "dashboard-chat.logs"
    try:
        client.head_bucket(Bucket=logs_bucket)
        print(f"  Bucket '{logs_bucket}' already exists")
    except Exception:
        try:
            client.create_bucket(Bucket=logs_bucket)
            print(f"  Created bucket '{logs_bucket}'")
        except Exception as e:
            print(f"  Failed to create bucket '{logs_bucket}': {e}")


async def setup_database(settings) -> None:
    """Create SQLite tables and seed default project."""
    if not settings.database_url.startswith("sqlite"):
        print(f"  Skipped (not SQLite)")
        return

    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from app.database import Base
    from app.repositories.metadata import ProjectRecord
    from app.repositories.metadata import OrganizationRecord

    # Seed projects keyed by auth mode
    SEED_PROJECTS = [
        # Dev mode — matches dev auth provider user/org
        {
            "id": "default-project-001",
            "name": "Default Project",
            "description": "Auto-created default project",
            "org_id": "dev-org-001",
            "created_by": "dev-user-001",
        },
    ]

    engine = create_async_engine(settings.database_url)

    # Register uuidv7() for SQLite server_default compatibility
    from sqlalchemy import event
    from uuid_utils import uuid7

    @event.listens_for(engine.sync_engine, "connect")
    def _register_sqlite_uuidv7(dbapi_connection, connection_record):
        dbapi_connection.create_function("uuidv7", 0, lambda: str(uuid7()))

    async with engine.begin() as conn:
        # Drop and recreate all tables to pick up schema changes (dev only)
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    print("  Tables created")

    session_factory = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    # Seed organizations
    SEED_ORGS = [
        {"id": "dev-org-001", "name": "Development Org"},
    ]

    async with session_factory() as session:
        for org in SEED_ORGS:
            result = await session.execute(
                select(OrganizationRecord).where(OrganizationRecord.id == org["id"])
            )
            if not result.scalar_one_or_none():
                session.add(OrganizationRecord(**org))
                print(f"  Seeded organization '{org['id']}' (name={org['name']})")
            else:
                print(f"  Organization '{org['id']}' already exists")

        for proj in SEED_PROJECTS:
            result = await session.execute(
                select(ProjectRecord).where(ProjectRecord.id == proj["id"])
            )
            if not result.scalar_one_or_none():
                session.add(ProjectRecord(**proj))
                print(f"  Seeded project '{proj['id']}' (org={proj['org_id']})")
            else:
                print(f"  Project '{proj['id']}' already exists")
        await session.commit()

    await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description="Setup local dev environment")
    parser.add_argument(
        "--skip-seed",
        action="store_true",
        help="Skip all setup (for remote S3/PostgreSQL environments)",
    )
    args = parser.parse_args()

    if args.skip_seed:
        print("Skipping setup (--skip-seed)")
        return

    settings = get_settings()

    if "sqlite" not in settings.database_url:
        print(f"ERROR: setup_dev.py is only for local SQLite databases.")
        print(f"  DATABASE_URL={settings.database_url}")
        print("  Refusing to run against a non-SQLite database to prevent accidental data loss.")
        sys.exit(1)

    print("MinIO setup...")
    setup_minio(settings)

    print("Database setup...")
    asyncio.run(setup_database(settings))

    print("Done.")


if __name__ == "__main__":
    main()
