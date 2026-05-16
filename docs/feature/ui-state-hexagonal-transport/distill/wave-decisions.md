# DISTILL wave-decisions — ui-state hexagonal-transport (ADR-040 LEAF-1..6)

**Wave:** DISTILL · **Date:** 2026-05-16 · **Kind:** brownfield REFACTOR migration
**Binding spec:** `docs/decisions/adr-040-ui-state-hexagonal-transport.md`

Decisions are numbered DWD-N (DISTILL Wave Decision).

## DWD-1 — Test strategy: in-process ui-state vitest specs + the J-002 acceptance suite as the OUTER pin

The new binding contracts are authored as **ui-state vitest specs** under `ui-state/lib/hexagonal-transport/` (the `index.test.ts` pattern: `wireRoutes(app, orchestrator)` + `app.fetch`, `createNoopFlowEventLog` at the port boundary). The J-002 acceptance suite (`tests/acceptance/project-and-chat-session-management/`, mr_1..mr_6) is the **inherited behavioral SSOT** — REFERENCED via the RG-LEAF gate, **not duplicated**. **Why:** the acceptance suite already pins end-to-end behavior through auth-proxy; re-asserting it would be theatre and would risk weakening it. The vitest specs pin only the structural/contract deltas the suite cannot see (registry dispatch, alias path-surface, store byte-equivalence). **Rejected:** adding parallel Python acceptance scenarios — duplicative, and it would drag the `--auto` gate onto the acceptance subtree unnecessarily.

## DWD-2 — Port-to-port boundaries

- **Driving port:** the ui-state HTTP edge — `POST /flow/<machine>/begin|event|open-deep-link`, `GET /flow/<machine>/projection[/stream]`. Specs drive it in-process; the acceptance suite drives it end-to-end through `auth-proxy /ui-state/*`.
- **Driven port:** `SettledStateStore.get/set` **vs** legacy `FlowEventLog.read()` + `buildProjection` — the LEAF-5 equivalence boundary. Mocks only at port boundaries; no internal-class mocks (nwave hexagonal rule). **Why:** TBU defects become structurally impossible when every assertion is port-to-port; the LEAF-5 gate is meaningful precisely because it compares two driven-port implementations producing the same driving-port-observable payload.

## DWD-3 — Characterization vs new-contract split

LEAF-1/3/4 = **characterization** (behavior-neutral; the acceptance suite + the pre-extraction behavior are the pins). LEAF-2/5/6 = **new contract** (a surface the suite does not pin: alias resolution, store equivalence, post-removal 404). **Why:** Feathers brownfield discipline — behavior-neutral refactors of untested-at-the-seam legacy MUST be pinned by characterization before the change; genuinely new surfaces get new RED specs. LEAF-1/3 also carry a **structural** assertion (no per-machine `machine === "…"` conditional remains in the carved dispatch path) because "behavior unchanged" is necessary but not sufficient evidence the carve actually happened.

## DWD-4 — LEAF-5 is ONE step with the byte-equivalence gate as its RED prerequisite (NOT decomposed)

Binding overseer decision, recorded verbatim in `handoff-distill-to-deliver.md` §1 and `roadmap.json` LEAF-5: **single hard swap**, not 5a/5b/5c, not the dual-write→read-swap→drop sequence. The equivalence gate is authored FIRST (own commit), run against legacy buildProjection to lock the baseline, then becomes the swap MR's regression gate. **Why:** ADR-040 Consequences ratified speed-over-safety with the risk owned at overseer level and *replaced the rejected dual-read parity window with this mechanically verifiable gate*. DISTILL's job is to make the gate exhaustive and unambiguous, not to re-introduce the safety net the decision deliberately traded away. **This is the single most load-bearing decision in this pass** — a DELIVER crafter who decomposes LEAF-5 has violated a binding decision.

## DWD-5 — The LEAF-5 equivalence gate is exhaustive across every J-002 state-history

`leaf-5-settled-state-store-equivalence.test.ts` carries a typed `STATE_HISTORIES` catalogue covering **every** category ADR-040 names — `begin`, `project_select`, `session_resume`, `session_list`, `dataset_switch` (US-209), `freeze`/`thaw` (US-210), the **cross-machine settle race** — plus every error arm the legacy `harvestSettled*` family sourced (`scope_mismatch_terminal`, `project_not_found`, `access_revoked`, `dataset_access_denied`, transient `error_recoverable`, degraded). Each entry: the FlowEvent log, the terminal settle event, the legacy harvest source it depended on, the expected settled state. The assertion is byte-exact: `JSON.stringify(store.get(flow_id)) === JSON.stringify(buildProjection(flow_id, log ++ [terminalEvent]))` over the full FlowProjection wire shape incl. `sequence_id` / `last_event_at` / `correlation_id`; `ts` + `correlation_id` are pinned in fixtures for byte-stability; `set` idempotence asserted in the same file. **Why:** ADR-040 explicitly states the acceptance-suite-only mitigation was insufficient — "a silently dropped field under a specific state-history" is the failure the gate must catch, so the catalogue must be exhaustive, not happy-path. This converts aspirational prose into a falsifiable artifact and is the highest-value output of this DISTILL pass.

## DWD-6 — Skip-marked stubs (green-by-skip), not RED scaffolds

All specs are `describe.skip`-marked with DELIVER-deferred reasons; no production scaffold files are created. **Why:** the saved-feedback constraint requires the `--auto` subtree gate to stay green, and the project's established pattern (the J-002 acceptance suite skips at DISTILL, un-skips per MR in DELIVER — see its `conftest.py`) is the precedent. Standard nwave Mandate-7 RED scaffolding is deliberately overridden here per the explicit task instruction and the brownfield refactor shape (the production modules being refactored already exist; scaffolding them would mean implementing, which is DELIVER's job). Not-yet-existing symbols (`SettledStateStore`, the registry, `makeFlowRouter`, `IntentBuffer`) are referenced in skipped-body comments + typed fixtures, never imported at module top-level, so vitest collection stays clean and `eslint .` stays at 0 errors.

## DWD-7 — RG-LEAF per-marker discipline around D-MR5-02

The regression gate runs the acceptance suite **per-marker** (`-m mr_1` … `-m mr_6`, separate invocations), never the whole directory at once. **Why:** D-MR5-02 (pre-existing shared-`dev-user-001` full-suite ordering fragility) is OUT OF SCOPE and must not be fixed inside this refactor; per-marker execution is the documented way to run the suite around it so it cannot mask or manufacture a regression signal.

## DWD-8 — Reconciliation result

Reconciliation passed — **0 contradictions**. ADR-040 supersedes ADR-030's 2026-05-15 amendment **for the backing-store mechanism only**; the read-path *contract* (orchestrator reads the projection, never `snapshot.context`) is preserved, and ADR-030 §1–§4 + the LEAF-D ESLint rule remain in force (RG-LEAF asserts the rule still passes on the carved orchestrator). ADR-027 §1/§4/§5, ADR-028 (actor model, cross-machine FREEZE/THAW, "no machine imports another machine"), ADR-039 (canonical machine-name, C11 vocabulary) are honored, not contradicted. No upstream-issues file is produced — no gaps or contradictions in the prior waves were found.
