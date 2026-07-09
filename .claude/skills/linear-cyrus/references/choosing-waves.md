# Choosing the wave / nwave agent

Which `wave:*` label (→ which `/nw-*` agent) a Linear issue gets. Read-only waves are
cheap and safe to fire; the gated ones (`deliver`/`bugfix`/`refactor`) open PRs, so pick
deliberately. This mirrors CLAUDE.md's routing table, framed for the Linear+cyrus funnel.

## Decision heuristics

Labels are the **grouped** `wave` children — apply by child name/ID, never the colon-form
string (`linear-structure.md`).

| The issue is about… | Wave label | Agent | Notes |
|---|---|---|---|
| A new feature — stories/AC don't exist yet | `wave › discuss` | `/nw-discuss` | read-only; produces stories+AC as thread analysis, then promote |
| Architecture / component boundaries / tech selection | `wave › design` | `/nw-design` | read-only; C4 + ADRs. Precedes a boundary-moving refactor |
| A story that's broken down and ready to build | `wave › distill`→`deliver` | orchestrator → `/nw-deliver` | the normal build path (skeleton-first, one story PR) |
| **Adding or changing behaviour** on brownfield code | `wave › deliver` | `/nw-deliver` | AC checklist = the spec; RED→green |
| **Restructuring existing code with no behaviour change** | `wave › refactor` | `/nw-refactor` | behaviour-preserving; targeted by RPP level + scope; modeled as a **Refactor issue**, not a Story (below) |
| A bug with a known cause | `wave › distill` | `/nw-distill` first | write the regression test, then fix |
| A bug with an unknown cause | `wave › bugfix` | `/nw-bugfix` → `/nw-root-why` | RCA → regression test → fix |
| Investigating a technology/pattern before deciding | `wave › research` | `/nw-research` | read-only; cited research doc |
| Docs | `wave › document` | `/nw-document` | read-only; DIVIO/Diátaxis |
| Closing out a finished project | `wave › finalize` | `/nw-finalize` | write-capable; on the migrated seed under the Finalize milestone; assigned manually (`milestone.md`) |

## nw-deliver vs nw-refactor — the key split

They're **siblings, not a hierarchy** — the discriminator is *does observable behaviour
change?*

- **`nw-deliver` — behaviour-adding.** Drives NEW or CHANGED behaviour against an **AC
  checklist** (skeleton-first, RED→green). Use it when the story delivers functionality a
  user/consumer can observe. Targeting is the AC list.
- **`nw-refactor` — behaviour-preserving, finely targeted.** Restructures code that
  already works, changing *nothing* a caller can observe. Targeting is a **`--level`
  (RPP L1–L6) + `--scope`**, not an AC list. This is the "better targeting" — you name
  the structural layer and the blast radius instead of a behaviour to add.

**Most brownfield cleanup is `nw-refactor`, not `nw-deliver`.** If you catch yourself
opening a deliver session whose AC is "same behaviour, cleaner code / clearer boundary,"
it's a refactor — reach for `wave › refactor` and pick a level.

### Refactor work is its own issue type, not a Story

A refactor is targeted by **`--level` (RPP L1–L6) + `--scope`/module**, not an AC checklist,
and it has no skeleton/RED-test frame — so it does **not** fit the Story shape. Model it as
a **Refactor issue** whose body carries the level + scope and opens `## AGENT NOTES` with
`/nw-refactor …` (see the Refactor template in `templates.md`). Small actionable debt is a
single Refactor issue; debt that earns its own project gets a **Refactor project that holds
Refactor issues** (not Stories), sliced with Release milestones only if the RPP cascade or
Mikado phases warrant it (`intake-and-promotion.md` § Tech Debt).

### Preconditions for nw-refactor (hard gates)

1. **Green test suite over the code you'll touch.** Crafty enforces the Iron Rule — it
   cannot commit with failing tests. If it's not green first, nothing lands.
2. **Characterization tests** (Feathers) for any legacy/untested code in scope, written
   first as the safety net. Triage pre-existing theater tests via the
   `nw-test-refactoring-catalog` L1–L3 before trusting them.
3. **`/nw-hotspot` first** for churn/tech-debt work — `/nw-hotspot --top=10` produces the
   prioritized file list you feed the refactor.
4. **`/nw-design` first** only if the refactor moves component boundaries (see levels
   L4–L6 below) rather than tidying in place.

## Refactoring Priority Premise (RPP) — levels

`--level=N` runs L1…LN **bottom-up**; each level cleans the layer the next diagnoses on.

| Level | Name | Targets | Example |
|---|---|---|---|
| **L1** | Readability | naming, dead code, clutter | rename cryptic vars, delete dead branches, extract magic numbers |
| **L2** | Complexity | long methods, duplication | split a 120-line function; hoist a repeated guard into a helper |
| **L3** | Responsibilities | class coupling, mixed concerns | move invoice-formatting out of `OrderService` into `InvoiceFormatter` |
| **L4** | Abstractions | primitive obsession, param sprawl | `createOrder(id, amount, currency)` → `createOrder(CustomerId, Money)` |
| **L5** | Design Patterns | conditionals encoding behaviour | replace a payment-type `if/else` with a `PaymentStrategy` |
| **L6** | SOLID++ | inheritance misuse, SOLID breaches | recompose a Refused-Bequest subclass around an extracted interface |

- **80% of the value is L1–L2.** For a routine churn/boundary-tidy pass,
  `--level=2 --scope=module` is the right stopping point.
- **Mandatory cascade — never skip a level.** You can't spot Long Methods (L2) through
  confusing names (L1), can't assign responsibilities (L3) while methods are still
  bloated (L2), etc. Skipping produces *wrong* diagnoses, not just messy ones.
- **L3–L6 are deliberate design work**, not routine cleanup. L4–L6 ("architecture
  refactoring") want a `/nw-design` ADR first and run at a separate orchestrator phase,
  not inside each inner loop.

## Scope + flags

- `--scope=file | module | package` — the blast radius. Keep it as small as the change
  honestly needs; a `wave › refactor` issue should carry the same `area` child label as the
  subtree it touches (parallel-safety, `parallel-execution.md`).
- `--level=N` — the RPP ceiling (see above).
- `--mikado_planning=true` — add this when the change is multi-class / cross-module and a
  naive edit cascades failures. It puts the session into Mikado exploration (attempt →
  graph prerequisites → revert → repeat) before leaf-first execution, tracked in
  `docs/mikado/<goal>.mikado.md`.

## Two worked sequences

**Code quality / churn / tech-debt / boundary-tidy** (behaviour stays put):
`/nw-hotspot --top=10` → confirm/write characterization tests + green suite →
`wave › refactor` issue → `/nw-refactor <path> --level=2 --scope=module` (add
`--mikado_planning=true` if it turns out to cross modules).

**Legacy code needing DDD extraction** (heavier):
`/nw-hotspot` → EventStorming + bounded-context ID → characterization tests → green
suite → `/nw-design` (ADR) → `/nw-refactor <path> --level=6 --scope=module
--mikado_planning=true`.
