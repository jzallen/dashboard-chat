# DELIVER progress — ui-state hexagonal-transport (ADR-040 LEAF-series)

LEAF-2 record. Mirrors `leaf-1-progress.md`. LEAF-3..6 remain
DISTILL-deferred (skip-marked specs); do not alter them. LEAF-1's record
is unchanged.

## LEAF-2 — makeFlowRouter(strategy) factory + per-machine app.route mounts + alias map

**Binding source:** ADR-040 §D4 (per-machine sub-routers via a shared
`makeFlowRouter(strategy)` factory, mounted with
`app.route('/flow/<canonical-machine-name>', …)`; no `:machine`
parameter), §D5 + LEAF-2 (the alias is **HTTP-routing-level, not
registry-level** — the SAME router instance mounted at both the canonical
and the legacy path), ADR-027 §1 (FE projection read contract), ADR-030
(`/ui-state/*` proxy routing table unchanged). Spec:
`ui-state/lib/hexagonal-transport/leaf-2-router-factory-alias-surface.test.ts`.

**What changed (routing-only; handler bodies byte-unchanged):**

- `ui-state/index.ts` — added `makeFlowRouter(strategy, wireName)`: a
  Hono sub-router carrying the full flow transport surface (`begin`,
  `event`, `freeze`, `thaw`, `open-deep-link`, `projection`,
  `projection/stream` — the exact pre-LEAF-2 `/flow/:machine/*` set).
  The parameterized `app.<verb>("/flow/:machine/…")` dispatch routes are
  retired; each strategy is resolved from the LEAF-1
  `FLOW_STRATEGY_REGISTRY` by canonical machine-name and mounted:
  - `app.route("/flow/login-and-org-setup", loginRouter)`
  - `app.route("/flow/project-context", projectRouter)` **and**
    `app.route("/flow/project-and-chat-session-management", projectRouter)`
    — the SAME instance (ADR-040 D5 example), so the project alias pair
    resolves byte-identically with no 404 window.
  - `app.route("/flow/session-chat", sessionChatRouter)`
- **`wireName`** is the established (legacy-stable) wire segment
  forwarded to the orchestrator (`project-and-chat-session-management`
  for the project machine). Because `flow_id = "<wireName>:<principal>"`
  is the Redis event-log key, the `J002_MACHINES` membership key, and the
  `FlowProjection.flow_id` wire field, forwarding the established name
  keeps **every byte identical to the pre-LEAF-2 baseline through BOTH
  mounts**. The LEAF-1 registry still canonicalizes via the D5 alias
  (`resolve()`); no alias logic is reimplemented in the routes. LEAF-6
  flips this to the canonical name once the FE/suite migrate.
- A composition-time guard asserts `FLOW_STRATEGY_REGISTRY.resolve(wireName)
  === strategy` (router↔registry lockstep; fails at startup, never at
  request time → no runtime behavior delta).
- A single **terminal** `app.all("/flow/:machine/*")` guard is the ONLY
  surviving `:machine` reference. It is a boundary, NOT dispatch — it
  reproduces the LEAF-1 unknown-machine clean **404**
  (`{error:"unknown_machine",machine}`) byte-for-byte (registry miss) and
  defers to Hono's default not-found for an unknown sub-path of a known
  machine (pre-LEAF-2 behavior). Registered after the mounts so a matched
  sub-router always responds first. This reconciles ADR-040 D4 ("no
  :machine parameter" = no dispatch param) with ADR-040 Consequences /
  the LEAF-1 404 contract (both hold).
- `ui-state/lib/hexagonal-transport/leaf-2-router-factory-alias-surface.test.ts`
  — un-skipped + implemented to GREEN (unweakened): structural
  (`:machine` dispatch retired; per-machine mounts; sole `:machine`
  registration is the guard), byte-identity across the alias pair for
  every driving-port verb, ADR-027 §1 projection-read parity, and the
  no-404-window characterization incl. the preserved LEAF-1 404 boundary.

**Out of scope (scope fence honored):** no orchestrator transition logic
carved (LEAF-3 — `begin`/`event`/`settle` bodies untouched; the factory
only routes HTTP → existing handlers via the LEAF-1 registry); intent
buffer / FREEZE-THAW broadcaster untouched (LEAF-4); projection/event-log
read-port untouched (LEAF-5); no alias removed (LEAF-6 — aliases ADDED
here). No `tests/acceptance/**` or leaf-{1,3,4,5,6} spec modified.

**Before → after route surface:**

- Before: `app.<verb>("/flow/:machine/<verb>")` ×7, machine via
  `c.req.param("machine")`; unknown machine → LEAF-1 registry-miss 404.
- After: per-machine `app.route("/flow/<segment>", makeFlowRouter(...))`
  mounts (project mounted at canonical **and** legacy against the same
  instance); machine via the `wireName` closure constant (the established
  wire segment); unknown machine → identical LEAF-1 registry-miss 404 via
  the terminal guard. Observable HTTP surface byte-identical.

**RG-LEAF (all green):**

- `cd ui-state && npx vitest run` → **159 passed | 36 skipped** (baseline
  153 passed after LEAF-1; +6 leaf-2 un-skipped; leaf-1 still passing;
  leaf-{3..6} stay skipped). Zero regression.
- `cd ui-state && npx eslint .` → **0 errors** (exit 0; only pre-existing
  repo-wide `intent-prefix` warnings, none in the changed code).
- `python3 tools/check_workspace_consistency.py` → ✓.
- `./tools/test/test.sh --auto` (post-commit) → `+ --ui-state` →
  `npx vitest run` green, exit 0.
- **Per-marker acceptance — controlled A/B behavior-neutrality proof**
  (same crew Docker stack; only the ui-state container differs between
  A and B; pristine `origin/main` `e9d3cce` vs LEAF-2 branch — only
  `ui-state/index.ts` reverted/restored between runs):

  | Marker | Baseline A (origin/main e9d3cce) | LEAF-2 B | Δ |
  |---|---|---|---|
  | mr_1 | 14 failed, 4 passed | 14 failed, 4 passed | 0 |
  | mr_2 | 5 failed, 7 passed | 5 failed, 7 passed | 0 |
  | mr_3 | 4 failed, 2 passed | 4 failed, 2 passed | 0 |
  | mr_4 | **14 passed, 0 failed** | **14 passed, 0 failed** | 0 |
  | mr_5 | 1 failed, 6 passed | 1 failed, 6 passed | 0 |
  | mr_6 | 1 failed, 7 passed | 1 failed, 7 passed | 0 |

  **Identical pass/fail set on every marker — verified at FAILED
  node-id granularity (25 failing node-ids, set diff empty A vs B) →
  LEAF-2 introduces ZERO behavioral delta** (the byte-behavior-neutrality
  RG-LEAF protects). `mr_4` matches the J-002 FINALIZE baseline (14/0/0)
  exactly. The `mr_1/2/3/5/6` failures are a **pre-existing environmental
  degradation of this shared crew Docker host** — root cause 24×
  `ERR_MODULE_NOT_FOUND` (the `userFlowHarness` TS module is unresolvable
  on the degraded host) + timeouts — reproduced **identically** on
  pristine `origin/main`, therefore **not** a LEAF-2 regression and out
  of scope to fix (cf. roadmap `known_hazard` discipline: measure
  per-marker, controlled A/B). The numbers reproduce LEAF-1's documented
  baseline exactly.

  The acceptance suite drives the LEGACY
  `/ui-state/flow/project-and-chat-session-management/*` **and**
  `/ui-state/flow/session-chat/*` segments (driver.py); mr_4 (US-207/208)
  staying 14/0/0 GREEN and mr_6 (US-210 FREEZE/THAW) staying identical
  **through the LEAF-2 per-machine mounts + alias** is the live proof
  that **no 404 window** opened on any legacy vocabulary.
