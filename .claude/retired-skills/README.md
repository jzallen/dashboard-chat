# Retired skills

Skills parked here are **not active** — Claude Code does not load skills from this
directory. They are kept (rather than deleted) so the workflow they describe can be
restored if we reverse a process decision.

To reactivate one, move its folder back to `.claude/skills/<name>/`.

## Parked

### `gastown/` — retired 2026-06-15

The gastown headless merge queue (Dolt + Refinery) was our worktree-management and
local-only merge mechanism. We retired it in favor of the **cyrus + Linear** workflow:
cyrus now owns worktree-per-issue, and code lands via **GitHub PRs reviewed and merged
in Linear** (see the `linear-cyrus` skill). The `dashboard_chat` rig's merge queue was
disabled (`merge_queue.enabled=false`) and its crew worktrees removed on retirement.

Reactivate only if reverting to refinery-driven, no-GitHub-PR merges.

### `headless-nwave-worker/` — retired 2026-06-15

Dispatched long-running nwave waves as detached headless Claude processes inside a
gastown **crew worktree**, optionally submitting to the headless **merge queue**. Both
of those mechanisms are retired with gastown, so this skill is parked alongside it.
Under the cyrus+Linear model, long-running waves are delegated to `@dashboard-chat`
from a Linear issue instead (see the `linear-cyrus` skill).

Reactivate only if reverting to gastown crew/MQ-based headless dispatch.
