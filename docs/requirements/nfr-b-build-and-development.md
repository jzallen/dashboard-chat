# Build & Development Requirements

## Requirements

| ID | Requirement | Status |
|----|-------------|--------|
| NFR-B1 | All services start with `docker compose up` | **Implemented** |
| NFR-B2 | Docker images built by Bazel | **Implemented** |
| NFR-B3 | CI runs unit tests (Vitest + pytest) on every PR | **Implemented** |
| NFR-B4 | E2E tests runnable in CI with Docker Compose | **Not wired** |
| NFR-B5 | Dev/prod parity (SQLite+MinIO dev, PostgreSQL+S3 prod) | **Implemented** |

## Related

- `docs/architecture/backend-layers.md`
