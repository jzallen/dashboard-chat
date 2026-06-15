---
name: docstrings
description: Use when writing or editing comments and docstrings in this repo — choosing between a docstring and an inline comment, what belongs in one, and what must never appear in code prose. Triggers: "docstring", "comment", "document this function", "explain this code", "clean up comments", code review feedback on comments.
---

# Docstrings & comments

How we write code prose in this repo. The rule of thumb: **a reader six months
from now, with no access to the ticket or the PR, should understand the code from
the code.** Comments explain the code as it is — not the story of how it got there.

## Reach for a docstring first

Prefer a well-formed docstring on the **module, class, or function** over inline
comments. The docstring carries intent, behavior, and contract; the signature
carries the shape. Reach for an inline comment only for a genuinely non-obvious
**local** detail (a workaround, a subtle ordering constraint, a spec quirk).

- **Python** — module/class/function docstrings (`"""..."""`).
- **TypeScript/JS** — `/** ... */` JSDoc above the export. (JS has no docstring
  syntax, so a JSDoc block is the equivalent — use it, not a stack of `//` lines.)

A docstring says **what** the thing is for and **why** it behaves as it does:

```ts
/**
 * Fetch the org-global payloads server-side so the chrome renders with real
 * data in the initial document rather than fetching after hydration. An
 * unauthenticated (401) response becomes a redirect to /login rather than a
 * client-surfaced error.
 */
export async function loader({ request }: LoaderFunctionArgs) { ... }
```

## Don't narrate code with a comment diary

Let the code carry the mechanics. Avoid a running play-by-play of `// now we do
X`, `// then Y`. If a block needs that much narration, it usually wants a name (a
helper function or a well-named local) more than it wants a comment.

In **tests**, the test *is* the spec: the `describe`/`it` names and the assertions
state the behavior. Drop `// Behavior 1:` / `// Step 2:` scaffolding and write the
expectation as a clear `it("...")` description instead.

## Never put process or ticket trails in code prose

Code prose is timeless; these are not. Keep them in git history, the PR, and the
linked issue — never in comments, docstrings, or test names:

- **No issue / ticket IDs** (e.g. `DC-27`), **branch names**, or **PR numbers**.
  The branch and PR are already linked to the issue.
- **No "decision #N"** or other references to planning artifacts. State the
  *reason* directly instead of pointing at where it was decided.
- **No migration play-by-play** — `// replaces the old clientLoader path`,
  `// was RED before DC-26`, `// new in this PR`. Describe what the code does now.
- **No attribution or change narration** — `// added by`, `// changed to fix`.

Rewrite a reference into the reason it stands for:

```ts
// ✗ AC3 (decision #2): keep shouldRevalidate false (old refreshOrgGlobal memo).
// ✓ Org-global data doesn't change with navigation, so the loader runs once
//   per document load and is never revalidated.
```

## When a "why now" genuinely matters

If a non-obvious constraint drove the design, state the *constraint*, not the
ticket — it's the part that stays true:

```ts
// Node env (not happy-dom): the loader forwards the inbound `cookie`, a
// forbidden header a browser environment strips from a Request.
```

## Agent section idiom (optional)

A module-level docstring may carry agent process rules in a section delimited by a
line like `IF YOU'RE AN AGENT, READ THIS:`. Keep it short and for **rules**
("tests are the spec — don't weaken assertions"), never for running commentary.
Human-facing description goes above it.

## Quick checklist before committing prose

- [ ] Could a docstring replace these inline comments? Prefer it.
- [ ] Does any comment narrate steps the code already shows? Cut it.
- [ ] Any ticket ID, PR, branch, "decision #", or change-history phrasing? Remove it.
- [ ] Do test names + assertions state the behavior without step comments?
