# Acceptance Suite — `frontend-coexistence`

pytest-based BDD acceptance tests for the RRv7 framework-mode
coexistence feature (ADR-034). 10 `.feature` files live as the
canonical scenario SSOT under
`docs/feature/frontend-coexistence/distill/`. This directory holds the
matching `test_*.py` modules + the harness + a per-feature pyproject.toml + venv.

## Layout

```
features (SSOT)              docs/feature/frontend-coexistence/distill/*.feature
pyproject.toml               # standalone (uv venv); not in the workspace turbo graph
conftest.py                  # fixtures (driver, reachability, repo state, compose introspection)
driver.py                    # HTTP probe + file inspection + compose helpers
test_*.py                    # one module per .feature file
```

## Walking-Skeleton Strategy: C

Real local compose stack + skip-when-unavailable. See
[`../../docs/feature/frontend-coexistence/distill/wave-decisions.md`](../../docs/feature/frontend-coexistence/distill/wave-decisions.md)
§DI-1 for the rationale.

## Running locally

```bash
# 1. Bring up the post-MR-0 compose stack from the repo root.
docker compose up -d

# 2. Sync the per-suite venv.
cd tests/acceptance/frontend-coexistence
uv sync

# 3. Collect + run (everything is @skip at the DISTILL handoff — expected output:
#    "<N> skipped, 0 failed, 0 errored").
uv run --no-project pytest

# 4. To run a specific phase's scenarios (after DELIVER unskips them):
uv run --no-project pytest -m slice_1   # MR-0 plumbing
uv run --no-project pytest -m slice_2   # first per-route migration
uv run --no-project pytest -m slice_3   # reversibility + chat opt-out
uv run --no-project pytest -m slice_4   # operational readiness

# 5. To run only the walking skeleton:
uv run --no-project pytest -m walking_skeleton
```

## Environment variables

| Variable | Default | Used by | Notes |
|---|---|---|---|
| `REVERSE_PROXY_URL` | `http://localhost:5173` | every HTTP probe | host port the `reverse-proxy` compose service binds |
| `AUTH_PROXY_URL` | `http://localhost:1042` | the bearer-forwarding scenario | host port `auth-proxy` binds; matches the convention `tests/acceptance/user-flow-state-machines/` uses |
| `MIGRATED_ROUTE_PATH` | `/login` | Phases 02, 03, 04 | the route DELIVER picks for the first per-route migration |
| `AUTH_PROXY_TEST_MIRROR_PATH` | `/auth-proxy/test/last-seen-authorization` | bearer-forwarding scenario | mirror endpoint that records the most-recent inbound Authorization header value; DELIVER wires this in Phase 02 per DI-U-2 |
| `PRE_SLICE_2_REF` | (unset) | reversibility scenarios | git ref of the commit just before Slice-2 lands |
| `POST_SLICE_2_REF` | (unset) | reversibility mirror-diff scenario | git ref of the Slice-2 merge commit |
| `POST_MR_2_REF` | `HEAD` | reversibility mirror-diff scenario | git ref of the MR-2 merge commit |
| `MIGRATED_ROUTE_MODULE_PATH` | `frontend/app/routes/login.tsx` | reversibility mirror-diff scenario | the route module file whose `loader` was added then removed |

## Pytest markers

| Marker | Meaning |
|---|---|
| `real_io` | scenario uses real adapters (compose stack + real HTTP + real filesystem) |
| `walking_skeleton` | the single end-to-end scenario gating MR-0 GREEN |
| `slice_1` … `slice_4` | DELIVER phase the scenario belongs to |
| `needs_playwright` | scenario requires browser DOM inspection; DELIVER picks implementation per DI-U-3 |
| `needs_compose_stack` | scenario requires the local compose topology to be reachable |
| `needs_repo_post_mr0_state` | scenario requires the repo file tree to reflect post-MR-0 state |
| `slow` | scenario expected to take >10s wall-clock |

## DELIVER sequence

Per [`roadmap.json`](../../docs/feature/frontend-coexistence/distill/roadmap.json) — four phases mapped to four DELIVER MRs (MR-0 plumbing, MR-1 first per-route migration, MR-2 reversibility + chat opt-out, MR-3 operational readiness).

DELIVER's first action per phase is to:

1. Read `roadmap.json` `phases[<id>].scenarios_to_unskip`.
2. Remove the `pytest.mark.skip(...)` decorator from each named scenario's test function.
3. Run those tests against the local compose stack — they should fail RED.
4. Outside-In TDD: drive the implementation that turns each scenario GREEN.
5. When all phase scenarios are GREEN, submit the MR via `gt mq submit`.

## Iron Rule reminder

NEVER modify a failing test to make it pass. After 3 failed attempts on a step, revert and escalate via clear failure output. See CLAUDE.md `tdd` skill mandate.

The acceptable test mutation is **removing a `@skip` marker** at the start of a phase (test goes from `skipped` to `failing RED`). The forbidden mutation is **adding a `@skip` marker** to make a test stop failing — that hides regressions and violates the Iron Rule. If a test is genuinely deferred to a later phase, document the deferral in `roadmap.json` `scenarios_deferred_within_phase` AND in the test's `pytest.mark.skip(reason=...)` argument.

## Gate behavior

The refinery's `--auto` gate (run by `gt mq submit`) inspects the diff against `origin/main`:

- For docs-only diffs (`docs/**`, `*.md`): the gate skips and merges instantly.
- For anything else: the gate falls through to `--backend` (`cd backend && ruff + pytest`).

Either way, the gate does NOT collect this acceptance suite (it's at `tests/acceptance/<feature>/`, not under `backend/`). DELIVER runs this suite locally before submitting; the suite passing is a precondition to `gt mq submit`, not a refinery check.

## Cross-references

- DESIGN: [`docs/feature/frontend-coexistence/design/`](../../docs/feature/frontend-coexistence/design/) — application-architecture.md, wave-decisions.md, c4-diagrams.md, handoff-design-to-distill.md, review-by-system-designer.md
- DISTILL: [`docs/feature/frontend-coexistence/distill/`](../../docs/feature/frontend-coexistence/distill/) — wave-decisions.md, roadmap.json, upstream-issues.md, handoff-distill-to-deliver.md, 10 `.feature` files
- ADR-034 (canonical): [`docs/decisions/adr-034-frontend-coexistence-via-rrv7-framework-mode.md`](../../docs/decisions/adr-034-frontend-coexistence-via-rrv7-framework-mode.md)
- Reference acceptance suite (Strategy-C pytest pattern this one mirrors): `tests/acceptance/ibis-as-only-sql-compiler/`
