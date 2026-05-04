# Acceptance — log image identity on startup (dc-1k8)

This directory holds the BDD acceptance suite for the
`log-image-identity-on-startup` feature. See
`docs/evolution/2026-05-04-log-image-identity-on-startup.md` for the user stories,
design, and DISTILL wave-decisions (consolidated post-finalize).

## What is in here

- `walking-skeleton.feature` — single end-to-end scenario that builds
  a real bazel image, starts a real container via docker compose, and
  asserts on real `docker compose logs` output. Runs by default.
- `milestone-1-server-identity.feature` — AC1.1, AC1.2, AC1.3, AC1.4
  for the three server-process services (api, agent, auth-proxy). All
  scenarios tagged `@pending`.
- `milestone-2-frontend-identity.feature` — AC2.1, AC2.2, AC2.3 for
  the nginx-served frontend (stdout + `/_meta.json`). `@pending`.
- `milestone-3-cross-service.feature` — AC3.1, AC3.2 (identical sha
  and built across all four services from one `bazel run`). `@pending`.
- `milestone-4-graceful-degradation.feature` — AC1.5 (missing or
  corrupt `version.json` → "unknown" tokens, no crash). `@pending`.
- `steps/identity_steps.py` — pytest-bdd glue. Walking-skeleton
  bindings are wired; milestone bindings are added as DELIVER
  enables each scenario.
- `conftest.py` — re-exports step glue at scope; provides
  `requires_real_io` skip-fixture.
- `pyproject.toml` — declares pytest + pytest-bdd; default `-m "not
  pending"` filters milestone scenarios out of the default run.

## Running

```sh
# From this directory:
uv sync
uv run pytest                                   # walking skeleton only (default)
uv run pytest -m "walking_skeleton or pending"  # everything (DELIVER cycles)

# From repo root:
(cd tests/acceptance/log-image-identity-on-startup && uv run pytest)
```

The walking-skeleton scenario takes ~30s–2min wall-clock per service:
real `bazel run //<service>:image_load` + real `docker compose up -d` +
real log polling. If your environment lacks bazel or docker on
`$PATH`, scenarios skip with an informative reason rather than failing
(see `requires_real_io` in `conftest.py`).

## How to enable a milestone scenario (for DELIVER)

1. Remove the `@pending` tag from the scenario in its `.feature` file.
2. Add a `scenarios("../milestone-N-….feature")` call in
   `steps/identity_steps.py` (or a sibling step module) and write the
   missing bindings.
3. Add a `test_milestone_N.py` module that imports the steps module so
   pytest picks it up.
4. Run the scenario green; commit it; move on to the next.

This is the classic Outside-In TDD outer loop: one acceptance scenario
at a time, each driving its own inner red/green/refactor cycle.

## Why these tests are characterization tests

The production implementation (workspace_status emitter, `version_layer`
macro, per-service identity loggers, frontend entrypoint shim) was
landed before this acceptance suite was written — see commits prior to
`6736fa2`. These BDD scenarios pin current behavior so future changes
that break the contract are caught immediately. If the walking
skeleton goes RED on first run, that is a contract divergence, not a
"to be implemented" stub — see DISTILL `upstream-issues.md`.
