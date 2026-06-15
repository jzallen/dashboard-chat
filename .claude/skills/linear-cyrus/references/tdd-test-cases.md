# TDD: test cases as grandchild issues

We build by mapping the **test interface first**, then implementing against it — the
same discipline that drove the cyrus build. Linear encodes it as a tree.

## The hierarchy

```
Story (sub-issue)               ← one build unit, one PR
  ├── [unit] rejects blank name        (grandchild = test case)
  ├── [unit] repoints 6 warehouse sites
  └── [integration] rename persists + writes audit entry
```

- A grandchild's **description is the spec fragment** — Given-When-Then, or the test
  signature plus the assertion. It is the precise, checkable contract the deliver
  session must satisfy.
- Each grandchild closes when its test goes green, via a magic word in the atomic
  commit that makes it pass (e.g. `... reject blank name (dc-124)`). The story's
  sub-issue completion bar in Linear then reads as the **passing-test count** — a live
  RED→GREEN tracker.

## Two-session rhythm per story

1. **`wave:distill` (test-first).** Delegate the story → cyrus writes the *failing*
   tests and creates/fills the test-case grandchildren. RED, no production code, so
   it's safe to run freely. This step also **surfaces shared interfaces** between
   stories — useful input for parallelization (see `parallel-execution.md`).
2. **`wave:deliver`.** Delegate the story again → cyrus reads the grandchildren as the
   acceptance spec, implements until green with **one atomic commit per test case**,
   opens the PR into the feature branch.

## Atomic-commit discipline

- **One commit per grandchild.** A test case is a commit, not a branch — the RED test
  and the code that greens it land together (or test-then-green as two commits is fine,
  but keep each test case's work self-contained and bisectable).
- Commit subject references the grandchild id so Linear links and closes it.
- This keeps the PR diff readable as a sequence of "spec → satisfied," and keeps the
  story branch the only branch beneath the feature branch.

## Iron Rule (unchanged)

The grandchildren are the **spec**. A deliver session may **not** weaken or delete a
test case to go green. If a test case can't be made green within the slice, its
grandchild stays **open** → the story can't be Done → the milestone can't complete.
The tree enforces the discipline. After 3 failed attempts on a test, revert and
escalate (mark the story `needs-human`).
