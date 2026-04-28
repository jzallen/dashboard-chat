# User Stories — dc-1k8: App servers log image identity on startup

> **Feature ID**: dc-1k8
> **Wave**: DISCUSS (Phase 3 only — see `wave-decisions.md`)
> **Persona**: developer iterating locally with Bazel + docker compose
> **JTBD reference**: skipped (D4=No); single obvious job

---

## Story 1 — Server processes log image identity on startup

**Narrative**: As a developer running `docker compose up` after a `bazel run //...:image_load`, I want each of the three server-process containers (`dashboard-api`, `dashboard-auth-proxy`, `dashboard-agent`) to log a single, structured line announcing the image identity (git SHA at build, build timestamp, dirty marker) within the first lines of stdout, so I can confirm at a glance whether my latest build is what's actually running.

### Elevator Pitch
Before: After `bazel run //backend:image_load && docker compose up -d api`, I cannot tell from `docker compose logs api` whether the new image booted or the previous one — I have to `docker inspect dashboard-api --format '{{.Image}}'` and reason about digests by hand.
After: run `docker compose logs --since 1m api | head -20` → sees `dashboard-api image=dashboard-chat/api:bazel sha=7ec9fa5+dirty built=2026-04-26T19:40:12Z`
Decision enabled: developer decides whether to rebuild (stale SHA) or proceed (current SHA matches `git rev-parse HEAD`).

### Acceptance Criteria

**AC1.1 — Identity line is emitted on startup, end-to-end**
> **Given** a freshly built image of `dashboard-api` (or `dashboard-auth-proxy`, or `dashboard-agent`) produced by `bazel run //...:image_load`
> **When** the container is started via `docker compose up -d <service>`
> **Then** within the first 50 lines of `docker compose logs <service>` exactly one line matches the regex
> `^[A-Za-z0-9_-]+ image=\S+ sha=[0-9a-f]{7,40}(?:\+dirty)? built=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`
> **And** the captured `sha` value equals the `STABLE_GIT_COMMIT` recorded by Bazel's workspace-status command at the time the image was built.

**AC1.2 — Identity is built-in, not start-in**
> **Given** an image built from commit `X` at timestamp `T`
> **When** the same image is started, stopped, and restarted three times across different days
> **Then** every startup logs `sha=X built=T` (the values are fixed at build time, not derived at container-start time).

**AC1.3 — Dirty working tree is flagged**
> **Given** the bazel build was invoked with uncommitted changes in the worktree (`git status --porcelain` non-empty)
> **When** a container of that image starts
> **Then** the logged identity contains the literal `+dirty` immediately after the SHA (e.g. `sha=7ec9fa5+dirty`).

**AC1.4 — Stale-vs-fresh diagnosis end-to-end**
> **Given** a developer has just run `bazel run //backend:image_load` for the current `HEAD`
> **When** they run `docker compose up -d api && docker compose logs --since 1m api | grep '^dashboard-api '`
> **Then** the `sha=` value in the matching line equals `git rev-parse --short=7 HEAD`
> **And** if instead they `docker compose up -d` an out-of-date image without rebuilding, the `sha=` value differs from `git rev-parse --short=7 HEAD` (so the developer can see the divergence).

**AC1.5 — Graceful degradation on uninstrumented images**
> **Given** an old or third-party image where the build-stamp env vars (`BUILD_GIT_SHA`, `BUILD_TIMESTAMP`) are unset
> **When** the container starts
> **Then** the service still starts successfully (no crash, no traceback)
> **And** the logged line reads `sha=unknown built=unknown` rather than being absent or partial.

---

## Story 2 — Frontend container exposes image identity (no native startup log)

**Narrative**: As a developer running `docker compose up` for the frontend (`dashboard-frontend`, an nginx-served static SPA), I want to see the image identity for that service too — not via SPA application code (which I cannot trust to have run before I check), but via a single line in container stdout AND a machine-readable HTTP endpoint, so I can confirm the served bundle matches the bazel build I just produced.

### Elevator Pitch
Before: `docker compose logs frontend` only shows nginx request logs. I cannot tell which build of the SPA is being served without `docker inspect` or hashing the bundle.
After: run `docker compose logs frontend | head` → sees one line `dashboard-frontend image=dashboard-chat/frontend:bazel sha=7ec9fa5 built=2026-04-26T19:40:12Z`; AND `curl -s localhost:5173/_meta` returns the same identity as JSON.
Decision enabled: developer decides whether the SPA bundle being served matches the commit they think they built.

### Acceptance Criteria

**AC2.1 — Identity line on container stdout**
> **Given** a freshly built `dashboard-chat/frontend:bazel` image
> **When** `docker compose up -d frontend`
> **Then** within the first 50 lines of `docker compose logs frontend` exactly one line matches the same regex as AC1.1, prefixed with the service name `dashboard-frontend`.

**AC2.2 — Identity available over HTTP**
> **Given** `dashboard-frontend` is running and serving the SPA on its mapped port
> **When** the developer issues `GET /_meta` (or equivalent agreed path)
> **Then** the response is `200 OK` with JSON of shape `{"image":"<tag>","sha":"<git-sha>","dirty":<bool>,"built":"<rfc3339>"}`
> **And** the `sha` field equals the SHA exposed in the stdout line from AC2.1.

**AC2.3 — Same build invariants as Story 1**
AC1.2 (built-in not start-in), AC1.3 (`+dirty` marker), and AC1.5 (graceful degradation) apply identically to the frontend container.

---

## Story 3 — Cross-service consistency

**Narrative**: As a developer comparing services, I want all four bazel-built services to use the **same** identity format and the **same** field names, so I can `grep '^dashboard-' | head` across the compose log and read all four identities at once without translating formats.

### Acceptance Criteria

**AC3.1 — Single shared format**
> **Given** all four services started from images produced by the same `bazel run //...:image_load` invocation
> **When** the developer runs `docker compose logs --since 1m | grep -E 'image=.+ sha=.+ built='`
> **Then** exactly four lines match — one per service — each conforming to the AC1.1 regex
> **And** the `sha=` and `built=` values are identical across all four lines (because they came from the same build).

**AC3.2 — Service name is unambiguous**
> Each line begins with the service identifier matching the docker-compose service name (`dashboard-api`, `dashboard-frontend`, `dashboard-auth-proxy`, `dashboard-agent`) so a developer can `awk '{print $1}'` to enumerate which services emitted identity.

---

## Outcome KPIs (summary — see `outcome-kpis.md` for measurement methods)

- **K1**: Time-to-confirm-rebuild drops from `≥30s` (current: `docker inspect` + digest reasoning) to `<5s` (target: glance at `docker compose logs | head`).
- **K2**: 100% of bazel-built services in `docker-compose.yml` emit a conforming identity line. Measured by automated check in CI.
- **K3**: Zero startup regressions caused by instrumentation. Measured by existing smoke / health checks remaining green after the change.

## Requirements Completeness

- Stories cover all four bazel-built services in `docker-compose.yml`.
- Both happy path (fresh build) and degraded path (uninstrumented image) covered.
- Frontend asymmetry (static SPA, nginx) explicitly addressed by Story 2.
- Cross-service consistency covered by Story 3.
- All AC are testable with `docker compose logs` / `curl` — no internal-state inspection required.
- Self-assessed completeness: > 0.95.

## DoR (inline — full validation deferred for this lean DISCUSS)

| # | Item | Status | Note |
|---|------|--------|------|
| 1 | User value clear | ✓ | Stated in elevator pitch |
| 2 | Acceptance criteria testable | ✓ | All AC reduce to `docker compose logs` matches or HTTP request |
| 3 | Dependencies identified | ✓ | Bazel `--stamp` + `oci_image.env` (DESIGN-wave decision) |
| 4 | Sized | ✓ | One slice, ≤1 day |
| 5 | Discoverable to all 4 services | ✓ | All located in `docker-compose.yml`, all bazel-built |
| 6 | Out-of-scope explicit | ✓ | See "Out of scope" below |
| 7 | KPIs measurable | ✓ | See `outcome-kpis.md` |
| 8 | No hidden coupling | ✓ | Each service's startup path is independent |
| 9 | Reviewable | ✓ | Single PR, four entrypoint diffs + one Bazel diff |

## Out of Scope

- Identity for non-bazel-built services in compose (`db`, `query-engine`, `minio`, `mirth`) — those use upstream images and we don't control their build.
- Identity for `api-full` (the build-from-source variant in compose) — covered transitively if it builds from the same Bazel target; otherwise out of scope.
- Identity in production / cloud deployment (beyond docker compose) — different observability surface; revisit when prod telemetry is in scope.
- Surfacing identity to end-users (e.g. UI footer) — this feature is dev-facing only.
