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


async def setup_database(settings) -> None:
    """Create SQLite tables and seed default project."""
    if not settings.database_url.startswith("sqlite"):
        print(f"  Skipped (not SQLite)")
        return

    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from app.database import DEFAULT_PROJECT_ID, Base
    from app.repositories.metadata import PipelineRunRecord  # noqa: F401 — required for mapper config
    from app.repositories.metadata import ProjectRecord

    engine = create_async_engine(settings.database_url)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("  Tables created")

    session_factory = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_factory() as session:
        result = await session.execute(
            select(ProjectRecord).where(ProjectRecord.id == DEFAULT_PROJECT_ID)
        )
        if not result.scalar_one_or_none():
            session.add(
                ProjectRecord(
                    id=DEFAULT_PROJECT_ID,
                    name="Default Project",
                    description="Auto-created default project",
                )
            )
            await session.commit()
            print("  Seeded default project")
        else:
            print("  Default project already exists")

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

    print("MinIO setup...")
    setup_minio(settings)

    print("Database setup...")
    asyncio.run(setup_database(settings))

    print("Done.")


if __name__ == "__main__":
    main()
