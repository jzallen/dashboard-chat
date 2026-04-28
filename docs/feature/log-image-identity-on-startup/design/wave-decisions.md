# DESIGN Decisions — dc-1k8

## Key Decisions

- **[D1] Design scope = Application** (not System or Domain). Touches build instrumentation + four service entrypoints; no new system topology, no new bounded context.
- **[D2] Interaction mode = Propose.** Architect (this doc) presents three options with trade-offs; user picks.
- **[D3] Chosen option: B — stamp-templated `version.json` layer + per-service startup logger + frontend entrypoint shim.** See `design.md` §5 for full rationale.
- **[D4] Skip C4 diagrams.** No new architectural component; cross-cutting build instrumentation. Per user direction.
- **[D5] Skip domain modeling.** No domain change. Per user direction.
- **[D6] Skip SSOT `docs/product/architecture/brief.md` bootstrap.** Project predates SSOT-model adoption (same rationale as DISCUSS migration-gate bypass, see `discuss/wave-decisions.md` D6). Bootstrapping SSOT to ship a startup log line is disproportionate.
- **[D7] Use `STABLE_*` workspace-status keys only** (not volatile `BUILD_*`). Keeps Bazel cache warm — only the small `version_layer` rebuilds per commit.
- **[D8] Identity format locked in `design.md` §7** (stdout: `<service> image=<tag> sha=<sha7>[+dirty] built=<rfc3339>`; JSON: full 40-char SHA). Subject to revision via the open question in `design.md` §9.

## Architecture Summary

- **Pattern**: cross-cutting build-time instrumentation (no architectural pattern change)
- **Paradigm**: matches existing project — Python (OOP) for backend; TypeScript (multi-paradigm) for frontend / agent / auth-proxy. No new paradigm needed.
- **Key components added**:
  - `tools/workspace_status.sh` (NEW) — Bazel workspace status emitter
  - `tools/version_layer.bzl` (NEW) — Bazel macro reused by all four services
  - `frontend/docker-entrypoint.sh` (NEW) — nginx wrapper that prints identity + serves `_meta.json`
- **Key components extended**:
  - 4× `oci_image` rules (one tar layer added per rule)
  - 3× service entrypoints (FastAPI lifespan, two Hono `index.ts`)

## Reuse Analysis

(Repeated from `design.md` §3 for handoff-friendliness.)

| Existing Component | File | Overlap | Decision | Justification |
|---|---|---|---|---|
| `oci_image` rules | `backend/BUILD.bazel:385`, `auth-proxy/BUILD.bazel:52`, `agent/BUILD.bazel:67`, `frontend/BUILD.bazel:331` | All four image rules need a new tar layer | EXTEND | Adding `version_layer` to `tars` is 2 lines per rule |
| `aspect_bazel_lib` (in `MODULE.bazel`) | `MODULE.bazel` | Provides `expand_template` with `stamp_substitutions` | EXTEND | Already a dep; use as-is |
| `rules_oci 2.2.7` (in `MODULE.bazel`) | `MODULE.bazel` | `oci_image.tars` accepts generated tars | EXTEND | Already a dep |
| Backend FastAPI startup | `backend/app/main.py` | App boot path is the natural identity-log site | EXTEND | ~10 LOC |
| auth-proxy / agent entrypoints | `auth-proxy/index.ts`, `agent/index.ts` | Top-level boot file | EXTEND | ~8 LOC each |
| Frontend container entrypoint | `frontend/BUILD.bazel:331` (nginx_alpine, no shim) | No existing app-level startup hook | CREATE NEW (~12 LOC shell) | Required because nginx itself does no app boot — gap, not overlap |
| `tools/workspace_status.sh` | (does not exist) | No current workspace status command | CREATE NEW (~10 LOC shell) | Required by `--workspace_status_command`; one-time |

**Zero unjustified `CREATE NEW` decisions.**

## Technology Stack

- **Bazel** (existing): `aspect_bazel_lib 2.22.5`, `rules_oci 2.2.7` — no new deps
- **Backend** (existing): Python 3.11 + FastAPI — no new deps
- **Auth-proxy / Agent** (existing): Node + Hono — no new deps
- **Frontend** (existing): nginx_alpine — no new deps; one new shell shim

No new languages, frameworks, or libraries are introduced.

## Constraints Established

- All identity values must be sourced from a single `expand_template` invocation per service to guarantee the AC3.1 cross-service consistency property structurally rather than by convention.
- `STABLE_*` keys only — volatile keys would invalidate dependent build actions and undermine K3 (zero startup regressions).
- Graceful degradation contract: missing/unparseable `version.json` → log `unknown` literals, do not crash. AC1.5 hard-coded into the loader.

## Upstream Changes

- **AC1.1 regex update propagated to DISCUSS.** The regex as drafted (`sha=[0-9a-f]{7,40}`) does not admit the literal `unknown` graceful-degradation token. The DISTILL acceptance test will use the loosened regex `sha=(?:[0-9a-f]{7,40}|unknown)(?:\+dirty)?`. This is recorded as `upstream-changes.md` in this directory.

## Open Questions (for user)

See `design.md` §9. Defaults will be applied at DISTILL/DELIVER if no answer is given:

1. Identity log format — default: as locked in §7
2. Frontend HTTP path — default: `/_meta.json`
3. Populate OCI labels in same PR — default: yes (additive)
4. `api-full` compose variant — default: out of scope

## Routing Forward

1. **DISTILL** (`/nw-distill`) — write the BDD acceptance test as an executable spec. The test runs `bazel run //...:image_load`, `docker compose up -d <service>` per service, then asserts on `docker compose logs` and (for frontend) on `curl localhost:5173/_meta.json`.
2. **DELIVER** (`/nw-deliver`) — Outside-In TDD implementation. Inner loops:
   - workspace_status emitter
   - `version_layer` macro
   - per-`oci_image` wiring
   - per-service startup loggers
   - frontend entrypoint shim
3. **FINALIZE** (`/nw-finalize`).
