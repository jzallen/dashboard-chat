# DISTILL Decisions — dc-1k8

## Key Decisions

- **[DLD-1] Walking-Skeleton Strategy = C (real local I/O).** Every
  AC asserts on real `docker compose logs` / `curl /_meta.json`
  output, so InMemory doubles would invalidate K2 (the explicit CI
  guarantee in `discuss/outcome-kpis.md`). The acceptance test
  exercises real `bazel run //...:image_load` + real `docker compose
  up -d` + real log polling. WS scenario tagged `@walking_skeleton
  @real-io @driving_adapter @slow`.

- **[DLD-2] Container option = Docker Compose (no testcontainers).**
  The project already orchestrates these four services via
  `docker-compose.yml` at the repo root — that file is the canonical
  declaration of the four bazel-built service containers and is used
  by every developer and by CI. Reusing it for acceptance avoids a
  parallel testcontainers harness and keeps "what the test runs"
  identical to "what the developer runs."

- **[DLD-3] Test home = new `tests/acceptance/` root using
  `pytest-bdd`.** A new top-level `tests/acceptance/` directory hosts
  the BDD suite. Its own `pyproject.toml` declares `pytest` +
  `pytest-bdd` as test deps so the harness is self-contained and
  doesn't entangle with `backend/`'s production deps. Per-feature
  subdirectories follow the
  `tests/{test-type-path}/{feature-id}/acceptance/` convention from
  the DISTILL skill. Confirmed by user 2026-04-29.

- **[DLD-4] Mandate 7 (RED scaffolds) is N/A here.** Mandate 7 covers
  Python production modules imported by step definitions — when those
  imports would 404 the test runner. The dc-1k8 acceptance test
  imports zero production code; it exercises subprocess paths
  (`bazel`, `docker compose`, `curl`). RED status, when it occurs,
  comes from missing or malformed log output — not from missing
  modules.

- **[DLD-5] These scenarios are characterization tests, not red-then-
  green specs.** The production implementation
  (`backend/app/version.py`, `agent/version.ts`, `auth-proxy/version.ts`,
  `frontend/docker-entrypoint.sh`, `tools/workspace_status.sh`,
  `tools/version_layer.bzl`, `tools/version.json.tmpl`, `.bazelrc`
  workspace-status hookup) landed in commits before this DISTILL
  artifact was written. The walking-skeleton scenario is therefore
  expected to go GREEN on first real-IO run; if it goes RED, that is
  a contract divergence between the existing implementation and the
  AC, escalated via `upstream-issues.md`. This is the brownfield
  characterization-test pattern (Feathers) explicitly endorsed by
  `docs/research/nwave-brownfield-approach.md`.

- **[DLD-6] One walking-skeleton scenario, four `@pending` milestone
  files.** Walking skeleton exercises the dashboard-api path end-to-
  end. Milestone .feature files cover AC1.1–AC1.5 (server processes,
  frontend, cross-service consistency, graceful degradation) with all
  scenarios tagged `@pending` so DELIVER enables them one at a time.
  Default `pytest` invocation runs only the walking skeleton (`-m
  "not pending"` in `pyproject.toml`).

- **[DLD-7] Default DESIGN open-question resolutions adopted.**
  DESIGN §9 deferred four open questions to DISTILL/DELIVER if
  unanswered:
  1. Identity log line format → adopted as locked in DESIGN §7.
  2. Frontend HTTP path → `/_meta.json`.
  3. OCI labels in same PR → assumed yes (additive; verifiable post-
     merge by `docker inspect`, not blocking AC).
  4. `api-full` compose variant → out of scope (DISCUSS Out-of-Scope
     row).
  All four match what the existing implementation does, so no new
  decisions were forced.

## Wave-Decision Reconciliation Result

Reconciliation passed — 0 contradictions across DISCUSS / DESIGN /
(no DEVOPS, no SPIKE). The DESIGN→DISCUSS regex loosening
(`upstream-changes.md`) resolves the only DISCUSS↔DESIGN tension.

## Adapter Coverage Table

| Adapter                               | @real-io scenario | Covered by                                                   |
|---------------------------------------|-------------------|--------------------------------------------------------------|
| Bazel `expand_template`               | YES               | walking skeleton (real `bazel run //...:image_load`)         |
| `tools/workspace_status.sh`           | YES               | walking skeleton (parses `STABLE_GIT_COMMIT` for assertion)  |
| Filesystem `/etc/dashboard-chat/version.json` | YES       | walking skeleton (real container reads real JSON)            |
| Process stdout (Python `print`)       | YES               | walking skeleton (real `docker compose logs api`)            |
| Process stdout (Node `process.stdout.write`) | NO — pending | milestone-1 enables for agent + auth-proxy                  |
| HTTP `/_meta.json` (nginx)            | NO — pending      | milestone-2 enables for frontend                             |
| Frontend entrypoint shim (sh)         | NO — pending      | milestone-2 enables (covered transitively via `/_meta.json`) |

The "NO — pending" rows are explicitly tagged in milestone .feature
files. They are not "missing" in the Mandate-6 sense — they are
authored and parked behind `@pending` for one-at-a-time DELIVER.

## Self-Review Checklist (Dimension 9 + Mandate 7)

- [x] 1. WS strategy declared (DLD-1).
- [x] 2. WS scenarios tagged correctly (`@real-io`).
- [x] 3. Every driven adapter has at least one `@real-io` scenario or
       a `@pending` placeholder with a path to becoming `@real-io`.
- [x] 4. InMemory doubles: not used; documented in DLD-1.
- [x] 5. Container preference documented (DLD-2: docker compose).
- [N/A] 6–9. Mandate 7 — N/A (DLD-4: subprocess test; no production
       imports to scaffold).
- [x] 10. Driving adapter exercised: walking skeleton invokes both
       `bazel run` (build entry) and `docker compose up` (runtime
       entry) via subprocess.
- [x] 11. F-001: real-IO scenario per driven adapter (or @pending
       with planned coverage).
- [N/A] 12. F-002: `capsys` not used (no Python in-process boundary).
- [N/A] 13. F-005: `@when` boundary check — N/A; this test is
       inherently outside the application process.
- [x] 14. F-004: no in-feature timing assertions; `_wait_for_log_match`
       polls with a 30s deadline.
- [x] 15. F-003: BDD imports do not use sys.path manipulation; no
       noqa needed.

## Routing Forward

1. Run walking skeleton once locally (`cd tests/acceptance/log-image-
   identity-on-startup && uv sync && uv run pytest`). Expected: GREEN
   (characterization).
2. If GREEN → DELIVER enables milestone scenarios one at a time.
3. If RED → file a finding under `distill/upstream-issues.md` and
   escalate to DESIGN before DELIVER.
4. Eventually `/nw-finalize` migrates `docs/feature/log-image-
   identity-on-startup/` → `docs/evolution/`.
