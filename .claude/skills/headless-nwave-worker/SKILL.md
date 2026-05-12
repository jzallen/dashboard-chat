---
name: headless-nwave-worker
description: Use when the user wants to dispatch ANY long-running nwave-ai wave (nw-research, nw-discuss, nw-design, nw-distill, nw-deliver, nw-review, nw-bugfix, nw-spike, nw-refactor, nw-document, nw-mikado, nw-hotspot, etc.) as a detached headless Claude process inside a gastown crew workspace, optionally submitting code work to the headless merge queue. Triggers — "headless <wave>", "dispatch <wave>", "spin up a <wave> worker", "crew <wave> worker", "background nw-<wave>", "send /nw-<wave> to a headless session", "run <wave> in a crew", any phrasing combining a wave name with "headless" or "crew worker" or "MQ submit", and the historical alias "headless deliver worker".
---

# Headless nWave Worker (gastown crew + optional MQ submission)

## Overview

Recipe for dispatching any nwave-ai wave (`nw-*` skill) as a **detached headless Claude process** running inside a **gastown crew workspace** on its own branch. When the wave produces code that needs validation, the worker submits via the **headless merge queue**. When the wave produces documents only (research, design, review), the worker commits to its branch for human-driven PR or direct merge.

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

**`/nw-<wave>` is a SKILL NAME, not a slash-command file.** There is no `~/.claude/commands/nw-deliver.md`. nwave-ai installs skills at `~/.claude/skills/nw-*/` and `~/.local/share/uv/tools/nwave-ai/.../skills/nw-*/`. Claude Code's interactive UI recognizes `/<skill-name>` as a Skill invocation. Headless Claude (`claude -p '<prompt>'`) has **no slash-command UI**, but the model still has the Skill tool and every installed skill is loadable by name.

**Implication:** the prompt to the headless session must explicitly instruct the model to invoke the skill by name (e.g. "Begin by invoking the nw-design skill"). Leading the prompt with `/nw-<wave> <slug>` is fine as a header — the model treats it as an instruction — but the imperative must also appear in the body so it can't be missed.

## Choosing the Wave

| Wave | Typical inputs | Typical outputs | Needs MQ submit? | Branch strategy |
|---|---|---|---|---|
| `nw-discover` | None | Discovery report, evidence inventory | No | `research/<slug>` or `discover/<slug>` |
| `nw-research` | Question / topic | Cited research doc in `docs/research/` | No | `research/<slug>` |
| `nw-diverge` | Validated problem | 3–5 design directions in `docs/feature/<slug>/diverge/` | No | `discuss/<slug>` |
| `nw-discuss` | Stories (or obvious) | JTBD job stories, journeys, BDD AC, US-* in `docs/feature/<slug>/discuss/` | No | `discuss/<slug>` |
| `nw-design` | Discuss artifacts | ADRs, C4 diagrams, `application-architecture.md`, `system-architecture.md` | No | `design/<slug>` |
| `nw-distill` | Design ratified | RED acceptance tests, `roadmap.json` | No (artifacts) | `distill/<slug>` |
| `nw-spike` | Hypothesis | Probe report + optional walking skeleton | Yes if walking skeleton committed | `spike/<slug>` |
| `nw-deliver` | DISTILL roadmap | Implementation code, all commits green | **Yes** | `crew/<worker>` |
| `nw-bugfix` | Bug report | Regression test + fix | **Yes** | `fix/<slug>` |
| `nw-refactor` | RPP target | Refactor-only code changes | **Yes** | `refactor/<slug>` |
| `nw-review` | Artifact to review | Critique report (graded) | No | `review/<slug>` or comment-only |
| `nw-hotspot` | Git history | Hotspot map / churn analysis | No | `research/<slug>` |
| `nw-document` | Feature artifacts | DIVIO/Diataxis docs | No (artifacts) | `docs/<slug>` |
| `nw-mikado` | Refactor target | Mikado roadmap + visual tracking | Eventually yes (per phase) | `refactor/<slug>` |
| `nw-finalize` | All waves complete | Archive to `docs/evolution/` | No | `finalize/<slug>` |
| `nw-mutation-test` | Implementation done | Mutation kill-rate report | No | `mutation/<slug>` |

**Rule of thumb for MQ:**

- Wave produces **code** that should pass the test gate → submit via `gt mq submit`.
- Wave produces **docs / artifacts only** → commit on branch, push, open PR for human review (or merge directly on trusted research branches per project policy).
- When in doubt: never bypass the test gate for code changes; never put docs through the MQ unless they include code that should be tested.

## Prerequisites

### General (every wave)

1. **Headless gastown engine running** (see gastown skill's `references/headless-merge-queue.md`):
   - `gt dolt status` → running on :3307
   - For MQ-bound waves: `gt refinery status` → running for the rig
   - For docs-only waves: refinery is optional but harmless.
2. **Rig registered in `~/gt/rigs.json`** with `local_repo` pointing at the user's checkout.
3. **Project `.claude/` accessible inside the crew clone** — gt's `crew add` clones the repo; project skills/agents live in `.claude/` and are automatically present.
4. **Saved memory consulted** — especially feedback memories that constrain this wave (e.g. `feedback_sequential_deliver_dispatch.md`).

### Wave-specific (verify before dispatch)

| Wave | Required input artifacts |
|---|---|
| nw-research / nw-discover | A specific, non-trivial question. Bad: "research auth". Good: "evaluate Remix vs Next.js App Router for our flow-state tier given ADR-027 constraints." |
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

### Step 2 — Create crew workspace

```bash
gt crew add <worker-name> --branch       # creates ~/gt/<rig>/crew/<worker-name>/
                                          # initial branch: crew/<worker-name>
gt crew list
```

For non-DELIVER waves, rename the branch to match the strategy in the wave table:

```bash
cd ~/gt/<rig>/crew/<worker-name>
git branch -m crew/<worker-name> <branch-strategy>/<slug>
```

**Naming:** pick a memorable distinct name. Personas from the feature's JTBD make good DELIVER crew names; for research/design/review, role-based names (e.g. `archivist`, `surveyor`, `umpire`) often read clearer.

### Step 3 — Compose the prompt

```bash
mkdir -p ~/gt/<rig>/crew/<worker-name>/.logs
```

Write to `~/gt/<rig>/crew/<worker-name>/.logs/nw-<wave>-prompt.txt`. Use the base template below; overlay the wave-specific block.

**Base template (every wave):**

```text
/nw-<wave> <feature-slug-or-target>

Context:

- Branch: <branch-name> (push to origin/<branch-name> when committing).
- This workspace is the gastown crew workspace `<worker-name>` at
  ~/gt/<rig>/crew/<worker-name>/. Project conventions live in CLAUDE.md at
  the repo root — follow Conventional Commits (no Claude attribution lines).

- Saved feedback you MUST honor:
  * <copy applicable items from ~/.claude/projects/.../memory/MEMORY.md>

- nwave Iron Rule: NEVER modify a failing test to make it pass. After 3 failed
  attempts on any step, revert and escalate via clear failure output in the log.

<wave-specific block — see below>

Begin by invoking the nw-<wave> skill and following its orchestration.
```

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

- When done: commit the doc on this branch, push, do NOT open a PR yourself —
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

Follow the same pattern: state inputs, outputs, exit criteria, and whether the wave commits code (→ MQ submit) or docs only (→ branch push for PR).

</details>

### Step 4 — Launch detached headless Claude

**Mechanics are identical regardless of wave.** Use `setsid` + `stream-json` + `--verbose` for proper detachment and live event tracking.

```bash
cd /home/node/gt/<rig>/crew/<worker-name>
WAVE=<wave-name>      # e.g. design, distill, deliver, review, research
setsid bash -c "cat .logs/nw-${WAVE}-prompt.txt \
  | claude -p \
      --dangerously-skip-permissions \
      --output-format stream-json \
      --verbose \
  > .logs/nw-${WAVE}.log 2>&1" \
  </dev/null >/dev/null 2>&1 &

# Capture the REAL claude PID (not the bash wrapper)
sleep 3
REAL_PID=$(pgrep -f "claude -p --dangerously-skip-permissions --output-format stream-json" | head -1)
echo "$REAL_PID" > .logs/nw-${WAVE}.pid

# Extract session_id from the init event
SID=$(grep -oE '"session_id":"[^"]+"' .logs/nw-${WAVE}.log | head -1 | cut -d'"' -f4)
echo "$SID" > .logs/nw-${WAVE}.session_id

# Audit trail
echo "$(date -Iseconds) | pid=$REAL_PID sid=$SID wave=$WAVE | dispatched" \
  >> .logs/nw-${WAVE}.history

ps -p "$REAL_PID" -o pid,etime,cmd | head -3
```

**Why these flags:**

| Flag | Reason |
|---|---|
| `setsid` | Fully detaches from controlling terminal; survives parent shell exit. `nohup &` alone can leave the process tied to harness PIDs. |
| `--dangerously-skip-permissions` | Headless cannot prompt for permissions; without this it would block on every Bash/Edit. |
| `--output-format stream-json` | Streams every event in real time. `text` only writes the final result — useless for monitoring. |
| `--verbose` | Required by Claude Code when using `stream-json` in `-p` mode. |
| `</dev/null` | Detaches stdin so the wrapper bash doesn't keep the harness Bash tool alive. |

**Pitfall**: the first `$!` from `bash -c '...' &` captures the *bash wrapper PID*, not the claude binary. Always re-resolve via `pgrep -f 'claude -p --output-format stream-json'` after a 2–3 second settle.

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
WORK=~/gt/<rig>/crew/<worker-name>
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

## Handoff: MQ Submit vs Direct Commit

### Code-producing waves (deliver, bugfix, refactor, spike-with-skeleton)

```bash
cd ~/gt/<rig>/crew/<worker-name>
git status                           # confirm clean
git log --oneline -5                 # spot-check
git push -u origin <branch>          # so refinery can find it
gt mq submit                         # auto-detects branch + rig from cwd
gt refinery queue                    # confirm MR enqueued
```

The Refinery rebases onto latest `main`, runs the rig's `merge_queue.test_command` (currently `./tools/test/test.sh --backend`), and merges on green. Monitor:

```bash
gt refinery queue
gt mq status <mr-id>
```

### Docs-only waves (research, discuss, design, distill, review, hotspot, document)

```bash
cd ~/gt/<rig>/crew/<worker-name>
git status
git log --oneline -5
git push -u origin <branch>
# Then EITHER open a PR for human review:
gh pr create --title "..." --body "..."
# OR (for trusted research branches per project policy) merge directly:
# This is human-driven — don't auto-merge from the skill.
```

**Never put docs through `gt mq submit`** unless the docs include code changes that should pass the test gate.

## Cleanup After Merge / PR Closure

Per saved memory feedback, remove the crew workspace once the work has landed:

```bash
gt crew remove <worker-name> --force
```

Full git clones in `~/gt/<rig>/crew/` accumulate fast. The merged branch survives in `origin/main`'s history; the local crew clone is disposable.

## Failure Modes & Recovery

### Headless session crashed early

```bash
tail -50 .logs/nw-<wave>.log
grep -iE '(error|exception|failure)' .logs/nw-<wave>.log | tail -10
```

Common causes:

- **Missing project `.claude/` in crew clone**: `gt crew add` clones the repo (full clone, not worktree), which should bring `.claude/` along. Verify with `ls .claude/skills/`. If missing, the crew was created against the wrong remote — check `git remote -v` in the crew dir.
- **JWKS / env mismatch**: crew clones may need `.env` symlinked or copied from the user's primary checkout if the wave needs env-dependent tooling. Per saved memory `feedback_env_profiles_outside_repo.md`, env files live at `~/.dashboard-chat/envs/`; symlink the right profile into the crew clone if needed.
- **Out of tokens / rate limit**: log shows 429s. Pause and resume later.
- **Skill not found**: confirm `nw-<wave>` appears in the global skills index. Run `claude` interactively and check for the skill if uncertain.

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

Run that locally in the crew workspace to reproduce. Fix, commit, re-`gt mq submit`. Do NOT bypass the gate (`--no-verify`, `--skip-deps`) without explicit user instruction.

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

# 2. Crew workspace
gt crew add <worker> --branch
cd ~/gt/<rig>/crew/<worker>
# Rename branch to wave-appropriate strategy if not deliver:
# git branch -m crew/<worker> <branch-strategy>/<slug>

# 3. Compose prompt
mkdir -p .logs
$EDITOR .logs/nw-<wave>-prompt.txt    # base template + wave-specific overlay

# 4. Dispatch detached
WAVE=<wave>
setsid bash -c "cat .logs/nw-${WAVE}-prompt.txt | claude -p \
  --dangerously-skip-permissions --output-format stream-json --verbose \
  > .logs/nw-${WAVE}.log 2>&1" </dev/null >/dev/null 2>&1 &
sleep 3
echo $(pgrep -f 'claude -p --output-format stream-json' | head -1) > .logs/nw-${WAVE}.pid

# 5. Monitor
ps -p $(cat .logs/nw-${WAVE}.pid) -o pid,etime,pcpu,cmd

# 6. Handoff (pick one)
git push -u origin <branch>
gt mq submit                          # code waves
# OR
gh pr create --title "..." --body "..."  # docs waves

# 7. After landing
gt crew remove <worker> --force
```
