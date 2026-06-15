# Headless Merge Queue (Dolt + Refinery only)

**Operational recipe for using Gas Town's merge queue *without* the rest of Gas Town.**

This mode skips Mayor, Witness, Deacon, Daemon, polecats, and convoys. You get exactly two services running: **Dolt** (the bead-backed bead store) and **Refinery** (the per-rig merge queue processor). The user works in any worktree they want — main checkout, a hand-made `git worktree add`, an external IDE, anywhere — and submits branches to the queue with `gt mq submit`. The Refinery does the rest.

Use this mode when:

- The user wants the merge queue mechanic but not the multi-agent coordination layer.
- Token cost during normal operation matters (no Witness/Deacon/Mayor chatter when the system is idle or backed up).
- Work is single-user or single-stream — there is no need for Mayor's global coordination.
- Polecats and convoys are overkill for the current scope.

Do NOT use this mode when:

- Multiple agents need to be coordinated through Mayor's global priority queue.
- Polecats are doing the work — polecat lifecycle requires Witness.
- The user explicitly asked for the full Gas Town experience (use `gt up` instead).

---

## Service dependency map

| Service       | Required for headless merge queue? | Reason                                                                                                                   |
|---------------|------------------------------------|--------------------------------------------------------------------------------------------------------------------------|
| **Dolt**      | **Required**                       | The bead store. Refinery reads/writes merge-request beads via `bd`, which is Dolt-backed. No Dolt → no queue.            |
| **Refinery**  | **Required**                       | The merge consumer itself. Without it, `gt mq submit` just queues work that nobody processes.                            |
| **Daemon**    | Optional                           | The "poker" that translates bead-state changes into push-style nudges. Without it the Refinery falls back to polling.    |
| **Mayor**     | Skip                               | Global work coordinator. Only matters for `gt sling` / convoy flows. Direct `gt mq submit` bypasses Mayor entirely.      |
| **Witness**   | Skip                               | Per-rig polecat lifecycle manager. No polecats → nothing to witness.                                                     |
| **Deacon**    | Skip                               | Town-level health watchdog (monitors Mayor / Witnesses). Pure observation; Refinery does not depend on it.               |
| **Polecats**  | Skip                               | Ephemeral workers. The whole point of headless mode is the user does the work themselves in any worktree.                |
| **Crew**      | Skip                               | Persistent human workspaces. Optional in any mode; not required for the merge queue.                                     |

---

## One-time setup

You run these commands for the user. The user never types them.

```bash
gt dolt start                          # Bring up the bead store (REQUIRED)
gt refinery start <rig>                # Bring up the merge consumer (REQUIRED)
gt refinery status                     # Confirm processing loop is alive
gt refinery queue                      # Empty queue confirmation
```

If the rig is not yet registered, run `gt rig add <name> <git-url>` first. Verify registration via `cat ~/gt/rigs.json` — the entry must point at the user's local checkout via `local_repo`.

If the user wants push-style notifications instead of polling, optionally add:

```bash
gt daemon start                        # Optional: low-overhead nudge router
```

---

## Per-task workflow

The user works in any worktree on any branch. Examples:

* The repo's own `main` checkout with a feature branch.
* A `git worktree add ../feature-x feature-x` they made themselves.
* A separate Claude session running in a different terminal.

You run these commands for the user when they say "submit this branch" or "queue it up":

```bash
# 1. Inspect the current branch and confirm it is pushed
git status
git log --oneline -3

# 2. Submit to the queue (creates a merge-request bead)
gt mq submit                            # Auto-detects branch + rig from cwd
# OR with explicit metadata:
gt mq submit --branch feature/x --issue dc-123

# 3. Watch the queue
gt refinery queue
gt refinery ready                       # MRs ready for processing
gt mq status <mr-id>                    # Detailed status of one MR
```

The Refinery autonomously:

1. Picks up the MR bead.
2. Rebases the work branch onto latest `main`.
3. Runs validation (tests, builds, checks per the rig's Refinery configuration).
4. Merges to `main` if green, fires `MERGED` bead.
5. On conflict / test failure: fires `MERGE_FAILED` or `REWORK_REQUEST`.

The user syncs their worktree when convenient:

```bash
git pull origin main
```

---

## Diagnosing a stuck queue

Without a Witness, stuck merges do NOT auto-escalate. You must self-monitor. Symptoms and probes:

* **`gt refinery queue` shows MRs not advancing for >5 min** — Refinery may be wedged. Check `gt refinery status`. If it claims to be running but nothing is processing, restart: `gt refinery restart <rig>`.
* **`gt mq submit` errors "rig not found"** — the rig is registered in `~/gt/rigs.json` but the bead store does not have its row, or the registry name is normalized differently. Run `gt rig list` to see the canonical name.
* **`bd` commands hang or error** — Dolt is not running or its socket is wrong. Run `gt dolt status`. Restart with `gt dolt restart` if needed.
* **Refinery rejects every MR** — check the rig's Refinery configuration: `gt rig settings <rig>`. The validation pipeline (tests/builds) might have a misconfigured command.

The one operational task you take on by going headless is replacing what the Witness would otherwise do: actively check on stuck merges and restart the Refinery when polling latency is unacceptable. For unattended overnight runs, prefer `gt rig boot <rig>` (witness + refinery) over headless mode.

---

## Tear-down

```bash
gt refinery stop <rig>
gt dolt stop                            # Optional: leaves the bead store warm if you'll come back
```

Or wholesale:

```bash
gt down                                 # Stops every Gas Town service
```

`gt down` is safe in headless mode because no other services are running; it is idempotent.

---

## Trade-offs to surface to the user

When the user asks "should I run the merge queue headless?", lead with these:

* **Wins**: minimal token chatter, fast boot, no Witness/Mayor/Deacon coordination noise, works with any worktree layout the user prefers.
* **Losses**: stuck-merge escalation is on the user (no Witness), no Mayor priority queue (work goes first-in-first-out by submission order unless `--priority` is set), and polling-latency for new merge requests if the Daemon is also off.
* **Reversible**: switching from headless to full Gas Town is `gt up` and back. State lives in Dolt; nothing is lost.

If the user is using polecats already, headless mode is the wrong choice — polecat lifecycle requires the Witness. Suggest `gt rig boot <rig>` (witness + refinery, still skipping Mayor / Deacon) as a middle ground.

---

## Quick comparison

| Mode                              | Command                  | Services          | Token overhead | When to pick                                                                                  |
|-----------------------------------|--------------------------|-------------------|----------------|-----------------------------------------------------------------------------------------------|
| **Full Gas Town**                 | `gt up`                  | All               | Highest        | Multi-agent coordination, convoys, polecat work pipelines.                                     |
| **Per-rig boot**                  | `gt rig boot <rig>`      | Witness + Refinery + Dolt | Medium  | Need merge queue with stuck-merge escalation, but no Mayor / Deacon / Daemon.                  |
| **Headless merge queue (this)**   | `gt dolt start` + `gt refinery start <rig>` | Dolt + Refinery   | Lowest         | User wants the merge queue mechanic and nothing else. Self-monitors stuck merges.              |
