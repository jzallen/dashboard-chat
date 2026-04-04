---
name: project-structure
description: Use when you need to understand where code lives, find the right directory for a new file, or trace the architecture across services.
---

# Project Structure

```
frontend/src/
  lib/
    api/          # API client (fetch wrapper with auth)
    auth/         # AuthProvider, useAuth hook
    ui/
      components/ # React components (AppShell, ChatPanel, TablePanel, etc.)
      hooks/      # Query hooks, table config, filter utils
      providers/  # QueryProvider
      context/    # ChatContext (SSE streaming)
    table-tools/  # Tool call execution, filter functions
    raqb/         # Query builder integration
  test/           # Test setup and helpers

backend/
  app/
    auth/         # Auth package (providers, middleware, context)
    models/       # SQLAlchemy ORM models
    repositories/ # Data access (metadata, lake/DuckDB, outbox)
    routers/      # FastAPI route handlers
    controllers/  # HTTP controllers
    use_cases/    # Business logic by domain
    config.py     # Settings from env vars
    database.py   # Async engine, session factory
    main.py       # App setup, middleware, router mounting
  migrations/     # Alembic migrations
  tests/          # Mirrors app/ structure

worker/
  index.ts        # Hono routes (chat, sessions, health)
  lib/
    auth.ts       # Auth middleware
    sessions/     # Session management (Redis + S3)
    s3.ts         # S3 client for audit logs

shared/chat/      # Chat handler, prompts, tool definitions
```

## Request Flow

```
Router (app/routers/) → Controller (app/controllers/) → Use case (app/use_cases/) → Repository
```

## Database

- **Dev**: SQLite via aiosqlite
- **Production**: PostgreSQL via asyncpg
- **Migrations**: Alembic in `backend/migrations/versions/`
- **Storage**: Parquet files in MinIO/S3, queried via DuckDB/Ibis
```
