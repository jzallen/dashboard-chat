# DELIVER progress — ui-state hexagonal-transport (ADR-040 LEAF-series)

One row per LEAF as it lands (mirrors the J-002 per-MR delivery record).
LEAF-2..6 remain DISTILL-deferred (skip-marked specs); do not alter them.

| LEAF | Status | Wave | Source commit | Merge SHA | Behavior |
|---|---|---|---|---|---|
| LEAF-1 | ✅ delivered | DELIVER (2026-05-16) | `4c33709` | pending (refinery `gt mq submit`) | behavior-neutral (A/B proven) |
| LEAF-2 | ⏳ deferred | — | — | — | behavior-neutral |
| LEAF-3 | ⏳ deferred | — | — | — | behavior-neutral |
| LEAF-4 | ⏳ deferred | — | — | — | behavior-neutral |
| LEAF-5 | ⏳ deferred | — | — | — | behavior-changing (equivalence gate) |
| LEAF-6 | ⏳ deferred | — | — | — | behavior-neutral |

## LEAF-1 — FlowStrategy interface + registry keyed by canonical machine-name

**Binding source:** ADR-040 §D1 (deep hexagonal re-core — FlowStrategy port),
§D5 (registry key = canonical machine-name + migration-safe alias map;
flow-id rejected as key), ADR-039 (canonical machine-name), ADR-028
(no machine imports another machine). Spec:
`ui-state/lib/hexagonal-transport/leaf-1-strategy-registry.test.ts`.

**What changed (delegation, NOT relocation):**

- `ui-state/lib/orchestrator.ts` — added the `FlowStrategy` port (typed
  `machineName` + `beginsDirectly` + `buildMachine`), `UnknownMachineError`,
  the registry-level D5 migration alias map
  (`project-and-chat-session-management` → `project-context`), and the
  explicit static `FLOW_STRATEGY_REGISTRY` (strict `get` for the three
  canonical names; `resolve` applies the alias and throws on a miss). The
  legacy machine-factory conditional record was retired.
- **Carved dispatch path** = the machine-RESOLUTION fork in `begin`,
  `beginIfNotStarted`, `appendDeepLinkEvents`. Each now calls
  `FLOW_STRATEGY_REGISTRY.resolve(input.machine)`; the per-machine string
  conditionals (`!== "login-and-org-setup"`, the `!MACHINE_REGISTRY[…]`
  guards) are gone from that fork. `begin`'s direct-vs-spawned selection is
  now `strategy.beginsDirectly`. `flow_id` keeps the wire-name head segment
  → Redis event-log keys byte-identical (behavior-neutral).
- `ui-state/index.ts` — `UnknownMachineError` → clean **404**
  (`{error:"unknown_machine",machine}`) via a small shared
  `flowDispatchError` helper; every other dispatch failure keeps its prior
  `{error,message}` **500** shape byte-identical.

**Out of scope (scope fence honored):** no transition-logic moved into
strategies (LEAF-3); `:machine` route param + route factory + HTTP alias
mounts untouched (LEAF-2); projection/event-log read-port untouched
(LEAF-5); intent buffer / FREEZE-THAW broadcaster untouched (LEAF-4); no
alias removed (LEAF-6). The per-machine settle/emit fan-out deeper in
`send` (e.g. the `=== SESSION_CHAT_WIRE_NAME` arms) is LEAF-3 and was not
touched — the LEAF-1 structural assertion is scoped to the dispatch fork.

**Before → after structural state:**

- Before: machine dispatch via a `Record<string, MachineFactory>` keyed by
  wire name + scattered `input.machine === "<literal>"` conditionals;
  unknown machine → thrown `Error` → HTTP **500** `begin_failed`.
- After: machine dispatch via `FLOW_STRATEGY_REGISTRY.resolve()` (canonical
  key + D5 alias); unknown machine → `UnknownMachineError` → clean HTTP
  **404** `unknown_machine`. No per-machine conditional in the carved fork.

**RG-LEAF (all green):**

- `cd ui-state && npx vitest run` → **153 passed | 42 skipped** (baseline
  149 passed; +4 leaf-1 un-skipped; leaf-{2..6} stay skipped). Zero
  regression.
- `cd ui-state && npx eslint .` → **0 errors** (exit 0; only pre-existing
  repo-wide warnings, none in the changed code).
- `python3 tools/check_workspace_consistency.py` → ✓.
- `./tools/test/test.sh --auto` → ui-state subtree → `npx vitest run` green.
- **Per-marker acceptance — controlled A/B behavior-neutrality proof**
  (same crew Docker stack; only the 3 code files differ; unmodified
  origin/main `990c812` vs LEAF-1 branch):

  | Marker | Baseline (origin/main) | LEAF-1 | Δ |
  |---|---|---|---|
  | mr_1 | 14 failed, 4 passed | 14 failed, 4 passed | 0 |
  | mr_2 | 5 failed, 7 passed | 5 failed, 7 passed | 0 |
  | mr_3 | 4 failed, 2 passed | 4 failed, 2 passed | 0 |
  | mr_4 | **14 passed, 0 failed** | **14 passed, 0 failed** | 0 |
  | mr_5 | 1 failed, 6 passed | 1 failed, 6 passed | 0 |
  | mr_6 | 1 failed, 7 passed | 1 failed, 7 passed | 0 |

  **Identical pass/fail set on every marker → LEAF-1 introduces ZERO
  behavioral delta** (the byte-behavior-neutrality RG-LEAF protects).
  `mr_4` matches the J-002 FINALIZE baseline (14/0/0) exactly. The
  `mr_1/2/3/5/6` failures are a **pre-existing environmental degradation
  of this shared crew Docker host** (predominantly us204 cold-deep-link /
  us202 degraded-path external-timing scenarios) — reproduced identically
  on pristine `origin/main`, therefore **not** a LEAF-1 regression and
  out of scope to fix here (cf. roadmap `known_hazard` discipline: measure
  per-marker, controlled A/B). Escalation note: the host degradation is a
  crew-environment issue for the LEAF-2 worker / overseer to be aware of;
  it is independent of the ADR-040 migration.
