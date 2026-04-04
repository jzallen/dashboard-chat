---
name: docker-and-ports
description: Use when starting services, debugging connectivity, or working with Docker Compose and dev containers.
---

# Docker Compose & Services

## Dev Container (recommended)
`.devcontainer/` installs Node 20, Python 3.11, and all dependencies automatically.

## Docker Compose

```bash
make up                              # Bazel OCI images + load + compose up
make up-full                         # Full profile (PostgreSQL + hot-reload)
make up-force                        # Force-recreate all containers
make down                            # Stop all services
docker compose up                    # Manual (images must be pre-loaded)
```

Bazel-built services use `pull_policy: never` — compose fails loudly if images aren't loaded.

## Services & Ports

| Service  | Port | URL                    |
|----------|------|------------------------|
| Frontend | 5173 | http://localhost:5173   |
| Backend  | 8000 | http://localhost:8000   |
| Worker   | 8787 | http://localhost:8787   |
| MinIO    | 9000 | http://localhost:9000   |
| Redis    | 6379 | localhost:6379          |
