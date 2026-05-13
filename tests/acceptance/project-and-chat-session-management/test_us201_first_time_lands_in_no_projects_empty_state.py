"""US-201 — First-time-in-org Maya lands in the no-projects empty state.

Gherkin SSOT: `docs/feature/project-and-chat-session-management/distill/features/us-201-first-time-in-org-lands-in-no-projects-empty-state.feature`

DISTILL produces these tests RED — every test is `pytest.mark.skip`-marked
with a per-MR reason. DELIVER's MR-1 removes the skips as the substrate
lands. The scenarios cover:

  - @walking_skeleton happy path: J-001 ready → J-002 no_projects_empty_state
  - @happy_path: create_project_submitted → project_selected for new project
  - @error_path @boundary: empty project name → inline error
  - @error_path: transient failure → error_recoverable → retry path
  - @harness: TS UserFlowHarness drives end-to-end

The walking-skeleton scenario is the FIRST scenario MR-1 must un-skip
(it gates the slice's GREEN bar). See
`docs/feature/project-and-chat-session-management/distill/walking-skeleton.md`.
"""

from __future__ import annotations

import pytest

from driver import J002Driver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.mr_1,
    pytest.mark.needs_compose_stack,
]


@pytest.mark.skip(
    reason=(
        "DELIVER-deferred to MR-1 (Slice 1 walking-skeleton). Un-skip when the "
        "J-002 machine + MachineRegistry refactor + 4 RRv7 loaders land. This "
        "is the WALKING SKELETON gate: it must be the first scenario GREEN. "
        "See docs/feature/project-and-chat-session-management/distill/roadmap.json step 1."
    )
)
@pytest.mark.walking_skeleton
@pytest.mark.happy_path
def test_first_sign_in_foregrounds_the_no_projects_welcome_panel(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Walking skeleton: J-002 enters from J-001 ready into the no-projects empty state.

    Threads every layer (browser → reverse-proxy nginx → web-ssr root loader →
    uiStateClient → auth-proxy → ui-state → projection). Asserts the FE shows
    the welcome panel; no project chip; no suggestion chips; <300ms p95.
    """
    pytest.fail("not yet implemented — walking-skeleton scenario for MR-1")


@pytest.mark.skip(reason="DELIVER-deferred to MR-1; un-skip alongside walking skeleton")
@pytest.mark.happy_path
def test_creating_first_project_lands_in_project_selected(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """`creating_project` → `project_selected` for the new project.

    Posts `create_project_submitted` with name "Q4 Analytics"; asserts
    the projection's `state` settles at `project_selected` with
    `active_scope.project_id` = the new project's id; FE paints the
    project chip on first paint.
    """
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-1; un-skip alongside walking skeleton")
@pytest.mark.error_path
@pytest.mark.boundary
def test_empty_project_name_keeps_machine_in_no_projects_empty_state(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Submitting an empty project name surfaces an inline error without a backend call.

    Asserts the projection stays in `no_projects_empty_state`; the FE's
    inline error is "Please enter a project name"; no `POST /api/projects`
    fires (assertion via auth-proxy access log inspection).
    """
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-1; un-skip alongside walking skeleton")
@pytest.mark.error_path
def test_transient_create_project_failure_lands_in_error_recoverable_with_composer_preserved(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """A transient create-project failure transitions to `error_recoverable`.

    The retry path re-enters `creating_project` with the same correlation
    reference; the composer text "Q4 Analytics" is preserved across the
    retry boundary (context.pending_project_name per DESIGN
    application-architecture §2.3 `error_recoverable` entry-action).
    """
    pytest.fail("not yet implemented")


@pytest.mark.skip(
    reason=(
        "DELIVER-deferred to MR-1; un-skip when the TS harness extension "
        "`harness.j002.create_first_project` lands at "
        "tests/acceptance/user-flow-state-machines/harness/."
    )
)
@pytest.mark.harness
@pytest.mark.needs_ts_harness
def test_ts_harness_drives_no_projects_path_end_to_end(
    requires_compose_stack: None,
    requires_ts_harness: None,
    driver: J002Driver,
) -> None:
    """The TS `UserFlowHarness` drives the no-projects path end-to-end.

    Composes `harness.user_flow.begin_auth("maya-first-time")` with
    `harness.j002.create_first_project("Q4 Analytics")`; asserts via
    `harness.j002.assert_scope({project_id: <q4-id>})`.
    """
    pytest.fail("not yet implemented")
