<!-- DES-ENFORCEMENT : exempt -->
# Upstream Issues — `extract-dataset-query-port` — DISTILL

**Feature:** extract-dataset-query-port
**Wave:** DISTILL
**Date:** 2026-05-10
**Author:** Quinn (`nw-acceptance-designer`)

## Findings

### UI-1 — Method-name drift between trigger document and binding ADR

**Severity:** low (cosmetic; both names describe the same method).
**Surfaces:** ADR-021 §"Considered Options" → Option 1 specifies
`execute_dataset_preview(dataset, limit) -> list[dict]`. The trigger
document (`docs/research/tech-debt-hotspot-review.md` Finding 3) and
the orchestrator's DISTILL handoff brief specify
`QueryEngineAdapter.execute_dataset_query(dataset: Dataset)`. Both names
refer to the same operation: execute the dataset's staging SQL via
asyncpg + pg_duckdb COPY-route and return preview rows.

**Impact on DISTILL:** none. Gherkin uses business language ("the
query engine port") and is naming-agnostic. Step glue references the
method via documented intent in `pytest.fail` messages, not a binding
import.

**Recommended resolution (DELIVER's first commit):** Pick
`execute_dataset_query(dataset, limit)` per the trigger document. The
"preview" framing is a UI concern (we render a preview because a
preview is what the customer sees in the dashboard); the "query" framing
is the domain action (we run the dataset's compiled SQL against the
query engine and return rows). Adapter clients (e.g.,
`DatasetService.fetch_dataset`) might one day call the same method
with `limit=None` for a full materialisation, at which point the
"preview" name would mislead. `execute_dataset_query` reads correctly
in both cases.

**Required follow-up:** amend ADR-021 §"Considered Options" → Option 1
and §"Decision Outcome" → "Chosen: Option 1" to use
`execute_dataset_query` in the same commit DELIVER lands the adapter.
Update `design/design.md` §"Option α — Single QueryEngineAdapter port"
in the same commit.

### UI-2 — DISCUSS-skip leaves no formal user-stories.md to traceback against

**Severity:** none (expected and routed by CLAUDE.md).
**Surfaces:** This feature is a brownfield refactor; per the project's
nwave-brownfield routing matrix, refactor-shaped features enter at
DESIGN. There are no user stories to map against scenarios. This
matches the `dbt-test-validation` and `refactor-metadata-repository-split`
precedents.

**Impact on DISTILL:** Dim 8 (traceability coverage) Check A is
non-applicable. Coverage is verified instead against ADR-021 §"Considered
Options" and §"Architectural enforcement", plus the four characterization
tests in `backend/tests/models/test_dataset.py:919-1029` (which the
test-design-mandates skill treats as the brownfield analog to user-story
acceptance criteria).

### UI-3 — `RepositoryContainer` hosting a non-repository member

**Severity:** documented forward-note (DESIGN DWD-3, ADR-021
§Consequences); not a blocker.
**Surfaces:** Adding `query_engine` to `RepositoryContainer` is
acknowledged in DESIGN as a slight categorical impurity — the new
adapter is not a repository. DESIGN judged that introducing a parallel
`AdapterContainer` for one new adapter is YAGNI.

**Impact on DISTILL:** none — this surfaces as an organisational
convention to revisit when N≥3 non-repository adapters live there. No
acceptance scenario asserts on the container's name.

**No action required for DELIVER.** A future refactor (separate feature)
may split the container; tracked as a tech-debt note in DESIGN
DWD-3 forward-note.

## Format note

This file exists as the DESIGN→DISTILL contract: "if DISTILL surfaces
any gap or contradiction in upstream waves, record it here so DELIVER
and future architects can trace the back-propagation." Findings UI-1
and UI-3 are pre-resolved on paper but require DELIVER action (UI-1)
or future-feature action (UI-3). UI-2 is informational.

If a gap surfaces during DELIVER's TDD cycle, the software-crafter
should append findings here rather than silently re-interpreting the
design.
