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
  in the body is what the agent works on — so the body must be a real brief. The deliver
  comment (below) rides in the thread as additional marching orders, so keep the story's
  `## Delivery` section consistent with it.
- **Each delegate/@mention mints a NEW session**, and the mode comes from the issue's
  **current labels** at that moment. So on a story: the first delegation (`wave:distill`)
  runs the orchestrator; after you **relabel the story `wave:deliver`**, an @mention
  **comment** mints a fresh **builder** session that delivers the whole story. Relabel
  BEFORE commenting — a comment on a still-`wave:distill` story runs read-only and can't
  implement (see `story.md`).

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

## Quick checklist

**Distill a story:** (1) story is in a Feature project + on a Release that has a
`<slug>/<release>` branch; (2) labels `wave:distill` + `area:*`; (3) daemon + pump **up**
(`make status`); (4) assign / @mention `@dashboard-chat`.

**Deliver a story:** (1) the breakdown (Skeleton + impl tasks) exists and looks right;
(2) the story description has a `## Delivery` section (target the Release branch);
(3) **relabel the story `wave:distill` → `wave:deliver`**; (4) **@mention `@dashboard-chat`
in a story comment** with the deliver instruction (iterate sub-tasks, skeleton first, mark
Done, one PR into `<slug>/<release>`).
