# Acceptance criteria as a checklist (not grandchild issues)

We map the **test interface first, then implement** — the same discipline that drove
the cyrus build. The spec lives as a **markdown checklist in the work sub-issue's
description**, NOT as a separate level of grandchild "test case" issues. Each checkbox
is a test the builder writes test-first as an **atomic commit**.

> Earlier drafts of this workflow used grandchild issues (one per test case). That was
> dropped 2026-06-15: it's heavier, clutters the tree, and an AC checklist in the work
> issue is the SSOT the builder reads anyway. Two issue levels, not three.

## The two issue levels

```
Orchestrator issue (story)          wave:distill — decomposes, writes NO code
  └ Work sub-issue                  wave:deliver — one PR; AC checklist = the tests
       Acceptance Criteria
       - [ ] test 1  → atomic commit
       - [ ] test 2  → atomic commit
```

- The **orchestrator** (distill / coordinator tools) reads the real code and creates
  work sub-issues. It does not write tests or code.
- Each **work sub-issue** carries the AC checklist. The **builder** (deliver) makes
  each checkbox green test-first, one atomic commit per item, in one PR.

## What a good work sub-issue looks like

The orchestrator should produce sub-issues in this shape (DC-6 is the exemplar):

- **PR target branch** stated (`feature/<slug>`, not `main`).
- **Objective** — tightly scoped; explicitly list what is already built and must NOT
  be re-implemented.
- **Context** — the **driving port** (entry point the behavior is exercised through),
  the **reference pattern** to mirror, and any **design tension** called out as a
  named hazard (so it becomes a guarded requirement, not a trap the builder falls in).
- **Acceptance Criteria** — the checklist. Each item:
  - is **port-to-port**: names the driving port the behavior is exercised through
    (makes Tested-But-Unwired defects structurally impossible);
  - covers **error/edge paths**, not just the happy path (rollback-on-failure, guards,
    no-op cases, unaffected kinds);
  - says *what to assert*, concretely enough to write the test from.
- **Dependencies** — Linear "blocked by" links or "none".
- **Technical Notes** — exact files, the run command (`cd ui && npx vitest run …`),
  and a verification block (commands + expected outcomes + the diff to review).

## distill → deliver rhythm

1. **`wave:distill` (orchestrator).** Decompose the story into work sub-issues with AC
   checklists. Read-only (coordinator tools — can't write code). Output is the
   *interface*, fully enumerated as checkboxes, validated against the real codebase
   (so already-built ACs aren't re-specced).
2. **`wave:deliver` (builder).** Implement the checklist **test-first**: for each
   checkbox, write the failing test, make it green, one atomic commit (`test(scope):
   … ` / `feat(scope): …`). Open the PR into the feature branch.

## Atomic-commit discipline

- **One checkbox → one atomic commit** (test + the code that greens it land together,
  self-contained and bisectable).
- The PR diff reads as a sequence of "spec item → satisfied."
- No grandchild issues, no extra branches — the story branch is the only branch under
  the feature branch.

## Iron Rule (unchanged)

The checklist is the **spec**. A deliver session may **not** weaken or delete a
checkbox to go green. If an item can't be made green within the sub-issue, leave it
unchecked and the PR stays in review / the sub-issue stays open. After 3 failed
attempts on one item, revert and escalate (mark the sub-issue `needs-human`).

## RED→GREEN tracking & labels

- The work sub-issue's checklist is the live RED→GREEN view; checkboxes tick as the
  atomic commits land (the builder can check them via the PR / on completion).
- **`test:unit` / `test:integration`** are now *optional descriptors on the work
  sub-issue* indicating which test types its checklist contains — handy for filtering,
  but no longer a separate issue level. Applying both (like DC-6) is fine.
