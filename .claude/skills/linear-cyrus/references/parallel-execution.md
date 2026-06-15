# Parallelizing independent stories

The feature-branch model is built for concurrency: many story branches can target the
same `feature/<slug>` at once, each in its own cyrus worktree. The constraint is **not**
the tooling — cyrus isolates every session — it's **story independence**. Slice and
sequence stories so independent ones can run together and dependent ones can't collide.

## When two stories are parallel-safe

Both must hold:

1. **Disjoint code surface.** They don't edit the same files/modules. Different
   `area:*` labels are a strong proxy (`area:frontend` vs `area:backend` rarely
   collide); two `area:frontend` stories need a closer look at which components/files
   each touches.
2. **No data/contract dependency.** Neither needs the other's output — no shared new
   API contract, schema/migration, type, or fixture that one defines and the other
   consumes.

If both hold, fire them as concurrent `@dashboard-chat` delegations. They produce
independent PRs into the feature branch; merge them in completion order (later merges
rebase on the now-advanced feature branch; CI re-runs on each merge).

## Encoding dependencies in Linear

- Use Linear **"blocked by" / "blocks"** relations for genuine ordering. Anything **not**
  in a blocking chain is a candidate for the parallel batch.
- A clean read: open the milestone, group ready stories by `area:*`, drop any with an
  open "blocked by" — what remains is your concurrent batch.
- Prefer **slicing stories along subtree/area lines** so parallel sessions touch
  disjoint files by construction. A story that spans many areas is both hard to
  parallelize and hard to review — split it.

## Distill-first de-risks parallelism

Running the `wave:distill` (test-first) pass on candidate stories **before**
parallelizing reveals shared interfaces: if two stories' test-case grandchildren
reference the same new type, contract, or fixture, they share a dependency — sequence
them (the one defining it first) instead of running them together.

## Collision handling

- The **feature branch is the integration point.** If two parallel stories do touch
  overlapping code, the second PR to merge hits a conflict or a red slice gate there —
  caught before `main`, never on trunk.
- Keep parallel WIP to the count of genuinely independent ready stories. More sessions
  than that just manufactures merge conflicts on the feature branch.
- If a conflict appears, resolve it in the **trailing** story's session (re-delegate
  with a note to rebase onto the updated feature branch) rather than the merged one.

## Rule of thumb

> Parallelize across `area:*`, sequence within shared contracts. Let the feature
> branch + slice CI be the safety net, not the plan.
