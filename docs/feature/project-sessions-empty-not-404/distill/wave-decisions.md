# DISTILL wave decisions — project-sessions-empty-not-404 (DC-196)

Bug fix with a **known cause**. Entered at DISTILL (regression-test-first) per the
brownfield routing matrix; DISCOVER/DISCUSS/DESIGN skipped (architecture ratified,
localized behavior change).

## DWD-01: Emptiness contract for `list_sessions`

A project that exists but has never had a chat session has **no `project_memory`
row** — it is provisioned lazily on first session creation (`create_session` →
`provision_project_memory`), and `create_project` explicitly defers it.

`list_sessions` currently raises `ProjectNotFound` when the memory row is absent,
producing a 404 that fails the entire `ui/` project view. The correct behavior is
an **empty session page (200)**, matching the sibling reads (`views` / `reports` /
`audit`) that already return empty 200s for the same project.

Project existence and org ownership are guaranteed upstream by the router's
`authorize_project_access` (`backend/app/routers/deps.py:73`), so a missing memory
row unambiguously means "zero sessions yet", not "project not found".

## DWD-02: Regression test (RED)

Added `TestListSessions::test_returns_empty_page_when_project_has_no_memory` to
`backend/tests/use_cases/session/test_list_sessions.py` (co-located with existing
use-case tests — this project has no `tests/regression/` tree).

- **Seeds** a `ProjectRecord` (PROJECT_2, ORG_1) with **no** `project_memory` row.
- **Asserts** `list_sessions` returns `Success` with `items == []`, `has_more is
  False`, `next_cursor is None`.
- **Confirmed RED** on unpatched code: fails with
  `ProjectNotFound(...)` at `list_sessions.py:41`. The 3 pre-existing tests still
  pass (wrong-org still yields `ProjectNotFound`).

Iron Rule honored: the test asserts the correct post-fix behavior and must not be
weakened to pass.

## Hand-off to DELIVER

Make the test green in `backend/app/use_cases/session/list_sessions.py`: when
`get_project_memory` returns `None`, return an empty page
(`{"items": [], "next_cursor": None, "has_more": False, "page_size": page_size}`)
instead of raising `ProjectNotFound`. Preserve the existing wrong-org check for the
case where a memory row **does** exist (keeps `test_fails_for_wrong_org` green).

Gate before landing: `./tools/test/test.sh --auto` (→ `--backend`).
