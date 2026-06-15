# Triggering a cyrus session from Linear

## What actually starts a session

cyrus runs **only** on a Linear `AgentSessionEvent / created`. That is minted by
**delegating or @mentioning the agent-enabled `@dashboard-chat` app** on an issue.
Plain assignment to a human, a comment, or a label change does **not** start a
session.

- **Delegate** (assign the agent) or **@mention `@dashboard-chat`** in a comment → an
  AgentSession is created → Linear POSTs the signed event → it reaches cyrus → a
  Claude Code session runs and **streams activity back into the issue thread**.
- The issue's **description is the task prompt** (`fetchFullIssueDetails`). Whatever is
  in the body is what the agent works on — so the body must be a real brief. Per-wave
  issue templates (opening with the matching `/nw-*` command) make this automatic.

## Prerequisites (devpod ops)

The full path is: Linear → AWS Lambda Function URL → SQS → local pump → local cyrus
daemon → Claude Code → posts back to Linear. For delegations to drive sessions:

- **cyrus daemon** running on the devpod (`cyrus` on :3456).
- **Continuous SQS-mode pump** running (drains the queue and replays to cyrus).
- Managed together via `cyrus/Makefile`: `make up | down | restart | status | logs`.
- Both must be restarted after a devpod stop/start (and the EC2 **IMDS hop-limit = 2**
  re-applied if the instance was recreated — see memory `cyrus-local-running`).
- The Linear app must stay **agent-enabled** with the "Agent session events" webhook
  registered, else mentions/delegations won't mint an AgentSession.

## Access control

cyrus `userAccessControl.allowedUsers` restricts who may delegate. For a solo/small
setup, leave open or list the known delegators. `blockBehavior` (`silent` /
`comment`) controls the response to a blocked delegation.

## Routing recap

With the **`teamKeys` catch-all** configured for the single team, every issue routes
to `dashboard-chat` without needing a per-issue routing label. The `wave:*` label then
selects the `labelPrompts` mode + tool scope. (If routing ever misbehaves, a
`[repo=dashboard-chat]` tag in the description is the highest-priority override, read
live at webhook time.)

## Quick checklist before delegating

1. Issue is in a **Project** that has a `feature/<slug>` branch.
2. Description is a real brief (template-based, opens with `/nw-*`).
3. Labels: one `wave:*` + one `area:*`.
4. For deliver: the **work sub-issue** with its AC checklist exists (run `wave:distill`
   orchestrator on the story first).
5. daemon + pump are **up** (`make status`).
6. Delegate / @mention `@dashboard-chat`.
