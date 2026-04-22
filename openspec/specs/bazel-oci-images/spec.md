## Purpose

Defines the deterministic, layered OCI image targets for every deployable service. Each service produces reproducible image digests via `rules_oci`, with layering tuned for cache efficiency, and a top-level `//:images` target builds all three tarballs at once.

## Capability: bazel-oci-images

Deterministic OCI image targets for all three services, built by rules_oci with optimized layering.

### Behavior

- Each service produces an `oci_image` and `oci_tarball` target
- Images are deterministic: same inputs → same image digest, regardless of build host or time
- Layers are structured for cache efficiency (base → deps → app code)
- `oci_tarball` outputs can be loaded into Docker via `docker load < bazel-bin/.../image.tar`
- Image tags follow convention: `dashboard-chat/<service>:bazel` (e.g., `dashboard-chat/api:bazel`)
- A top-level target `//:images` builds all three tarballs

### Image Specifications

**Backend (dashboard-chat/api:bazel)**:
- Base: `@python_3_11_slim` (pulled via `oci_pull`)
- System layer: build-essential, libpq-dev, curl via `pkg_tar`
- Deps layer: all pip packages from uv.lock
- App layer: `app/`, `scripts/`, `migrations/`, `pyproject.toml`, `uv.lock`
- User: non-root (appuser, UID 1000)
- Port: 8000

**Frontend (dashboard-chat/frontend:bazel)**:
- Base: `@nginx_alpine` (pulled via `oci_pull`)
- Config layer: custom nginx.conf with SPA fallback routing
- Assets layer: Vite build output (dist/)
- Port: 80

**Worker (dashboard-chat/worker:bazel)**:
- Base: `@node_20_slim` (pulled via `oci_pull`)
- Deps layer: production node_modules
- App layer: worker source + shared code
- Port: 8787

### Constraints

- No timestamps in image metadata (reproducibility)
- Base images pinned by digest in MODULE.bazel, not by mutable tag
- Images must be loadable into Docker for docker-compose consumption
- No secrets or .env files baked into images
