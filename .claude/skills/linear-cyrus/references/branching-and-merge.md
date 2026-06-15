# Branching, gates, and merge

## The two-level branch model

```
main
 └── feature/<slug>            ← Project (long-lived integration branch for one feature)
      ├── <issue-id>-<slug>    ← story sub-issue (cyrus worktree branch)
      │     · commit  (test case A)   ← grandchild = ONE atomic commit, no branch
      │     · commit  (test case B)
      │     └─ PR ──────────────────► merges INTO feature/<slug>   [slice CI gate]
      └── <issue-id>-<slug>    ← another story (may run in parallel)
            └─ PR ────────────────► merges INTO feature/<slug>
 feature/<slug> ── PR ─────────────► merges INTO main             [full gate]
```

**Branches exist at exactly two levels:** the project's `feature/<slug>` and a
per-story branch. **Test-case grandchildren never get a branch** — each becomes one
atomic commit on the story branch, message referencing its grandchild issue id
(e.g. `test(rename): reject blank name (dc-124)`). This keeps the test → implement
RED→GREEN history legible inside the PR and lets Linear close the grandchild via a
magic word in that commit.

## Where the gates run

| Merge | Gate | Why here |
|---|---|---|
| story PR → `feature/<slug>` | **slice CI** — subtree-aware `test.sh --auto` on the changed `area:*` | fast feedback per story; the feature branch stays green as sub-issues complete |
| `feature/<slug>` → `main` | **full gate** — broader suite / integration + acceptance for the feature | one place to catch cross-story interactions before they hit trunk |

This is the replacement for the retired refinery gate. The refinery used to run
`test.sh --auto` before a local-only merge; now **PR-triggered CI** runs it and
Linear shows the result in the PR's **checks** column, so an approver sees green
before merging from the diff view.

> **Setup follow-up (not yet built):** a GitHub Actions workflow that runs
> `test.sh --auto` on PRs into `feature/**` and a fuller run on PRs into `main`.
> Until that exists, the green signal must come from the cyrus session running the
> suite before it opens a non-draft PR. Track this as its own issue.

## Status automation (free, via the GitHub integration)

Branch names carry the Linear issue id (use **Copy git branch name**:
`<issue-id>-<slug>`), so:

- branch created → **In Progress**
- PR opened → **In Review**
- PR merged → **Done**

Works regardless of PR base, so story PRs targeting `feature/<slug>` still drive the
sub-issue's status. The feature branch's own PR into `main` drives the Project to
done when merged.

## Review in Linear

PRs surface in Linear with changed files, checks, and comments kept in sync with
GitHub ([diffs](https://linear.app/docs/diffs)): unified/split views, inline comments,
and **approve + merge directly from Linear**. This is the coordination surface that
justified dropping the local-only refinery model.

## cyrus `baseBranch` caveat (important)

cyrus's `baseBranch` is configured **per-repository, not per-project**, and its
worktree is cut from that base. To get per-project feature branches, the deliver
session must branch off / target `feature/<slug>` rather than `main`. Options:

1. **Instruct in-context (preferred):** the project doc / issue template states the
   feature branch name and tells the session to base its branch on it and open the PR
   **into** `feature/<slug>`. The agent sets the PR base accordingly.
2. **Retarget after the fact:** let cyrus base on `main`, then change the PR base to
   `feature/<slug>` in GitHub/Linear. Cheap but manual.

Create `feature/<slug>` **before** delegating the first story of a project (a
project-kickoff step), so every story branch has a base to target.
