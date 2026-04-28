# DISCUSS Decisions — dc-1k8

## Key Decisions

- **[D1] Feature type = Cross-cutting.** Touches four service entrypoints (`backend/app/main.py`, `auth-proxy/index.ts`, `agent/index.ts`, frontend container) plus the Bazel build (workspace status + image env injection). Not user-facing; not pure infra.
- **[D2] Walking skeleton = No.** Brownfield, isolated change. Each service already has a startup path; we're adding one log line + one build-time env var. No skeleton needed.
- **[D3] UX research depth = Lightweight.** Sole user is a developer at the terminal. No personas, no journey mapping, no emotional arc. Mental model is "one glance at logs tells me which build is running."
- **[D4] JTBD = No.** Single, obvious job ("verify a fresh image is what's running"). Adding JTBD ceremony is theatre.
- **[D5] Lean DISCUSS — Phase 3 (Requirements) only.** Skipping Phase 1 (JTBD), Phase 2 (Journey), Phase 2.5 (Story map / elephant carpaccio slicing). The feature is one slice end-to-end (≤1 day). Carpaccio's value is in surfacing learning hypotheses for risky multi-week work; this is a deterministic instrumentation change.
- **[D6] Migration gate (skill-prescribed) — bypassed with rationale.** The `nw-discuss` skill instructs to STOP when `docs/product/` is absent and `docs/feature/` already has features. This project predates SSOT-model adoption (`dc-6gg`, `dc-e65d` are pre-existing feature dirs from before the model was introduced). Migrating the entire project's SSOT to ship a startup log line is disproportionate. Flagged for the user; not blocking this feature.
- **[D7] Frontend asymmetry acknowledged.** The frontend is a static SPA; it has no "startup log" in the sense the three server processes do. Its identity surface is its serving container's stdout (nginx access log + a one-shot startup line emitted by the entrypoint shim) plus an HTTP-readable identity (e.g. a `/_meta` endpoint or `<meta name="build-id">` tag). Stories cover both shapes.

## Requirements Summary

- Primary user need: at-a-glance confirmation that `docker compose up` is running a freshly-rebuilt bazel image (vs. a stale one) without inspecting digests by hand.
- Walking skeleton scope: N/A (not greenfield).
- Feature type: cross-cutting (build system + four service entrypoints).

## Constraints Established

- Must not regress container startup. If build-stamp env vars are absent (e.g. legacy image), the service still boots and logs `sha=unknown built=unknown` rather than crashing.
- Must reflect the **build** identity, not the **container-start** time. Same image → same SHA / timestamp across every restart.
- Must surface a `+dirty` marker when the bazel build was produced from a working tree with uncommitted changes — otherwise dirty-build confusion is a real failure mode of the feature.
- Frontend identity must be observable without `docker exec` — either in container stdout or via HTTP — because `bazel`-served frontend containers commonly run nginx with no useful application log.

## Upstream Changes

- None. No DISCOVER artifacts exist for this feature; nothing to back-propagate.

## Routing Forward (brownfield wave matrix)

This feature has known scope and a small but real architectural choice (where image identity lives: env, file, or labels-only), so DESIGN is the next stop, not DISTILL:

1. **DESIGN** (`/nw-design`) — pick the injection mechanism (Bazel `--stamp` + `oci_image.env` is the leading candidate) and produce a one-page ADR. Likely 30–60 minutes of work.
2. **DISTILL** (`/nw-distill`) — write the Given/When/Then acceptance test as an executable spec. Acceptance test asserts on `docker compose logs` output for each of the four services; runs in CI.
3. **DELIVER** (`/nw-deliver`) — Outside-In TDD implementation. Inner loops: workspace_status emitter, Bazel image env wiring, per-service startup logger, frontend `/_meta` endpoint or container shim.
4. **FINALIZE** (`/nw-finalize`) — migrate `docs/feature/log-image-identity-on-startup/` → `docs/evolution/`.
