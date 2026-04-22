## Purpose

Defines the deterministic, layered OCI image targets for every deployable service. Each service produces reproducible image digests via `rules_oci`, with layering tuned for cache efficiency, and a top-level `//:images` target builds all three tarballs at once.

## Requirements

### Requirement: Per-service OCI targets

Each deployable service (backend, frontend, worker) SHALL expose an `oci_image` target and a matching `oci_tarball` target built by `rules_oci`.

#### Scenario: Every service has image and tarball targets

- **WHEN** Bazel queries `//backend:image`, `//frontend:image`, and `//worker:image`
- **THEN** each target SHALL exist and SHALL be a `rules_oci` `oci_image`
- **AND** each service SHALL also expose a matching `oci_tarball` target (`image.tar`)

### Requirement: Deterministic image digests

Images SHALL be deterministic: the same inputs SHALL produce the same image digest regardless of build host or build time. No timestamps SHALL leak into image metadata.

#### Scenario: Identical inputs produce identical digests

- **GIVEN** two clean builds of the same commit on different hosts
- **WHEN** both run `bazel build //backend:image`
- **THEN** the resulting image SHALL have the same digest
- **AND** no layer SHALL contain a build-time timestamp

### Requirement: Cache-efficient layering

Images SHALL be structured into layers ordered base → dependencies → application code so that code-only changes invalidate only the application layer.

#### Scenario: Code change invalidates only the application layer

- **GIVEN** a backend image built from commit A
- **WHEN** the repository changes only application source (no dependency changes)
- **THEN** the rebuilt image SHALL reuse the cached base and dependency layers
- **AND** only the application layer SHALL be rebuilt

### Requirement: Tarball outputs loadable into Docker

`oci_tarball` outputs SHALL be loadable into Docker via `docker load < bazel-bin/.../image.tar` so that docker-compose can consume them.

#### Scenario: Tarball loads and runs under Docker

- **WHEN** a developer runs `docker load < bazel-bin/backend/image.tar`
- **THEN** Docker SHALL accept the tarball and register the image
- **AND** `docker run` SHALL be able to start the service using that image

### Requirement: Image tag convention

Images SHALL be tagged using the convention `dashboard-chat/<service>:bazel` (for example, `dashboard-chat/api:bazel`).

#### Scenario: Tags follow the dashboard-chat convention

- **WHEN** any service image is built
- **THEN** the resulting tag SHALL match `dashboard-chat/<service>:bazel`
- **AND** the backend image SHALL tag as `dashboard-chat/api:bazel`

### Requirement: Top-level `//:images` target

The repository root SHALL define a `//:images` target that builds all three service tarballs.

#### Scenario: Root target builds every service image

- **WHEN** a developer runs `bazel build //:images`
- **THEN** Bazel SHALL build the backend, frontend, and worker `oci_tarball` targets

### Requirement: Backend image specification

The backend image (`dashboard-chat/api:bazel`) SHALL be built from a pinned `python:3.11-slim` base with layered system packages, pip dependencies, and application code, and SHALL run as a non-root user on port 8000.

- Base SHALL be `@python_3_11_slim` pulled via `oci_pull`.
- A system layer SHALL install `build-essential`, `libpq-dev`, and `curl` via `pkg_tar`.
- A dependency layer SHALL contain all pip packages from `uv.lock`.
- An application layer SHALL contain `app/`, `scripts/`, `migrations/`, `pyproject.toml`, and `uv.lock`.
- The image SHALL run as the non-root user `appuser` (UID 1000) and SHALL expose port 8000.

#### Scenario: Backend image runs as appuser

- **WHEN** the backend image is inspected
- **THEN** its default user SHALL be `appuser` (UID 1000)
- **AND** the exposed port SHALL be 8000

### Requirement: Frontend image specification

The frontend image (`dashboard-chat/frontend:bazel`) SHALL be built from a pinned `nginx:alpine` base with a configuration layer (custom `nginx.conf` with SPA fallback routing) and an assets layer containing the Vite `dist/` output, and SHALL expose port 80.

#### Scenario: Frontend image serves SPA on port 80

- **WHEN** the frontend image is run
- **THEN** it SHALL serve the Vite build output on port 80
- **AND** unknown routes SHALL fall back to `index.html` per the SPA-routing nginx configuration

### Requirement: Worker image specification

The worker image (`dashboard-chat/worker:bazel`) SHALL be built from a pinned `node:20-slim` base with a dependency layer containing production `node_modules` and an application layer with worker source and shared code, and SHALL expose port 8787.

#### Scenario: Worker image exposes port 8787

- **WHEN** the worker image is inspected
- **THEN** the exposed port SHALL be 8787
- **AND** the dependency and application layers SHALL be distinct

### Requirement: Base image pinning and secret hygiene

Base images SHALL be pinned by digest in `MODULE.bazel`, not by mutable tag. No secrets or `.env` files SHALL be baked into any service image.

#### Scenario: Bases pinned by digest

- **WHEN** `MODULE.bazel` declares base images
- **THEN** each `oci_pull` entry SHALL reference the base image by digest
- **AND** no service image SHALL include `.env` files or other secret material
