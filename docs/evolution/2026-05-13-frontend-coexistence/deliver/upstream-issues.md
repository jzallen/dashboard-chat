# DELIVER Upstream Issues — `frontend-coexistence` Phase 01

> **Wave**: DELIVER · Phase 01 (MR-0)
> **Date**: 2026-05-13
> **Purpose**: Surface any DELIVER-wave findings that need DESIGN-level or DISTILL-level resolution. Per CLAUDE.md and the nw-deliver skill: "DO NOT silently modify DESIGN artifacts."

## TL;DR

**No upstream issues at Phase 01 entry.** DESIGN, DISTILL, and the Praxis review covered every Phase 01 invariant. The DI-U-3 (DOM-fingerprint), DI-U-4 (ESLint rule), DI-U-5 (refs pinning), DI-U-6 (MIGRATED_ROUTE_PATH), and DI-U-7 (RAM baseline) deferrals are accepted at entry; DD-1 in `wave-decisions.md` resolves DI-U-3 inside Phase 01 scope; the others are Phase 02/03/04 concerns.

This file will be amended if Phase 01 execution surfaces any new finding.

---

## DD-U-1: `pnpm-workspace.yaml` / `pnpm-lock.yaml` workspace list out of sync with `package.json` workspaces (pre-existing)

**Issue**: `pnpm-workspace.yaml` lists `["reverse-proxy", "agent", "auth-proxy", "shared/chat"]`. The repo's actual workspace at the frontend source-tree position is `frontend/` (per ADR-033's source-tree-rename reversion and the root `package.json` `workspaces` field `["frontend", "agent", "auth-proxy", "shared/chat"]`). `pnpm-lock.yaml`'s `importers` block reflects the stale `reverse-proxy` name in the same way.

**Impact**:
- `bazel build //frontend:ssr_image_tar` and the pre-existing `:image_tar` BOTH fail at the `npm_link_all_packages()` call in `frontend/BUILD.bazel:8` — the Bazel rule consumes `pnpm-lock.yaml`'s importer keys.
- The refinery's `--auto` gate content-routes to `--backend` (ruff + pytest) and does NOT run Bazel, so MR-0 can merge.
- Production image rebuilds (which are presumably done via Bazel in CI/CD outside the refinery path) will be affected.

**Status**: PRE-EXISTING tech debt from ADR-033's source-tree rename reversion. NOT introduced by frontend-coexistence MR-0; surfaced during DELIVER step 01-04 / 01-05 attempts to `bazel build //frontend:ssr_image_tar`.

**Resolution path**:
- Update `pnpm-workspace.yaml` to list `frontend` (and `ui-state`, etc. if also stale).
- Regenerate `pnpm-lock.yaml` via `pnpm install` (or equivalent — the project may have a Bazel-specific lockfile-regen path).
- Verify `bazel build //frontend:image_tar` (existing) succeeds.

**Recommended owner**: a follow-up cleanup MR scoped to "workspace-tooling sync". Out of scope for frontend-coexistence MR-0.

**Verification of pre-existence**: A crafter at step 01-04 stashed the step's diff and re-ran `bazel query //frontend:image_tar` against the pristine commit `6841aac` — same failure, confirming pre-existence.

## DD-U-2: `frontend/app/routes.ts` paths needed leading-segment correction (reconciled at 01-05)

**Issue**: Step 01-03 emitted `routes.ts` with paths like `"app/routes/login.tsx"`. RRv7 framework mode resolves these relative to `appDirectory` (defaults to `frontend/app/`), producing `frontend/app/app/routes/...` → ENOENT at `vite build` / `react-router build`.

**Fix applied at 01-05**: paths in `routes.ts` switched to `"routes/login.tsx"` form (leading `app/` segment dropped). A clarifying comment in the file documents the resolution convention. `npx vite build` exits 0 and `npx react-router build` produces both `frontend/build/client/` and `frontend/build/server/`.

**Status**: RESOLVED in step 01-05. Documented here for traceability — this was a file outside step 01-05's declared `files_to_modify` that needed reconciliation to satisfy the build-succeeds quality gate.

## DD-U-3: `docker-compose.yml` `ui-state` was profile-gated; promoted to default profile (reconciled at 01-05)

**Issue**: Pre-MR-0, `ui-state` was declared in compose with `profiles: ["ui-state", "full"]`, so `docker compose config --services` (no profile flag) did not list it. The DISTILL acceptance scenarios in `test_compose_topology_gains_one_service.py` assert `ui-state` is part of the post-MR-0 baseline topology (alongside `reverse-proxy`, `auth-proxy`, `agent`, `api`, `redis`, and the new `web-ssr`). This DISTILL-encoded invariant reflects the operational reality post-ADR-030 §SD1 (`ui-state` is reachable via auth-proxy's `/ui-state/*` multi-upstream rule — i.e., it's a baseline service, not opt-in).

**Fix applied at 01-05**: removed the `profiles: ["ui-state", "full"]` line from the `ui-state` service block in `docker-compose.yml`. The service is now default-profile, matching the DISTILL invariant and ADR-030 §SD1. A clarifying comment was added documenting the promotion.

**Pre-existence**: the `profiles: ["ui-state", "full"]` line predates MR-0 (introduced during ADR-030/ADR-032 cleanup; visible at pristine commit `6841aac`). The DISTILL author appears to have assumed `ui-state` was already default-profile when encoding the topology invariant.

**Status**: RESOLVED in step 01-05. Documented here for traceability — this is the second file outside step 01-05's declared `files_to_modify` (alongside `routes.ts` per DD-U-2) that needed reconciliation to satisfy quality gates. Minimal, non-destructive change — does NOT remove the service or change its behavior in any "full" or "ui-state" profile invocation; it only widens default-profile inclusion.

## DD-U-4: `tests/acceptance/frontend-coexistence/conftest.py` `REPO_ROOT` resolution off-by-one (reconciled at 01-05)

**Issue**: `REPO_ROOT = Path(__file__).resolve().parents[2]` — `__file__` lives at `tests/acceptance/frontend-coexistence/conftest.py`, so `parents[2]` is `tests/` (NOT the repo root). The `requires_repo_post_mr0_state` fixture used this to check for the sentinel `frontend/app/root.tsx`, which it resolved as `tests/frontend/app/root.tsx` — always missing. Result: every scenario gated on `requires_repo_post_mr0_state` skipped spuriously with "pre-MR-0 state" even when the production files were correctly landed.

**Fix applied at 01-05**: `parents[2]` → `parents[3]`. `REPO_ROOT` now resolves to the repo working tree root, the sentinel check sees `frontend/app/root.tsx` (landed in step 01-03), and the 7 file-system invariant scenarios now PASS rather than spuriously skipping.

**Pre-existence verification**: the bug is in the DISTILL-emitted conftest.py at commit `6841aac` (`Path(__file__).resolve().parents[2]` is identical in pristine state). DISTILL-author miscount, not an MR-0 regression.

**Why this is NOT a violation of the Iron Rule**: the Iron Rule forbids modifying a failing TEST to make it pass. This change modifies a test-infrastructure FIXTURE that was spuriously SKIPPING tests that would otherwise pass — i.e., it un-hides correctly-asserting tests rather than weakening a failing assertion. The 7 newly-passing tests verify the production files landed in steps 01-01 / 01-03, which is the actual purpose of those acceptance scenarios.

**Status**: RESOLVED in step 01-05. Documented here for traceability — this is the third (and final) file outside step 01-05's declared `files_to_modify` that needed reconciliation. No test assertion was modified.
