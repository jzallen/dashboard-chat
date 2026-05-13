# J-002 acceptance suite — `project-and-chat-session-management`

Pytest acceptance suite for J-002. Lands at DISTILL as **RED** (every test
is `@pytest.mark.skip`-marked). DELIVER unpends per the per-MR schedule
in `docs/feature/project-and-chat-session-management/distill/roadmap.json`.

## Running

The suite has its own `pyproject.toml` and `uv` venv per CLAUDE.md's
acceptance-suite convention. Run from inside the suite directory:

```bash
cd tests/acceptance/project-and-chat-session-management
uv run --no-project pytest
```

The `--no-project` flag skips the workspace `uv` would otherwise infer
from cwd. The first run materializes the venv from `pyproject.toml`.

## Pre-requisites for un-skipped scenarios

Most scenarios are `pytest.mark.needs_compose_stack`-tagged and require
the local compose stack reachable on host ports:

```bash
docker compose up -d                 # from repo root
```

Default ports (overridable via env):
- `REVERSE_PROXY_URL=http://localhost:5173` — driving port for the SSR-rendered UI
- `AUTH_PROXY_URL=http://localhost:1042` — diagnostic / token-mint probes
- `UI_STATE_URL=http://localhost:1043` — projection endpoint diagnostic probes
- `AGENT_URL=http://localhost:1041` — agent chat endpoint diagnostic probes

A subset of scenarios drive the TS UserFlowHarness `harness.j002.*`
namespace and are gated by `requires_ts_harness` — they skip until
MR-1 DELIVER lands the namespace at
`tests/acceptance/user-flow-state-machines/harness/`.

## Suite shape

- `pyproject.toml` — feature-scoped uv venv; pytest config + markers.
- `conftest.py` — fixtures, skip-guards, env defaults.
- `driver.py` — thin I/O composition over `httpx` + `pathlib` + `subprocess`.
- `test_us201_*.py` … `test_us210_*.py` — one module per user story.
- `test_journey_invariants_j002.py` — IC-J002-1..IC-J002-7 + Praxis F-5 property.

The Gherkin SSOT for each test lives at
`docs/feature/project-and-chat-session-management/distill/features/*.feature`.
Each pytest function references its scenario by docstring + `@us-<N>` /
`@ic-j002-<N>` marker. Tests are the executable; the `.feature` files
remain the human-readable single source of truth for behavior.

## DISTILL → DELIVER hand-off

See `docs/feature/project-and-chat-session-management/distill/handoff-distill-to-deliver.md`
for the MR-by-MR schedule of which scenarios un-skip when.
