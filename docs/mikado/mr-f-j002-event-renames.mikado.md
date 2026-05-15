# MR-F: rename `j002_*` events to `project_context_*`

**Goal.** Two FlowEvent wire-name renames so the wire vocabulary aligns with the
source-tree directory holding the emitter (`ui-state/lib/machines/project-context/`)
rather than the deprecated journey-numbering scheme:

- `j002_resolution_started` → `project_context_resolution_started`
- `j002_recoverable_error`  → `project_context_recoverable_error`

Wire-protocol change. Both events are appended to the FlowEvent log by
`ui-state/lib/orchestrator.ts` and consumed by the FE-facing projection
reducer in `ui-state/lib/projection.ts`. MR-A (`d3b2242`) renamed
`j001_ready` → `auth_ready` under the same convention; this MR extends the
pattern to the two remaining `j002_*` events.

Audit: `docs/discussion/ui-state-vocabulary-audit/findings.md` §7 Tier-1 #1
+ §8 MR-F.

## Tree (leaf → goal)

```
[ ] GOAL: both wire events renamed; vitest + acceptance + grep clean
    └─ [ ] verify (vitest, eslint, residual-grep, --auto, acceptance)
        ├─ [ ] update canonical journey YAML (docs/product/journeys/...)
        ├─ [ ] rename j002_recoverable_error
        │     ├─ orchestrator.ts (1 emitter, line ~1338)
        │     └─ projection.ts   (1 reducer key, line ~575)
        └─ [ ] rename j002_resolution_started
              ├─ orchestrator.ts (1 emitter + 1 explanatory comment, lines ~552/596)
              └─ projection.ts   (1 reducer key, line ~360)
```

## Discovery — comprehensive grep

`rg -F 'j002_resolution_started' && rg -F 'j002_recoverable_error'` across
the workspace surfaces **only** these production-code sites (everything else
that matched is historical wave artefact under `docs/feature/<slug>/`,
`docs/evolution/<slug>/`, the audit itself, or the `_j002` test-file suffix
which references the J-002 journey, not the event prefix):

| File                                      | Line(s)            | What |
|-------------------------------------------|--------------------|------|
| `ui-state/lib/orchestrator.ts`            | 552, 596, 1338     | comment + 2 emitter `type:` strings |
| `ui-state/lib/projection.ts`              | 360, 575           | 2 reducer keys |
| `docs/product/journeys/project-and-chat-session-management.yaml` | 59, 326 | canonical journey `event:` references |

**No matches** in: `frontend/`, `tests/acceptance/` test bodies (the
`_j002` filename suffix is journey-number, not event-prefix), the
`tests/acceptance/user-flow-state-machines/harness/` source, ui-state unit
tests (`orchestrator.test.ts`, `projection.test.ts`, `index.test.ts`,
machine tests). The acceptance suite `project-and-chat-session-management/`
exercises the FE-facing projection state, not the raw event stream — so it
is binding behavioral coverage but does not pin the event-name strings.

## Out of scope (per the MR brief)

- `docs/feature/<slug>/` — historical wave artefacts; preserve as-is.
- `docs/evolution/<slug>/` — finalised wave artefacts.
- `docs/decisions/adr-*.md` — audit-trail context; preserve.
- `docs/discussion/ui-state-vocabulary-audit/findings.md` — read-only spec.
- `session_chat_recoverable_error` (separate event handled by MR-H).

## Execution order (leaf → goal)

1. Rename `j002_resolution_started` everywhere it appears (orchestrator
   emitter + comment + projection reducer key + journey YAML).
2. Rename `j002_recoverable_error` everywhere it appears (orchestrator
   emitter + projection reducer key + journey YAML).
3. Verify: vitest count matches baseline (7 files / 82 tests passed +
   2 pre-existing infra failures unrelated to event names), eslint clean,
   residual-grep empty, `./tools/test/test.sh --auto` green, acceptance
   suite `project-and-chat-session-management/` green.
4. Atomic commits — one per rename for clean revertability.
