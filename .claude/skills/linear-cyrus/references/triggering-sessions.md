# Triggering a cyrus session from Linear

## What actually starts a session

cyrus runs **only** on a Linear `AgentSessionEvent / created`, minted by **delegating or
@mentioning the agent-enabled `@dashboard-chat` app** on an issue. Plain assignment to a human,
a bare comment, or a label change does **not** start a session.

- **Delegate** (assign the agent) or **@mention `@dashboard-chat`** → an AgentSession is created
  → Linear POSTs the signed event → cyrus runs a Claude Code session that **streams activity
  back into the issue thread**.
- The issue's **description is the task prompt** (`fetchFullIssueDetails`) — so the body must be
  a real brief with `## AGENT NOTES` naming the command.
- **Each delegate/@mention mints a NEW session**, and the mode comes from the issue's **current
  labels** at that moment.

## The two delegation patterns

**1. The proposal wave chain (pre-promotion, write-capable).** On the **proposal issue**, cycle
the `wave` flag and delegate at each step — `discuss → design → distill → deliver`. Each mints a
fresh session whose mode is the current wave label; each is **write-capable** and commits its
artifacts to the proposal's branch (`intake-and-promotion.md`). Relabel forward only when you're
satisfied with the prior wave. Partial-deliver stops after `roadmap.json`.

**2. Per-scenario delivery (post-promotion).** After promotion, delegate dc-cyrus on each
**scenario issue** (`wave › deliver`). Its `## AGENT NOTES` names **`/nw-execute <slug>
<step-id>`** and the **feature branch** to base on / PR into. The session cuts a scenario branch
off the feature branch, drives the step's `.feature` scenario green, and squash-merges back
(`scenario.md`, `branching-and-merge.md`). Scenarios in a slice with no `blocked_by` edge can be
delegated **concurrently** (`parallel-execution.md`).

**Not delegated:** Release Slice issues and Story issues are **validation surfaces** — never
delegate them for code (`milestone.md`, `story.md`). Their AC boxes are checked by the scenario
sessions + slice verification (`verification.md`), not by a build session.

## cyrus mode config (`labelPrompts`)

Mode + tool scope come from the `wave` child label. The pre-promotion waves must map to
**write-capable** presets (they commit docs/tests/roadmap) — this is the change from the old
read-only `discuss`. `deliver` stays write-capable (`all`) for scenario `/nw-execute`. A new
wave child needs its `labelPrompts` entry before it routes (`linear-structure.md`).

## Prerequisites (devpod ops)

Linear → AWS Lambda Function URL → SQS → local pump → local cyrus daemon → Claude Code → posts
back. For delegations to drive sessions:

- **cyrus daemon** running (`cyrus` on :3456) and a **continuous SQS-mode pump**.
- Managed via `cyrus/Makefile`: `make up | down | restart | status | logs`. Both restart after a
  devpod stop/start (re-apply IMDS hop-limit = 2 if the instance was recreated — memory
  `cyrus-local-running`).
- The Linear app must stay **agent-enabled** with the "Agent session events" webhook registered.

## Routing recap

The **`teamKeys` catch-all** routes every DC issue to `dashboard-chat` without a per-issue label.
The `wave` child then selects the `labelPrompts` mode. (If routing misbehaves, a
`[repo=dashboard-chat]` tag in the description is the highest-priority override.)

## Quick checklist

**Advance a proposal wave:** (1) proposal on its branch; (2) relabel to the next `wave` child;
(3) daemon + pump **up** (`make status`); (4) delegate / @mention `@dashboard-chat`.

**Deliver a scenario:** (1) promotion done, scenario issue exists with `deliver` + area, no open
`blocked_by`; (2) its body names `/nw-execute <slug> <step-id>` + the feature branch; (3)
daemon + pump **up**; (4) delegate / @mention `@dashboard-chat`.
