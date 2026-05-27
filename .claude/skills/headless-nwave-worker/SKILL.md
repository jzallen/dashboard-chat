---
name: headless-nwave-worker
description: Use when the user wants to dispatch ANY long-running nwave-ai wave (nw-research, nw-discuss, nw-design, nw-distill, nw-deliver, nw-review, nw-bugfix, nw-spike, nw-refactor, nw-document, nw-mikado, nw-hotspot, etc.) as a detached headless Claude process inside a gastown crew workspace, optionally submitting code work to the headless merge queue. Triggers — "headless <wave>", "dispatch <wave>", "spin up a <wave> worker", "crew <wave> worker", "background nw-<wave>", "send /nw-<wave> to a headless session", "run <wave> in a crew", any phrasing combining a wave name with "headless" or "crew worker" or "MQ submit", and the historical alias "headless deliver worker".
---

# Headless nWave Worker (git worktree + MQ submission)

## Overview

Recipe for dispatching any nwave-ai wave (`nw-*` skill) as a **detached headless Claude process** running inside a **git worktree of the user's local repository** on its own branch. The worker submits via the **headless merge queue** (`gt mq submit`) regardless of wave type — the refinery's content-aware `--auto` gate decides whether to run backend tests (code touch) or skip the gate (docs-only diff). This is the project's trunk-based workflow: short-lived branches, refinery-arbitrated merges, no upstream GitHub PRs as a primary mechanism.

> **Worktrees, not `gt crew add`, in headless mode.** Earlier revisions of this skill used `gt crew add` to create the worker's workspace. That command clones from the rig's `git_url` (the GitHub URL), which is **stale relative to local main** in any setup that uses the headless merge queue (refinery merges land local-only — see `gastown/references/headless-merge-queue.md`). A `gt crew add` workspace lacks every commit that hasn't been pushed to GitHub, which on this rig is most of them. **Use `git worktree add` from `local_repo` instead** — the worktree shares the user's local history at the moment of creation, and re-pointing its `origin` at `local_repo` makes `git push -u origin <branch>` land where the refinery's clone can see it. See Step 2.

Use this when:

- The wave is expected to take >30 min and must survive your conversation's disconnects or context compactions.
- You want the worker to commit on its own branch — isolated from your interactive workspace.
- You want full Claude Code surface (Skills, all tools, MCP, sub-agents) — not the constrained tool set of a `Agent({ run_in_background: true })`.
- You want token billing isolated from your conversation tier.

Do NOT use this for:

- Bounded research / lookups under ~30 min → use `Agent({ run_in_background: true })` instead.
- Anything that needs to ask the user clarifying questions mid-run — headless mode runs with `--dangerously-skip-permissions` and cannot prompt interactively.
- Multi-agent coordination through Mayor/Witness/Polecats → use full `gt up` and `gt sling` instead.

## Mental Model

**`/nw-<wave>` is a SKILL NAME, not a slash-command file.** There is no `~/.claude/commands/nw-deliver.md`. nwave-ai installs skills at `~/.claude/skills/nw-*/` and `~/.local/share/uv/tools/nwave-ai/.../skills/nw-*/`. Claude Code's interactive UI recognizes `/<skill-name>` as a Skill invocation, and so does headless `claude -p` — **but only for skills whose frontmatter has `user-invocable: true`** (or omits the field; default is true).

This matters because **`claude -p` parses a leading `/<word>` as a slash-command attempt before the model ever runs**. If the slash command can't be resolved, the session exits silently with `num_turns: 0`, `result: ""`, no API call billed — looks identical to a malformed prompt. Diagnostic signature in the stream-json log:

```json
{"type":"result","subtype":"success","duration_ms":33,"num_turns":0,
 "result":"","total_cost_usd":0,"usage":{"input_tokens":0,...}}
```

If you see `duration_ms < 100` AND `num_turns: 0` right after the init event, the prompt's leading slash was rejected at the CLI layer.

**Two common ways this bites you:**

1. **Skill is `user-invocable: false`.** Some nwave-ai skills (e.g. `nw-finalize`, `nw-finalize`-orchestration helpers, `nw-deliver-orchestration`) are dispatch-only and don't appear in the session's `slash_commands` list. Confirm by grepping the skill's frontmatter at `~/.claude/skills/<name>/SKILL.md` or `~/.local/share/uv/tools/nwave-ai/.../skills/<name>/SKILL.md`:

   ```bash
   grep -E '^(name|user-invocable):' ~/.claude/skills/<name>/SKILL.md
   ```

   If `user-invocable: false`, **do not lead the prompt with `/<name>`** — it will be rejected.

2. **Skill isn't installed at all** (e.g. a wave the project's CLAUDE.md aspires to but the local nwave-ai release predates). Same failure shape. Check `~/.claude/skills/.nwave-manifest.json` (`installed_skills` array) and the live session's `slash_commands` field in the init event.

**The safe pattern (works for both invocable and non-invocable skills):**

- Lead the prompt with a plain imperative header, not a slash command — e.g. `Archive the user-flow-state-machines feature to docs/evolution/.` or `Begin the DELIVER wave for ibis-as-only-sql-compiler Phase 05.`
- In the body, **always** include an explicit instruction to invoke the skill by name: "Begin by invoking the nw-deliver skill and following its orchestration." For non-invocable skills, point at the SKILL.md by absolute path: "Read the SKILL.md at `/home/node/.local/share/uv/tools/nwave-ai/.../skills/nw-finalize/SKILL.md` and follow its orchestration."
- A leading `/nw-<wave>` line IS still fine when the skill is confirmed user-invocable (e.g. `/nw-deliver`, `/nw-design`, `/nw-distill`) — the model receives it as the first user turn. But the imperative in the body remains the load-bearing instruction; the slash-command line is convenience.

**Pre-flight check before dispatching any wave:**

```bash
# Is the wave's skill user-invocable in this env?
SKILL=nw-<wave>
for p in ~/.claude/skills/$SKILL/SKILL.md \
         ~/.local/share/uv/tools/nwave-ai/lib/python*/site-packages/nWave/skills/$SKILL/SKILL.md; do
  [ -f "$p" ] && grep -H -E '^(name|user-invocable):' "$p"
done
```

If the grep prints `user-invocable: false`, switch to the plain-imperative prompt form before launching.

## Terminology Hygiene — Headless Mode Vocabulary

This skill operates inside the **gastown headless merge queue** topology — Dolt + Refinery only, no Mayor / Witness / Deacon / polecats / convoys. The gastown skill (which you may also have loaded) defines a richer in-world vocabulary that does NOT apply here. When narrating worker status, dispatch, or coordination from this skill, **drop the gastown persona for processes that aren't running.**

Concretely, when operating workers via this skill:

| Avoid (full-gastown term) | Use instead (headless term) |
|---|---|
| "convoy" / "the convoy landed" | "dispatch" / "today's worker set" / "the workers landed" |
| "I nudged the polecat" | "I sent a resume directive" / "the overseer message in `claude -p --resume`" |
| "slinging work" | "launching a worker session" / "starting the tmux session" |
| "the engine" / "engine room" | "the refinery + Dolt" |
| "Mayor coordinated …" | (skip — there is no Mayor in this mode) |
| "Witness caught the stuck worker …" | "I noticed the worker stalled (you are the watchdog in headless mode)" |
| "the polecat finished" | "the worker session emitted its final summary and `claude -p` exited" |

What IS real and addressable in headless mode: the Refinery, Dolt, the MQ queue, MR beads (`<prefix>-wisp-*`), rig identity beads (`<prefix>-rig-*`). Everything else gastown-named in this mode is non-operational and should not appear in narration.

Worker workspaces created by this skill are **git worktrees** of `local_repo` (under `~/gt/<rig>/worktrees/<name>/`), populated with a `claude -p` session via tmux. They are NOT the daemon-supervised crew of full gastown and NOT the legacy `gt crew add` clones the earlier revision of this skill used (those clone from GitHub and miss local-only commits — see the Overview callout). Refer to them as "worker workspaces" or "worker sessions", not as "polecats" or as part of a "convoy".

See also `gastown/SKILL.md` §"Headless Mode — Which Characters Are Actually Running" for the parallel callout on the gastown side.

## Choosing the Wave

| Wave | Typical inputs | Typical outputs | Handoff | Branch strategy |
|---|---|---|---|---|
| `nw-discover` | None | Discovery report, evidence inventory | `gt mq submit` | `research/<slug>` or `discover/<slug>` |
| `nw-research` | Question / topic | Cited research doc in `docs/research/` | `gt mq submit` | `research/<slug>` |
| `nw-diverge` | Validated problem | 3–5 design directions in `docs/feature/<slug>/diverge/` | `gt mq submit` | `discuss/<slug>` |
| `nw-discuss` | Stories (or obvious) | JTBD job stories, journeys, BDD AC, US-* in `docs/feature/<slug>/discuss/` | `gt mq submit` | `discuss/<slug>` |
| `nw-design` | Discuss artifacts | ADRs, C4 diagrams, `application-architecture.md`, `system-architecture.md` | `gt mq submit` | `design/<slug>` |
| `nw-distill` | Design ratified | RED acceptance tests, `roadmap.json` | `gt mq submit` | `distill/<slug>` |
| `nw-spike` | Hypothesis | Probe report + optional walking skeleton | `gt mq submit` | `spike/<slug>` |
| `nw-deliver` | DISTILL roadmap | Implementation code, all commits green | `gt mq submit` | `crew/<worker>` |
| `nw-bugfix` | Bug report | Regression test + fix | `gt mq submit` | `fix/<slug>` |
| `nw-refactor` | RPP target | Refactor-only code changes | `gt mq submit` | `refactor/<slug>` |
| `nw-review` | Artifact to review | Critique report (graded) | `gt mq submit` | `review/<slug>` |
| `nw-hotspot` | Git history | Hotspot map / churn analysis | `gt mq submit` | `research/<slug>` |
| `nw-document` | Feature artifacts | DIVIO/Diataxis docs | `gt mq submit` | `docs/<slug>` |
| `nw-mikado` | Refactor target | Mikado roadmap + visual tracking | `gt mq submit` (per phase) | `refactor/<slug>` |
| `nw-finalize` | All waves complete | Archive to `docs/evolution/` | `gt mq submit` | `finalize/<slug>` |
| `nw-mutation-test` | Implementation done | Mutation kill-rate report | `gt mq submit` | `mutation/<slug>` |

**Single funnel through MQ.** Every wave — code or docs — submits via `gt mq submit`. The refinery's gate is `./tools/test/test.sh --auto`, which is content-aware:

- The gate diffs the branch against `origin/main`.
- If every changed file matches the docs-only allowlist (`docs/**`, `.claude/skills/**`, `.claude/settings.json`, `README*`, `CHANGELOG*`, `*.md`), it exits 0 — no tests run, the refinery merges in seconds.
- Otherwise it falls through to `--backend` (ruff + pytest) as the safe default.

This means workers never need to choose how to land work — they always submit via `gt mq submit` and the gate self-classifies. A worker whose commits are pure docs (finalize, research, review) gets near-instant landings; a worker whose commits touch `backend/` gets the full backend gate. Mixed commits run full tests. See `tools/test/test.sh` `--auto` selector for the exact allowlist.

**Do not use `gh pr create` from a worker.** This project is trunk-based: every change lands on `main` via the merge queue. The "PR" vocabulary in older ADRs refers to merge requests (`gt mq submit` → MR bead, e.g. `dc-wisp-…`), not GitHub Pull Requests. If you find yourself reaching for `gh pr create`, you are off-pattern — re-route through `gt mq submit`.

## Prerequisites

### General (every wave)

1. **Headless gastown engine running** (see gastown skill's `references/headless-merge-queue.md`):
   - `gt dolt status` → running on :3307
   - For MQ-bound waves: `gt refinery status` → running for the rig
   - For docs-only waves: refinery is optional but harmless.
2. **Rig registered in `~/gt/rigs.json`** with `local_repo` pointing at the user's checkout.
3. **Project `.claude/` accessible inside the worker workspace** — a `git worktree` shares the parent repo's working tree at the moment of creation, so `.claude/` (skills, agents, settings) is automatically present.
4. **Saved memory consulted** — especially feedback memories that constrain this wave (e.g. `feedback_sequential_deliver_dispatch.md`).

### Wave-specific (verify before dispatch)

| Wave | Required input artifacts |
|---|---|
| nw-research / nw-discover | A specific, non-trivial question. Bad: "research auth". Good: "evaluate Remix vs Next.js App Router for our ui-state tier given ADR-027 constraints." |
| nw-discuss | An existing problem statement or DIVERGE output. For brownfield, ADR backlog defines the problem. |
| nw-design | DISCUSS artifacts in `docs/feature/<slug>/discuss/` |
| nw-distill | DESIGN ratified, ADRs accepted, `docs/feature/<slug>/design/` populated |
| nw-deliver | DISTILL committed; `roadmap.json` + `upstream-issues.md` present; RED scaffolds in place |
| nw-bugfix | Bug report with reproducer (or known cause for regression-test-first path) |
| nw-refactor | RPP target identified, characterization tests in place if legacy |
| nw-review | The artifact to critique (path on disk or git ref) |
| nw-hotspot | None — runs against git history directly |
| nw-document | Implementation complete; classification (tutorial / how-to / reference / explanation) decided |

## Dispatch Sequence

### Step 1 — Start headless engine (if not already up)

```bash
cd ~/gt/<rig>            # gt scans cwd/.dolt-data/ — always run gt from ~/gt/<rig>/
gt dolt start
gt refinery start <rig>  # skip for pure-docs waves if you want zero overhead
gt refinery status
gt refinery queue
```

### Step 2 — Create a worktree from `local_repo`

Resolve the rig's local checkout and add a worktree on a fresh branch off `main`:

```bash
LOCAL_REPO=$(jq -r ".rigs.\"<rig>\".local_repo" ~/gt/rigs.json)   # e.g. /workspaces/dashboard-chat
WORK=~/gt/<rig>/worktrees/<worker-name>                            # one-per-worker; mirrors the old crew layout
mkdir -p ~/gt/<rig>/worktrees

cd "$LOCAL_REPO"
git worktree add "$WORK" -b crew/<worker-name> main                # creates branch crew/<worker-name> from current local main
git worktree list                                                  # confirm the new entry

# Repoint the worktree's origin at the local repo so push lands where the refinery
# can see it. (Worktrees inherit the parent repo's remote config, which on this
# rig is the upstream GitHub URL — pushing there would silently fail to feed the
# merge queue.)
cd "$WORK"
git remote set-url origin "$LOCAL_REPO"
git push --dry-run -u origin crew/<worker-name>                    # sanity: "Would set upstream of … to origin"
```

For non-DELIVER waves, name the branch to match the strategy in the wave table by passing `-b <branch-strategy>/<slug>` to `git worktree add` instead of `crew/<worker-name>` (or rename after the fact with `git branch -m`).

**Naming:** pick a memorable distinct name. Personas from the feature's JTBD make good DELIVER worker names; for research/design/review, role-based names (e.g. `archivist`, `surveyor`, `umpire`) often read clearer. The worktree directory under `~/gt/<rig>/worktrees/` mirrors the worker name.

**Why not `gt crew add`?** In headless merge-queue mode (`gastown/references/headless-merge-queue.md`), the rig's `git_url` (GitHub) is **stale** relative to `local_repo` — refinery merges land local-only and are never pushed upstream. `gt crew add` clones from `git_url`, which means the worker workspace is missing every commit since the last GitHub push (often dozens). A `git worktree add` from `local_repo` is always at the user's current local main.

**Verify the worktree shows the work you expect:**

```bash
cd "$WORK"
git log --oneline -5            # should match `git log --oneline -5` in $LOCAL_REPO
ls <key-path-the-briefing-references>   # confirm directories the briefing mentions actually exist
```

If the briefing references a path that doesn't exist in the worktree, do NOT dispatch — fix the workspace first (likely `local_repo` doesn't have the work yet, or the rig's `local_repo` in `~/gt/rigs.json` points at the wrong checkout).

### Step 3 — Compose the prompt

```bash
mkdir -p ~/gt/<rig>/worktrees/<worker-name>/.logs
```

Write to `~/gt/<rig>/worktrees/<worker-name>/.logs/nw-<wave>-prompt.txt`. Use the base template below; overlay the wave-specific block.

**Base template (every wave).** The header line uses a plain imperative — *not* `/<wave>` — so the prompt survives even if the target skill is `user-invocable: false` (see Mental Model). The "Begin by invoking …" footer is the load-bearing instruction either way.

```text
<one-line plain imperative header — e.g. "Run the DELIVER wave for <slug> Phase <N>.">

Context:

- Branch: <branch-name> (push to origin/<branch-name> when committing).
- This workspace is a **git worktree** of the user's local checkout at
  ~/gt/<rig>/worktrees/<worker-name>/. Its `origin` points at `local_repo`
  (NOT GitHub) — push there so the refinery's clone can see the branch.
  Project conventions live in CLAUDE.md at the repo root — follow
  Conventional Commits (no Claude attribution lines).

- Saved feedback you MUST honor:
  * <copy applicable items from ~/.claude/projects/.../memory/MEMORY.md>

- nwave Iron Rule: NEVER modify a failing test to make it pass. After 3 failed
  attempts on any step, revert and escalate via clear failure output in the log.

<wave-specific block — see below>

Begin by invoking the nw-<wave> skill and following its orchestration.
# If the skill is user-invocable: false, replace the line above with:
#   Read the SKILL.md at <absolute-path-to-skill> and follow its orchestration.
```

**When `/nw-<wave>` IS safe as the header:** if the pre-flight grep confirms the skill is user-invocable (or omits the field — default true), you can lead with `/nw-<wave> <target>` and the slash command resolves cleanly. The footer imperative remains the load-bearing instruction; the slash line is convenience. When in doubt, prefer the plain-imperative form — it works for every wave, never short-circuits at turn 0.

**Wave-specific overlays** — pick the matching block:

<details>
<summary><b>nw-research / nw-discover</b></summary>

```text
- Question to investigate:
  "<one-paragraph framing — specific enough that an answer would settle a decision>"

- Scope: <bounded-set of sources / time horizon>

- Output: cited research doc at docs/research/<topic-kebab>.md. Use the nw-research
  skill's evidence-quality standards (cross-reference 2+ sources per claim, label
  speculation, link primary sources over secondary).

- When done: commit the doc on this branch, push, and submit via `gt mq submit` —
  surface the doc path in the final log so a human can review.
```

</details>

<details>
<summary><b>nw-discuss</b></summary>

```text
- Feature SSOT: docs/feature/<slug>/discuss/ (create if missing).
- Inputs:
  * Problem statement: <one-paragraph or link to DIVERGE output>
  * Stakeholders / personas: <list>

- Output: JTBD job stories, journey YAML in docs/product/journeys/<slug>.yaml,
  US-001..US-NNN stories with Given-When-Then AC, DoR checklist.

- Hard gate: nw-product-owner-reviewer must pass before handoff to DESIGN.
  Run the reviewer in the same session before closing.
```

</details>

<details>
<summary><b>nw-design</b></summary>

```text
- Feature SSOT: docs/feature/<slug>/design/ (create if missing).
- Inputs:
  * DISCUSS artifacts: docs/feature/<slug>/discuss/handoff-design.md
  * SSOT shared artifacts inventory: docs/product/architecture/brief.md

- Design scope: <application | system | full-stack | domain>
- Output: ADRs (numbered next available), C4 diagrams, application-architecture.md,
  system-architecture.md if system scope, wave-decisions.md, handoff-design-to-distill.md.

- Hard gate: nw-solution-architect-reviewer (or nw-system-designer-reviewer for
  system scope) must pass before handoff.
```

</details>

<details>
<summary><b>nw-distill</b></summary>

```text
- Feature SSOT: docs/feature/<slug>/distill/ (create if missing).
- Inputs:
  * DESIGN ratified ADRs: <list>
  * Stories: docs/feature/<slug>/discuss/stories/

- Output: RED acceptance tests under tests/acceptance/<slug>/, roadmap.json with
  N sequential steps, upstream-issues.md flagging HIGH-severity blockers.

- Carpaccio slicing: aim for 3–5 thin vertical slices each independently shippable.
- Walking-skeleton strategy: pick A/B/C/D per nw-distill skill guidance.

- Hard gate: nw-acceptance-designer-reviewer must pass.
```

</details>

<details>
<summary><b>nw-deliver</b></summary>

```text
- Feature: <slug>
- Roadmap: docs/feature/<slug>/distill/roadmap.json (<N> sequential steps).
- Phase 1 must resolve <upstream-issue-id> (<severity>) before any step runs.
  See docs/feature/<slug>/distill/upstream-issues.md.
- RED scaffolds:
  * tests/acceptance/<slug>/ — <framework + scenario count>
  * <other scaffolds>
- Ratified ADRs: <list with one-line summaries>

- Sequential DELIVER dispatch is REQUIRED (see saved memory): one crafter at a
  time, even when files don't overlap. Verify commit + integrity (test status,
  no theater) after each step before the next.

- When all <N> steps are committed and the walking skeleton + slice tests are
  green, run `gt mq submit` from this workspace. Do NOT push to main directly.
```

</details>

<details>
<summary><b>nw-review</b></summary>

```text
- Artifact under review: <path or git ref>
- Review dimensions: <e.g. "architecture: SPOF, scalability claims, trade-off analysis">
- Reviewer skill: <nw-solution-architect-reviewer | nw-system-designer-reviewer
  | nw-product-owner-reviewer | nw-acceptance-designer-reviewer | nw-software-crafter-reviewer | ...>

- Output: critique report graded A–F per dimension, with specific file:line citations.
  Save to docs/feature/<slug>/<wave>/review-<date>.md or docs/research/review-<topic>.md.

- This wave does NOT modify the artifact — it produces a report only. Surface the
  report path in the final log for human action.
```

</details>

<details>
<summary><b>nw-bugfix / nw-spike / nw-refactor / nw-document / nw-mikado / nw-hotspot</b></summary>

Follow the same pattern: state inputs, outputs, exit criteria. All waves hand off via `gt mq submit` — the refinery's `--auto` gate decides whether to run backend tests based on the diff (see Handoff section).

</details>

### Step 4 — Launch detached headless Claude

**Mechanics are identical regardless of wave.** Use `tmux` as the durability layer plus `stream-json` + `--verbose` for live event tracking.

**Critical context: where are you launching from?**

- **From a user terminal** (or a CI runner): `setsid bash -c "...claude -p..." &` works because nothing sweeps the new session.
- **From inside another Claude Code session** (you, right now, in 99% of cases): `setsid` is NOT enough. The parent Claude Code harness reaps descendant processes when the Bash-tool invocation ends, regardless of whether they're in a new session. Spawned `claude -p` workers die within minutes — the symptom is a final assistant block with `stop_reason: None` mid-tool-call, no `result` event, and `ps -p` empty. Use **`tmux`** to escape the harness's process tree entirely.

This project already runs a long-lived gastown-managed tmux server at `-L gt-0c0ae3` (keeps refinery/deacon/dogs alive). Hitch the worker onto it:

```bash
cd /home/node/gt/<rig>/worktrees/<worker-name>
WAVE=<wave-name>      # e.g. design, distill, deliver, review, research
SESSION=nw-${WAVE}-<worker-name>     # tmux session name; must be unique

# Compose the runner script (tmux's send-keys/new-session args are picky
# about quoting; using a file avoids the entire problem).
cat > .logs/nw-${WAVE}-run.sh <<EOF
#!/usr/bin/env bash
set -e
cd $(pwd)
cat .logs/nw-${WAVE}-prompt.txt \
  | claude -p \
      --dangerously-skip-permissions \
      --output-format stream-json \
      --verbose \
  > .logs/nw-${WAVE}.log 2>&1
EOF
chmod +x .logs/nw-${WAVE}-run.sh

# Launch inside the gastown tmux server. -d = detached, no attach.
tmux -L gt-0c0ae3 new-session -d -s "$SESSION" "./.logs/nw-${WAVE}-run.sh"

# Let it settle
sleep 3

# Capture the REAL claude PID (the only process owned by this tmux session
# whose cmd starts with 'claude -p')
REAL_PID=$(pgrep -f "^claude -p" -P "$(tmux -L gt-0c0ae3 list-panes -t "$SESSION" -F '#{pane_pid}')" 2>/dev/null | head -1)
[ -z "$REAL_PID" ] && REAL_PID=$(pgrep -f "^claude -p --dangerously-skip-permissions --output-format stream-json --verbose$" | head -1)
echo "$REAL_PID" > .logs/nw-${WAVE}.pid

# Extract session_id from the first system/init event in the log
SID=$(grep -oE '"session_id":"[^"]+"' .logs/nw-${WAVE}.log | head -1 | cut -d'"' -f4)
echo "$SID" > .logs/nw-${WAVE}.session_id
echo "$SESSION" > .logs/nw-${WAVE}.tmux

# Audit trail
echo "$(date -Iseconds) | pid=$REAL_PID sid=$SID tmux=$SESSION wave=$WAVE | dispatched" \
  >> .logs/nw-${WAVE}.history

ps -p "$REAL_PID" -o pid,etime,cmd | head -3
tmux -L gt-0c0ae3 list-sessions | grep "$SESSION"
```

**Why these flags:**

| Flag | Reason |
|---|---|
| `tmux -L gt-0c0ae3 new-session -d` | The hard durability boundary. tmux's server is the worker's new parent; it survives the harness's process sweep when your Bash-tool turn ends. `setsid` alone does not — harness reaping reaches across new sessions. |
| Runner script (`.logs/<wave>-run.sh`) | Sidesteps tmux argument-quoting hell. The script is committed to disk, easy to re-launch, and clearly auditable. |
| `--dangerously-skip-permissions` | Headless cannot prompt for permissions; without this it would block on every Bash/Edit. |
| `--output-format stream-json` | Streams every event in real time. `text` only writes the final result — useless for monitoring. |
| `--verbose` | Required by Claude Code when using `stream-json` in `-p` mode. |

**Pitfalls:**

- The runner script's `cd $(pwd)` is evaluated WHEN THE HERE-DOC IS WRITTEN. If you move the worktree or generate the script then `cd` elsewhere before launching, it'll break. Re-generate the script after any move.
- `pgrep -f "^claude -p"` (anchored) avoids matching your *own* bash command line, which is the trap the `setsid`-era recipe fell into.
- One tmux session per worker. If `$SESSION` collides with an existing session, `tmux new-session -d` errors out — pick a fresh name or `tmux kill-session -t "$SESSION"` first.

### Step 5 — Confirm session is alive

After ~30 seconds:

- PID still running (`ps -p $(cat .logs/nw-<wave>.pid)`)
- Log size > 0 and growing (`wc -c .logs/nw-<wave>.log`)
- Tool-call tally shows real activity (Read, Bash, TodoWrite, Skill at minimum)
- Last assistant text is sensible for the wave's onboarding step

## Monitoring Recipe

You are the watchdog — no Witness escalates stuck workers in headless mode. Poll the log file.

### Standard check-in (wave-agnostic)

```bash
WAVE=<wave-name>
WORK=~/gt/<rig>/worktrees/<worker-name>
PID=$(cat $WORK/.logs/nw-${WAVE}.pid)
LOG=$WORK/.logs/nw-${WAVE}.log

# 1. Alive?
ps -p "$PID" -o pid,etime,pcpu,rss,cmd | head -3

# 2. Log growth
wc -c "$LOG"

# 3. Tool-call tally
grep -oE '"name":"[A-Za-z_]+"' "$LOG" | sort | uniq -c | sort -rn | head -10

# 4. Last few assistant text snippets
grep -oE '"text":"[^"]{20,200}"' "$LOG" | tail -5 | sed 's/\\n/ /g' | cut -c1-250

# 5. Commits on this branch
cd $WORK && git log --oneline HEAD ^origin/main

# 6. Anything alarming
grep -iE '(iron rule|revert|blocker|error|escalat|3 failed)' "$LOG" | tail -10
```

### Scheduling

Use `ScheduleWakeup` for autonomous polling. Pick intervals around **20–30 minutes** (1200–1800s). Shorter intervals churn your conversation cache without buying signal; longer intervals miss failures.

**Avoid `delaySeconds: 300`** — worst of both worlds (cache miss without amortizing).

For pure-docs waves (research, design, review) that typically finish in 30–90 min, a tighter ~15-min interval (900s) is fine — they complete fast enough that one wakeup may catch the end.

### What to look for

| Signal | Meaning | Action |
|---|---|---|
| PID alive, log growing, recent tool calls | Healthy run | Schedule next check |
| PID alive, log stagnant > 5 min | Possibly stuck | Wait one more interval, then investigate |
| PID dead, log ends with "Failure" / "error" / non-zero result | Crashed | Inspect tail, decide restart vs escalate |
| PID dead, log ends with normal completion + commits on branch | Done | Proceed to handoff |
| "Iron Rule" / "3 failed attempts" / "revert" / "escalate" in log | Worker hit safety brake | Read context, surface to user — do not auto-resume |

## Handoff: every wave submits via the refinery

Every wave — code or docs — submits to the merge queue. The refinery's gate (`./tools/test/test.sh --auto`) is content-aware and skips tests when the diff is docs-only (see Choosing the Wave §"Single funnel through MQ"). This is the project's trunk-based workflow: there is no PR step; the MR (`gt mq submit` output) is the merge unit.

### Pre-submit checklist (production-code MRs)

If the diff touches anything outside the docs-only allowlist (`docs/**`, `.claude/skills/**`, `*.md`, etc.), run these locally before `gt mq submit` — the refinery's `--auto` gate falls through to `--backend` which runs ruff + pytest, but Bazel CI (lint, test-frontend, test-agent, test-auth-proxy, test-backend) runs post-merge and discovers structural issues only after the merge has landed:

1. **Workspace consistency** (sub-second; catches the topaz/coral regression pattern):
   ```bash
   python3 tools/check_workspace_consistency.py
   ```
   Verifies `pnpm-workspace.yaml`, `.bazelignore`, and `pnpm-lock.yaml` agree on every workspace package. If you added a new `package.json`, all three files must be updated together. The script's error messages include the exact remediation command.

2. **The full gate the refinery will run**:
   ```bash
   ./tools/test/test.sh --auto
   ```
   This runs the workspace consistency check (step 1 is now folded in) + backend lint + backend tests when code is touched. Docs-only diffs short-circuit.

3. **Service-specific tests if you touched those services** (the refinery's `--auto` gate runs ONLY the backend pytest; frontend/agent/auth-proxy/Bazel-lint tests fire post-merge in CI):
   ```bash
   cd agent && npx vitest run               # if you touched agent/
   cd frontend && npx vitest run            # if you touched frontend/
   cd ui-state && npx vitest run            # if you touched ui-state/
   bazel test //... --test_tag_filters=lint # if you touched any workspace structure
   ```

The first failure-simulation-consolidation DELIVER worker (topaz, MR-1) hit two structural regressions that required three follow-up MRs: pnpm-lock.yaml missing a workspace, .bazelignore missing a node_modules entry, and agent unit tests broken by a prior wave's substrate. The workspace consistency check catches the first two; running the service vitest suites catches the third. ~30s of pre-submit verification saves ~30 minutes of follow-up MQ-and-CI-noise.

### Submit

```bash
cd ~/gt/<rig>/worktrees/<worker-name>
git status                           # confirm clean
git log --oneline -5                 # spot-check
git remote -v                        # MUST show origin = local_repo, NOT GitHub
git push -u origin <branch>          # so refinery can find it
gt mq submit                         # auto-detects branch + rig from cwd
gt refinery queue                    # confirm MR enqueued
```

The Refinery rebases onto latest `main`, runs the rig's `merge_queue.test_command` (currently `./tools/test/test.sh --auto`), and merges on green. The `--auto` selector prints which path it took:

- `tools/test --auto: docs-only diff — skipping test gate` → instant merge after rebase.
- `tools/test --auto: code changes detected — running --backend` → full ruff + pytest gate.

Monitor:

```bash
gt refinery queue
gt mq status <mr-id>
```

**Do NOT use `gh pr create` from a worker.** This project is trunk-based; the MQ is the only entry point for landing work on `main`. If a change genuinely cannot be evaluated by the refinery and needs human review before landing, raise that with the project overseer as an out-of-band conversation — do not create a GitHub PR to force the review path.

## Cleanup After Merge

Teardown is **three steps**, not one. The worktree is the obvious bit; the Docker artifacts the worker session created during `docker compose up` are silent disk eaters that nothing else collects.

### 1. Remove the worktree

```bash
git worktree remove ~/gt/<rig>/worktrees/<worker-name> --force      # or omit --force if branch is clean
git branch -D crew/<worker-name>                                    # optional: delete the merged branch locally
```

Run these from inside `local_repo` (e.g. `/workspaces/dashboard-chat`). The merged branch survives in main's history; the worktree directory is disposable. If the worktree was abandoned (uncommitted changes), `git worktree remove --force` is required.

**Legacy crew workspaces** (created via `gt crew add` before this skill switched to worktrees): tear down with `gt crew remove <worker-name> --force` instead.

### 2. Remove worker-tagged Docker images

When a worker runs `docker compose up` without `COMPOSE_PROJECT_NAME` pinned, compose derives the project name from the workspace directory (e.g. `pyrite`, `mr5_dataset_ctx`, `rc1_deeplink`) and tags every locally-built image with that prefix — `pyrite-ui-state:latest`, `mr5_dataset_ctx-ui-state:latest`, etc. Removing the worktree does NOT clean these up; they sit in the local Docker daemon until something prunes them. A week of headless work can pile up 10–20GB this way.

**Note: we deliberately do NOT pin `COMPOSE_PROJECT_NAME=dashboard-chat` in workers.** Doing so makes worker `docker compose` commands operate on the *shared* dashboard-chat stack — including `docker rm` of the user's running services. This was the failure mode that killed RC-1 attempt 1 (see saved memory `feedback_headless_crew_compose_project_pin.md`). Teardown-time `docker rmi` is the safer cleanup point.

After removing the worktree, run:

```bash
# Remove every *-ui-state image that isn't the canonical dashboard-chat-ui-state.
# Mirror this for any other compose-built service that accumulates (api, agent, etc.)
docker rmi $(docker images --filter "reference=*-ui-state" --format '{{.Repository}}:{{.Tag}}' \
  | grep -v '^dashboard-chat-ui-state:') 2>/dev/null

# Sweep up any dangling images left behind (untagged layers from rebuilds)
docker image prune -f
```

For a periodic sweep across all worker-tagged images at once:

```bash
# Untag every image whose repo prefix isn't the canonical dashboard-chat* or a base image.
docker images --format '{{.Repository}}:{{.Tag}}' \
  | grep -E -- '-(ui-state|api|agent|auth-proxy|reverse-proxy|web-ssr):' \
  | grep -vE '^(dashboard-chat[-/]|<none>)' \
  | xargs -r docker rmi 2>/dev/null
docker image prune -f
```

### 3. Optional: prune the build cache

BuildKit's layer cache is **per-daemon, not per-project**, so successful rebuilds across all workers share it — but failed/abandoned builds leak orphan layers. After a long stretch of headless work, the cache can reach tens of GB without ever being load-bearing.

```bash
docker system df                # see what's reclaimable before deciding
docker builder prune -f         # prune the build cache (takes minutes)
```

Skip this when you're mid-iteration on the same Bazel/Docker targets — rebuilding from cold cache adds 5–10 min per service. Run it weekly, or when `docker system df` shows the build cache over ~20GB.

### 4. Stopped containers (any time)

`docker compose down` on a worker workspace leaves stopped containers behind. They cost very little (KB of writable layer) but pile up:

```bash
docker container prune -f
```

Safe to run any time — only removes containers in `Exited` state.

## Failure Modes & Recovery

### Headless session crashed early

```bash
tail -50 .logs/nw-<wave>.log
grep -iE '(error|exception|failure)' .logs/nw-<wave>.log | tail -10
```

Common causes:

- **Leading `/<wave>` rejected at the CLI layer** (turn-0 exit): symptom is a `result` event right after init with `duration_ms` under ~100, `num_turns: 0`, `result: ""`, and `total_cost_usd: 0`. No API call was billed. The prompt's first line referenced a slash command that doesn't resolve in this env — usually a `user-invocable: false` skill (e.g. `nw-finalize`) or a skill missing from the installed nwave-ai release. Fix: rewrite the prompt with a plain-imperative header and point at the skill's SKILL.md by path in the body. See Mental Model §"Two common ways this bites you" for the pre-flight grep.
- **Harness sweep killed it** (most common when launched from inside Claude Code without tmux): symptom is `stop_reason: None` on the final assistant block, mid-tool-call. The process is gone from `ps`. Diagnose by checking the final assistant message — if it was about to call a tool when it died, you got swept. Re-launch via tmux (see Step 4) and resume the session (see below).
- **Worktree is missing the work the briefing references** (e.g. directories that exist in `local_repo` are absent in the worktree): the worktree was added off a stale `main`, or the `local_repo` in `~/gt/rigs.json` points at the wrong checkout. Re-verify with `git log --oneline -5` in both the worktree and `local_repo` — they should match. If they don't, `git fetch && git reset --hard <local-repo>/main` inside the worktree, then re-check.
- **Worker created a `gt crew add` workspace by mistake (legacy recipe)**: symptom is `git remote -v` in the workspace showing the GitHub URL instead of `local_repo`, and `git log --oneline -5` lagging local main by many commits. Tear it down (`gt crew remove <worker> --force`) and switch to a worktree (Step 2).
- **JWKS / env mismatch**: the worktree shares the parent repo's tree at the moment of creation; environment files outside the repo do NOT come along. Per saved memory `feedback_env_profiles_outside_repo.md`, env files live at `~/.dashboard-chat/envs/`; symlink the right profile into the worktree if the wave needs it.
- **Out of tokens / rate limit**: log shows 429s. Pause and resume later. Note: `rate_limit_event` entries with `status: "allowed"` are advisory metadata, not the cause of death.
- **Skill not found**: confirm `nw-<wave>` appears in the global skills index. Run `claude` interactively and check for the skill if uncertain.

### Resuming a dead session (preserves all prior turns)

Claude Code persists every headless session's transcript to disk by default. If a worker dies — for any reason — you can resume it exactly where it left off, keeping all 30/50/100 turns of orientation and tool results. The model picks up with the full context, not from scratch.

```bash
cd ~/gt/<rig>/worktrees/<worker-name>
WAVE=<wave-name>
SID=$(cat .logs/nw-${WAVE}.session_id)
SESSION=nw-${WAVE}-<worker-name>-r1     # bump the suffix on each resume so tmux session names stay unique

# New runner that resumes the session. The prompt is just "Continue." —
# the session transcript already contains the full original task.
cat > .logs/nw-${WAVE}-resume.sh <<EOF
#!/usr/bin/env bash
set -e
cd $(pwd)
claude -p --resume "$SID" \
    --dangerously-skip-permissions \
    --output-format stream-json \
    --verbose \
    'Continue from where you left off. The previous session ended mid-tool-call due to external process termination; the work plan and context are preserved in this session.' \
  >> .logs/nw-${WAVE}.log 2>&1
EOF
chmod +x .logs/nw-${WAVE}-resume.sh

tmux -L gt-0c0ae3 new-session -d -s "$SESSION" "./.logs/nw-${WAVE}-resume.sh"
sleep 3

# Capture the new PID
NEW_PID=$(pgrep -f "^claude -p --resume" | head -1)
echo "$NEW_PID" > .logs/nw-${WAVE}.pid
echo "$(date -Iseconds) | pid=$NEW_PID sid=$SID tmux=$SESSION wave=$WAVE | resumed" \
  >> .logs/nw-${WAVE}.history
```

The session_id stays the same across resumes — Claude appends to the same transcript. The `.log` file gets appended too (`>>`, not `>`), so monitoring keeps working.

If you'd rather start fresh on a new session (e.g. the orientation went badly): just re-run the original Step 4 launch with a fresh prompt — no `--resume`.

### Session hangs (no progress, no exit)

### Session hangs (no progress, no exit)

```bash
grep -oE '"name":"[A-Za-z_]+","input":[^}]+' .logs/nw-<wave>.log | tail -3
```

If wedged on a real tool call (e.g. blocking subprocess), `kill -TERM <pid>` and investigate. Don't restart blindly — figure out why it stalled first.

### Wrong PID captured

The bash wrapper is shorter-lived than the claude binary. Always re-resolve:

```bash
pgrep -af '^claude -p' | head -3
```

The line WITHOUT `bash -c` is the real claude. Update `.logs/nw-<wave>.pid` accordingly.

### MQ rejects the MR (code waves only)

Check the rig's test command:

```bash
cat ~/gt/<rig>/settings/config.json | jq '.merge_queue.test_command'
```

Run that locally in the worker's worktree to reproduce. Fix, commit, re-`gt mq submit`. Do NOT bypass the gate (`--no-verify`, `--skip-deps`) without explicit user instruction.

## Cost & Token Considerations

A headless session has **its own token budget**, billed separately from your conversation. Wave-specific rough ranges (subject to scope):

| Wave | Typical token burn | Why |
|---|---|---|
| nw-research / nw-hotspot | Low (~30–100k tokens) | Read-heavy, narrow output |
| nw-discuss / nw-review | Medium (~100–300k) | Multiple sub-agents, structured output |
| nw-design | Medium (~150–400k) | ADR drafting + reviewer loop |
| nw-distill | Medium-High (~200–500k) | Many test scenarios, RED scaffolds |
| nw-deliver | **High (~1–5M+)** | Multi-step TDD with crafter/reviewer cycles, can run hours |
| nw-bugfix / nw-spike | Low-Medium (~50–300k) | Bounded scope |

Surface the cost expectation to the user before launching expensive waves.

## Quick Reference

```bash
# 1. Engine (idempotent, run from ~/gt/<rig>/)
cd ~/gt/<rig>
gt dolt start && gt refinery start <rig>

# 2. Worktree from local_repo (NOT `gt crew add` — that clones stale GitHub)
LOCAL_REPO=$(jq -r ".rigs.\"<rig>\".local_repo" ~/gt/rigs.json)
WORK=~/gt/<rig>/worktrees/<worker>
mkdir -p ~/gt/<rig>/worktrees
cd "$LOCAL_REPO"
git worktree add "$WORK" -b crew/<worker> main
cd "$WORK"
git remote set-url origin "$LOCAL_REPO"   # so push lands where refinery can see it
git log --oneline -3                       # sanity: matches local main
# Use a non-`crew/` branch prefix for non-DELIVER waves if your wave table says so

# 3. Compose prompt
mkdir -p .logs
$EDITOR .logs/nw-<wave>-prompt.txt    # base template + wave-specific overlay

# 4. Dispatch detached (tmux — required when launched from inside Claude Code)
WAVE=<wave>
SESSION=nw-${WAVE}-<worker>
cat > .logs/nw-${WAVE}-run.sh <<EOF
#!/usr/bin/env bash
set -e
cd $(pwd)
cat .logs/nw-${WAVE}-prompt.txt | claude -p \
  --dangerously-skip-permissions --output-format stream-json --verbose \
  > .logs/nw-${WAVE}.log 2>&1
EOF
chmod +x .logs/nw-${WAVE}-run.sh
tmux -L gt-0c0ae3 new-session -d -s "$SESSION" "./.logs/nw-${WAVE}-run.sh"
sleep 3
pgrep -f "^claude -p --dangerously-skip-permissions" | head -1 \
  > .logs/nw-${WAVE}.pid
grep -oE '"session_id":"[^"]+"' .logs/nw-${WAVE}.log | head -1 \
  | cut -d'"' -f4 > .logs/nw-${WAVE}.session_id

# 5. Monitor
ps -p $(cat .logs/nw-${WAVE}.pid) -o pid,etime,pcpu,cmd
tmux -L gt-0c0ae3 list-sessions | grep $SESSION

# 6. Resume if it died (preserves all prior turns)
SID=$(cat .logs/nw-${WAVE}.session_id)
tmux -L gt-0c0ae3 new-session -d -s "${SESSION}-r1" \
  "claude -p --resume $SID --dangerously-skip-permissions \
   --output-format stream-json --verbose 'Continue.' \
   >> .logs/nw-${WAVE}.log 2>&1"

# 7. Handoff — every wave goes through MQ; refinery's --auto gate
#    self-classifies docs-only vs code and skips backend tests for docs.
git push -u origin <branch>
gt mq submit

# 8. After landing — three-step teardown
tmux -L gt-0c0ae3 kill-session -t "$SESSION" 2>/dev/null
cd "$LOCAL_REPO" && git worktree remove "$WORK" --force
git branch -D crew/<worker>   # optional: clean up the merged branch locally

# Worker-tagged docker images do NOT get cleaned by `git worktree remove` —
# COMPOSE_PROJECT_NAME defaults to the worktree dir name and tags every built image.
docker rmi $(docker images --filter "reference=*-ui-state" --format '{{.Repository}}:{{.Tag}}' \
  | grep -v '^dashboard-chat-ui-state:') 2>/dev/null
docker image prune -f
docker container prune -f

# Heavy sweep (run weekly or when `docker system df` shows builder cache >20GB):
# docker builder prune -f
```
