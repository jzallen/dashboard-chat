# Finalize — `failure-simulation-consolidation`

> **Feature shipped**: 2026-05-15 (all five DELIVER MRs + post-cleanup MR)
> **Wave path**: DISCUSS → DESIGN → DISTILL → DELIVER → FINALIZE
> **Branch (finalize)**: `crew/opal`
> **Final main HEAD at FINALIZE open**: `0271aaa`
> **Archived artifacts**: this directory (`discuss/`, `design/`, `distill/`, `deliver/`) is the verbatim DELIVER-end snapshot of the feature workspace, moved here via `git mv` from `docs/feature/failure-simulation-consolidation/` so blame and rename history survive. The four design-wave ADRs ([ADR-035](../../decisions/adr-035-failure-simulation-gate-composition.md), [ADR-036](../../decisions/adr-036-failure-simulation-module-location.md), [ADR-037](../../decisions/adr-037-failure-simulation-audit-sink.md), [ADR-038](../../decisions/adr-038-failure-simulation-naming-phase-plan.md)) migrated to `docs/decisions/` via `git mv` at the same time.

---

## 1. Summary

`failure-simulation-consolidation` retired the overloaded word "harness" as a category descriptor and replaced six scattered test-only knobs (4 `X-Force-*` headers, 1 body field, 1 event family) with a single `shared/failure-simulation/` workspace package. The mechanism now has: one canonical manifest of every knob ([ADR-036](../../decisions/adr-036-failure-simulation-module-location.md)), a two-variable AND-composed gate (`ENVIRONMENT ∈ {dev,ci}` × `FAILURE_SIMULATION_ENABLED=true`, [ADR-035](../../decisions/adr-035-failure-simulation-gate-composition.md)), structured-stdout JSON-line audit emission with OTel-aligned envelopes ([ADR-037](../../decisions/adr-037-failure-simulation-audit-sink.md)), and a three-phase naming migration that kept the firing-path wire contract byte-identical through phase 1 ([ADR-038](../../decisions/adr-038-failure-simulation-naming-phase-plan.md)). The journey shipped as **five DELIVER MRs** plus a post-cleanup MR that removed the phase-1 `legacyAlias` bridge once the rename was complete on both production and acceptance sides. The legacy `NWAVE_HARNESS_KNOBS` env var stays readable for one release with a structured `failure-simulation.config.deprecated` startup event naming `FAILURE_SIMULATION_ENABLED` as its replacement and a semver-shaped `removal.target_release`.

## 2. The five-MR delivery arc

### MR-1 — Registry workspace package

**Shipped in**: 3 commits ([73ec197](https://github.com/jzallen/dashboard-chat/commit/73ec197), [f7e9d86](https://github.com/jzallen/dashboard-chat/commit/f7e9d86), [2be4353](https://github.com/jzallen/dashboard-chat/commit/2be4353)). The first lands the package; the second and third register it in `pnpm-lock.yaml` and `.bazelignore` after build-system feedback.

**What changed**: New `shared/failure-simulation/` workspace package built by Bazel, exporting `manifest` (6 entries with phase-1 `legacyAlias` bridges per [ADR-038](../../decisions/adr-038-failure-simulation-naming-phase-plan.md)), `manifest.schema` (Zod + branded `KnobCanonicalName`), `registry.shouldInject` (inert MR-1 stub), `registry.detectUnknownSignals` (live at MR-1 because the implementation is independent of the gate), the `KNOB` const accessor, and the `assertKnown` CI lint helper. Production callsites are untouched; the MR is structurally additive. The CI drift-check script (`scripts/check-manifest-drift.{js,sh}`) lands alongside the manifest so the same MR that defines the SSOT also enforces it.

**Story coverage**: US-CONSOL-1, US-CONSOL-5. 11 MR-1-scoped scenarios + CA-1 + CA-2 turned GREEN.

### MR-2 — Gate composition + probe + inspection wiring

**Shipped in**: 1 commit ([657daa9](https://github.com/jzallen/dashboard-chat/commit/657daa9)). Plus a related pre-MR-2 unit-test fix ([4fd8200](https://github.com/jzallen/dashboard-chat/commit/4fd8200)) that provided the `X-Active-Scope` contract in chat-handler unit tests.

**What changed**: `gate.ts` lands `evalGate` + `probe` + `parseBool` + `readTier` per [ADR-035](../../decisions/adr-035-failure-simulation-gate-composition.md): the gate is the AND of `ENVIRONMENT ∈ {dev,ci}` and `FAILURE_SIMULATION_ENABLED=true`. Unset env-vars fail closed (default to production-restrictive). `agent/index.ts` calls `probe()` exactly once at startup and conditionally registers `agent/lib/inspection/inspection.ts`'s `/debug/*` routes only when the verdict is enabled — disabled means the routes are absent (404), not present-and-denied (403). The verdict is cached for the process lifetime per [CA-4](deliver/upstream-issues.md). `shouldInject` consults the cached verdict; rejected invocations stub the `failure-simulation.rejected` event ahead of MR-3's full audit emitter. Phase-1 transport rendering bridges both `__force_*__` (canonical, future) and `__harness_*__` (legacy, today) per [ADR-038](../../decisions/adr-038-failure-simulation-naming-phase-plan.md), deriving the canonical event/field name from `legacyAlias.transportValue` rather than from `entry.name` (see [deliver/upstream-issues.md](deliver/upstream-issues.md) §"MR-2 — event + body-field rendering").

**Deferred within MR-2** ([deliver/upstream-issues.md](deliver/upstream-issues.md) §"MR-2 — ui-state composition-root `probe()` deferred to MR-4"): ui-state's startup `probe()` call lands in MR-4 alongside the callsite migration, because adding the workspace-dep to `ui-state/package.json` requires promoting ui-state from a non-workspace to a workspace member, which touches the production image build path. Bundling the build-system change into the MR that has the actual import need keeps MR-2's exit criteria honest. CA-7 passes because the inspection probes live in `agent/`, not `ui-state/`.

**Story coverage**: US-CONSOL-2. All 7 US-CONSOL-2 scenarios + CA-3, CA-4, CA-7 (3 routes), CA-9 (9-cell matrix) turned GREEN.

### MR-3 — Full audit emitter + AuditEvent type union

**Shipped in**: 1 commit ([9079e58](https://github.com/jzallen/dashboard-chat/commit/9079e58)). Also in the MR window: [d69938b](https://github.com/jzallen/dashboard-chat/commit/d69938b) landed `tools/check_workspace_consistency.py` + refinery-gate wiring (kept here in the journey log because it became the load-bearing pre-submit gate for all subsequent MRs).

**What changed**: `audit.ts` lands the discriminated-union `AuditEvent` types (`fired` | `rejected` | `unknown` | `gate.enabled` | `gate.disabled` | `config.deprecated`) per [ADR-037](../../decisions/adr-037-failure-simulation-audit-sink.md), with one-line JSON-on-stdout emission carrying the OTel-aligned envelope (`event.name`, `service.name`, `timestamp`, `environment.tier`, `correlation_id`). `shouldInject` emits the `fired`/`rejected` events; `detectUnknownSignals` emits `unknown`. The `correlationId` field threads through XState actor input per [ADR-028](../../decisions/adr-028-xstate-v5-actor-model.md) — added to actor input schemas where missing. The audit emission survives the worker/actor boundary so a knob firing inside `createSessionEagerlyFn` carries the originating HTTP request's correlation id into the audit row.

**Story coverage**: US-CONSOL-3. All 5 US-CONSOL-3 scenarios + CA-5, CA-6 turned GREEN.

### MR-4 — Phase-1 callsite migration (adapter, wire-identical)

**Shipped in**: 7 atomic commits per [DD-4](deliver/upstream-issues.md) — six per-callsite migrations plus the ui-state composition-root probe-wiring commit ([1e9777f](https://github.com/jzallen/dashboard-chat/commit/1e9777f), [733499b](https://github.com/jzallen/dashboard-chat/commit/733499b), [0cd2be2](https://github.com/jzallen/dashboard-chat/commit/0cd2be2), [d8f17bb](https://github.com/jzallen/dashboard-chat/commit/d8f17bb), [3705d7f](https://github.com/jzallen/dashboard-chat/commit/3705d7f), [69ef2fb](https://github.com/jzallen/dashboard-chat/commit/69ef2fb), [2c7f0b9](https://github.com/jzallen/dashboard-chat/commit/2c7f0b9)).

**What changed**: All six knob callsites in `ui-state/index.ts`, `project-context.ts`, `session-chat.ts`, `login-and-org-setup.ts`, `agent/index.ts`, and `agent/lib/chat/requestLog.ts` rewritten to call `shouldInject(KNOB.x, ctx)` instead of inlined header/event/body checks. The firing-path wire contract is byte-identical pre-vs-post — the manifest's `legacyAlias` entries bridge the event/body-field names so the existing acceptance fixtures in `tests/acceptance/project-and-chat-session-management/` (25+ scenarios across US-201/202/206/207) pass unchanged. The ui-state composition root now imports `@dashboard-chat/shared-failure-simulation` and calls `probe(process.env, "ui-state")` exactly once at startup, completing the [CA-3](deliver/upstream-issues.md) invariant deferred from MR-2.

**Per-commit invariant**: each migration commit modifies ≤8 files (atomic-commit invariant) and is green at HEAD when running the existing acceptance suite. Zero modifications under `tests/acceptance/project-and-chat-session-management/` in this MR — phase 1 is production-only by contract.

**Story coverage**: US-CONSOL-4 (phase 1). All 5 US-CONSOL-4-phase-1 scenarios turned GREEN; the "all 6 knobs functional" cross-story invariant turned partially GREEN (header + body knobs only; event knobs await MR-5's rename).

### MR-5 — Phase-2 vocabulary cleanup + NWAVE_HARNESS_KNOBS deprecation

**Shipped in**: 6 commits ([61f7079](https://github.com/jzallen/dashboard-chat/commit/61f7079), [c7ba085](https://github.com/jzallen/dashboard-chat/commit/c7ba085), [8611e1e](https://github.com/jzallen/dashboard-chat/commit/8611e1e), [d8ef0e5](https://github.com/jzallen/dashboard-chat/commit/d8ef0e5), [156610c](https://github.com/jzallen/dashboard-chat/commit/156610c), [066c2ef](https://github.com/jzallen/dashboard-chat/commit/066c2ef)) — atomic per-rename commits each touching production source AND affected acceptance fixtures in lockstep.

**What changed**:
- `__harness_force_failure__` → `__force_failure__` (event)
- `__harness_expire_token__` → `__expire_token__` (event)
- `harness_force_reissue_failures` → `force_reissue_failures` (body field)
- The user-flow-state-machines harness + step definitions follow the renames in [156610c](https://github.com/jzallen/dashboard-chat/commit/156610c) (the one MR where the harness-named TS test-runner directory is touched — proper-noun survivor only; the directory itself is not renamed).
- `failure-simulation.config.deprecated` event emitted at startup when the legacy `NWAVE_HARNESS_KNOBS` env var is set, naming `FAILURE_SIMULATION_ENABLED` as its replacement and `2.0.0` as the semver-shaped `removal.target_release` (KU-1 resolved per [CA-8](deliver/upstream-issues.md)). Legacy var stays readable, behavior unchanged, deprecation is loud.
- HTTP `X-Force-*` headers remain **unchanged** per [ADR-038](../../decisions/adr-038-failure-simulation-naming-phase-plan.md) — they are already precise; renaming them would force every fixture to rev for zero semantic gain.

**Story coverage**: US-CONSOL-4 (phase 2) + US-CONSOL-3 (deprecation event). All vocabulary-cleanup scenarios + CA-8 turned GREEN.

### Post-cleanup MR — `legacyAlias` bridge removal

**Shipped in**: 1 commit ([0271aaa](https://github.com/jzallen/dashboard-chat/commit/0271aaa)). Not part of the original 5-MR roadmap but a structural cleanup unblocked by MR-5's atomic rename completion.

**What changed**: With phase-2 complete on both production and acceptance sides, the `legacyAlias` field on manifest entries is dead code. The post-cleanup MR removes it, drops the bridge-rendering branch in `eventDistinguisher`, and renames the knob `force-failure-tag` to `force-failure-on-auth-retry` (the original canonical name was acceptable but the rename clarifies *when* the knob fires, not *what* it tags). The MR completes the journey's vocabulary discipline: no `legacyAlias`, no `force-failure-tag`, no half-deprecated state.

## 3. ADRs ratified by this feature

| ADR | Title | Status | Where it lives |
|---|---|---|---|
| [ADR-035](../../decisions/adr-035-failure-simulation-gate-composition.md) | Gate composition AND-composes `ENVIRONMENT ∈ {dev,ci}` with `FAILURE_SIMULATION_ENABLED=true`; both fail closed when unset; `NWAVE_HARNESS_KNOBS` deprecated over one release. | Accepted, applied | `shared/failure-simulation/gate.ts` — `probe()` evaluates both variables, caches the verdict, emits `failure-simulation.gate.{enabled,disabled}` at startup. Verified end-to-end by the 9-cell production-safety matrix (CA-9) and the 3-route inspection-probe absence assertion (CA-7). |
| [ADR-036](../../decisions/adr-036-failure-simulation-module-location.md) | Registry lives at `shared/failure-simulation/` (workspace package); inspection probes live at `agent/lib/inspection/` (categorically separate but share the gate). | Accepted, applied | Two directories, one gate. `shared/failure-simulation/` is imported by `ui-state/` and `agent/`; `agent/lib/inspection/inspection.ts` calls `registerInspectionRoutes(app, verdict)` and conditionally binds `/debug/*` routes. |
| [ADR-037](../../decisions/adr-037-failure-simulation-audit-sink.md) | Structured-stdout audit sink (one JSON line per event), OTel-aligned envelope (`event.name`, `service.name`, `timestamp`, `environment.tier`, `correlation_id`), no new infrastructure. | Accepted, applied | `shared/failure-simulation/audit.ts` emits the discriminated-union `AuditEvent`. Verified by CA-5 (every event is one line of valid JSON) and CA-6 (correlation id propagates across the actor boundary). |
| [ADR-038](../../decisions/adr-038-failure-simulation-naming-phase-plan.md) | HTTP headers (`X-Force-*`) unchanged; events/body field drop `harness_` prefix in a three-phase migration; `legacyAlias` is the phase-1→2 bridge; `NWAVE_HARNESS_KNOBS` deprecated, not deleted. | Accepted, applied + post-cleanup | All 6 knobs migrated; `legacyAlias` retired in the post-cleanup MR ([0271aaa](https://github.com/jzallen/dashboard-chat/commit/0271aaa)); `failure-simulation.config.deprecated` event emitted when the legacy env var is set. |

No new ADRs were opened mid-DELIVER — the four ADRs were ratified before DISTILL dispatched ([0a31ee2](https://github.com/jzallen/dashboard-chat/commit/0a31ee2), [f186ca0](https://github.com/jzallen/dashboard-chat/commit/f186ca0)) and the wave executed against them as immutable inputs.

## 4. Architecture deltas

- **New workspace package**: `shared/failure-simulation/` joins `shared/chat/` as the second cross-service shared module. Built by Bazel; depended on by `ui-state/` and `agent/`. Module surface: `manifest`, `manifest.schema`, `registry.{shouldInject, detectUnknownSignals}`, `KNOB` const accessor, `assertKnown`, `gate.probe`, `audit.emit`. The package precedent (`shared/chat/`, ADR-014) is honored — no new directory-tier convention.
- **One new agent module**: `agent/lib/inspection/inspection.ts` — `registerInspectionRoutes(app, verdict)` is the agent-side seam that conditionally binds `/debug/last-request-scope`, `/debug/request-log`, `/debug/request-log/clear` based on the gate verdict.
- **Two new env vars on the operator surface**: `ENVIRONMENT` (`dev` | `ci` | `staging` | `production`, unset fails closed) and `FAILURE_SIMULATION_ENABLED` (`true`/`false`, unset fails closed). Both must permit for any knob to fire. Olivia owns `ENVIRONMENT`; Devon owns `FAILURE_SIMULATION_ENABLED` for local dev loops.
- **One deprecated env var**: `NWAVE_HARNESS_KNOBS` stays readable; emits `failure-simulation.config.deprecated` at startup naming the replacement and `removal.target_release: "2.0.0"`. Behavior preserved for one release per [ADR-035 §Deprecation](../../decisions/adr-035-failure-simulation-gate-composition.md).
- **Three retired wire-format names**: `__harness_force_failure__` → `__force_failure__`; `__harness_expire_token__` → `__expire_token__`; `harness_force_reissue_failures` → `force_reissue_failures`. HTTP `X-Force-*` headers unchanged. `force-failure-tag` knob renamed to `force-failure-on-auth-retry` in the post-cleanup MR.
- **One new CI gate**: `tools/check_workspace_consistency.py` lands as a sub-second pre-submit consistency check (workspace package registration parity across `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `package.json` files, and `BUILD.bazel`); wired into the refinery `--auto` gate. Catches the class of bug that surfaced in [DI-5 of the frontend-coexistence finalize](../2026-05-13-frontend-coexistence/FINALIZE.md) before submission rather than at merge time.
- **One new audit-event surface**: 6 distinct event names (`failure-simulation.{fired,rejected,unknown,gate.enabled,gate.disabled,config.deprecated}`) emitted as one-line JSON on stdout. Aggregation is platform-owned (the compose/k8s log pipeline). No in-repo aggregation UI.

## 5. Operational invariants ratified

The five contract-assertion invariants encode the production-safety contract end-to-end:

| Invariant | Mechanism | Acceptance test | Status |
|---|---|---|---|
| Production rejects every knob regardless of `NWAVE_HARNESS_KNOBS` value | Gate AND-composes `ENVIRONMENT ∈ {dev,ci}` × `FAILURE_SIMULATION_ENABLED=true`; both fail closed when unset; production always denies | `test_ca_9_production_verdict_is_disabled_regardless_of_flag_values` (9-cell matrix) | GREEN at MR-2 |
| Inspection probes 404 (route absent) when gate disabled | Conditional `app.route(...)` registration in `registerInspectionRoutes` keyed off the cached verdict | `test_ca_7_inspection_probe_returns_404_not_403_when_gate_is_disabled` (3 routes × 4 environments) | GREEN at MR-2 |
| First failure-simulation event in every process is a gate event | `probe()` called exactly once at startup before any route or actor binds | `test_ca_3_first_failure_simulation_event_is_a_gate_event` | GREEN at MR-2 (agent) + MR-4 (ui-state) |
| Verdict cache is stable within one process lifetime | `evalGate` evaluates exactly once per process; subsequent calls read the cached verdict | `test_ca_4_verdict_cache_is_stable_within_one_process_lifetime` | GREEN at MR-2 |
| Every audit event is a single line of valid JSON | `audit.emit` writes via `console.log(JSON.stringify(envelope))` with no newlines in any envelope field | `test_ca_5_every_audit_event_is_a_single_line_of_valid_json` | GREEN at MR-3 |
| Correlation id propagates across the actor boundary | XState actor input schemas carry `correlationId`; `shouldInject` reads it from context | `test_ca_6_correlation_id_propagates_across_the_actor_boundary` | GREEN at MR-3 |
| `NWAVE_HARNESS_KNOBS` honored with structured deprecation event | `probe()` reads the legacy var; if set, emits `failure-simulation.config.deprecated` with semver-shaped `removal.target_release` | `test_ca_8_legacy_variable_honored_with_deprecation_event` | GREEN at MR-5 |
| Manifest-vs-source drift caught at CI | `scripts/check-manifest-drift.{js,sh}` greps for knob-name patterns and diffs against manifest entries | `test_ca_1_manifest_vs_source_drift_check_catches_unregistered_knob` | GREEN at MR-1 |
| Manifest schema rejects malformed entries at module load | Zod schema enforces non-empty `rationale` + explicit `contractTestAlternativeConsidered` | `test_ca_2_schema_validation_rejects_a_known_bad_entry` | GREEN at MR-1 |

All 9 contract assertions hold against the final state on `main`. The production-safety matrix (CA-9, 9 cells) is the load-bearing invariant — any future change to gate logic must keep all 9 cells GREEN.

## 6. DELIVER execution log

Six MRs, atomic commits within each MR per CLAUDE.md commit convention. Final state on `main` covers the entire journey from `73ec197` (MR-1) through `0271aaa` (post-cleanup):

| MR | Commits on `main` | Story coverage | Refinery gate |
|---|---|---|---|
| MR-1 (registry) | `73ec197`, `f7e9d86`, `2be4353` | US-CONSOL-1, US-CONSOL-5 | `--backend` GREEN (code-touch) |
| MR-2 (gate + probe + inspection) | `4fd8200`, `657daa9` | US-CONSOL-2 | `--backend` GREEN |
| MR-3 (audit emitter) | `d69938b`, `9079e58` | US-CONSOL-3 | `--backend` GREEN |
| MR-4 (phase-1 migration) | `1e9777f`, `733499b`, `0cd2be2`, `d8f17bb`, `3705d7f`, `69ef2fb`, `2c7f0b9` | US-CONSOL-4 (phase 1) | `--backend` GREEN at each commit (atomic invariant) |
| MR-5 (vocab cleanup + deprecation) | `61f7079`, `c7ba085`, `8611e1e`, `d8ef0e5`, `156610c`, `066c2ef` | US-CONSOL-4 (phase 2) | `--backend` GREEN at each commit |
| Post-cleanup | `0271aaa` | dead-code removal + naming refinement | `--backend` GREEN |

Two `chore(release)` commits ([b8a3d84](https://github.com/jzallen/dashboard-chat/commit/b8a3d84) → 1.37.0, [f2c6ee3](https://github.com/jzallen/dashboard-chat/commit/f2c6ee3) → 1.38.0) bracket the MR-2/MR-3 boundary — semantic-release picked up the `feat:` prefixes and cut versions automatically.

## 7. Acceptance suite outcome

The DISTILL wave authored 29 BDD scenarios + 9 contract assertions across 7 pytest modules at `tests/acceptance/failure-simulation-consolidation/` (55 collected pytest items including parametrizations). Skip-state evolution across the five MRs:

- **At DISTILL handoff** (commit [903c75b](https://github.com/jzallen/dashboard-chat/commit/903c75b)): 100% RED — `shared/failure-simulation/` does not exist.
- **At MR-1 close**: 11 + CA-1 + CA-2 GREEN (registry exists, manifest validated, drift check enforceable). Four additional scenarios pytest-marked `mr_3`/`mr_4` are *incidentally* GREEN at MR-1 because they exercise `detectUnknownSignals` (live at MR-1) or assert structural invariants of the inert `shouldInject` stub ([deliver/upstream-issues.md](deliver/upstream-issues.md) §"MR-1 — incidentally-GREEN scenarios").
- **At MR-2 close**: all 7 US-CONSOL-2 + CA-3, CA-4, CA-7 (3 routes), CA-9 (9 cells) GREEN. Production-safety matrix is structurally closed.
- **At MR-3 close**: all 5 US-CONSOL-3 + CA-5, CA-6 GREEN. Full audit emitter wired; correlation id propagates across the actor boundary.
- **At MR-4 close**: all 5 US-CONSOL-4-phase-1 + "all 6 knobs functional" cross-story (partial — header + body) GREEN. Zero test changes in this MR per the phase-1 contract; the existing `project-and-chat-session-management/` suite is the safety net and stays GREEN at every commit.
- **At MR-5 close**: full 29 scenarios + 9 contract assertions GREEN. Vocabulary cleanup atomic per-rename; the existing `project-and-chat-session-management/` suite stays GREEN at each rename commit (production + tests renamed in lockstep).

Walking-skeleton strategy: real `node` subprocess drivers exercising the registry's public API; no MSW or Playwright. The `subprocess.run(..., text=True)` + line-by-line JSONL parsing in `driver.py` covers KU-2 (stdout capture).

---

## 8. Deferred items / open follow-ons

These items are explicitly deferred follow-ons, not blockers, and are surfaced here so future readers know the contract surface they remain on.

### F-1 — `NWAVE_HARNESS_KNOBS` actual removal

- **Where**: `shared/failure-simulation/gate.ts` — the legacy var is read and bridges to `FAILURE_SIMULATION_ENABLED` semantics; `probe()` emits `failure-simulation.config.deprecated` with `removal.target_release: "2.0.0"`.
- **Why deferred**: the deprecation contract gives operators one release window to migrate. Removing the env-var read is a follow-up MR scoped to "version 2.0.0 cut" or a successor release-version per the semver-shaped target.
- **Follow-on owner**: whoever opens the 2.0.0 release MR. The deprecation event's `removal.target_release` field is the contract trigger.

### F-2 — `tests/acceptance/failure-simulation-consolidation/` path references to the pre-archive workspace location

- **Where**: `tests/acceptance/failure-simulation-consolidation/` — likely contains docstrings or fixture references to `docs/feature/failure-simulation-consolidation/`. This FINALIZE MR is scoped to `docs/` + reference-doc edits only; updating the acceptance suite's path references would push the refinery `--auto` gate off the docs-only allowlist into `--backend`.
- **Why deferred**: the same trade-off as [DI-8 of frontend-coexistence](../2026-05-13-frontend-coexistence/FINALIZE.md) — scope discipline. Trivial mechanical sweep on a follow-up MR.
- **Follow-on owner**: a 1-MR sweep updating any `docs/feature/failure-simulation-consolidation/` references to `docs/evolution/2026-05-15-failure-simulation-consolidation/`. Merges through `--backend` cleanly because the acceptance suite is fully GREEN at the close of MR-5.

### F-3 — Per-knob contract-test consideration

- **Where**: `shared/failure-simulation/manifest.ts` — each entry's `contractTestAlternativeConsidered` boolean.
- **Why surfaced here**: the field exists to surface the conversation at MR-time ([US-CONSOL-5](discuss/stories.md)), not to enforce contract-test adoption. The user explicitly placed contract-test migration out of scope for this DISCUSS.
- **Follow-on owner**: future per-knob retirement MRs that replace specific knobs with contract tests. The field is the audit trail of whether the conversation happened, not the trail of whether the migration was done.

### F-4 — Inspection-probe category co-location

- **Where**: `agent/lib/inspection/inspection.ts` — currently a separate module from `shared/failure-simulation/`.
- **Why surfaced here**: [ADR-036](../../decisions/adr-036-failure-simulation-module-location.md) explicitly keeps inspection probes in `agent/lib/inspection/` because the category boundary (read-only observability vs deterministic failure injection) is sharper than the gate-sharing relationship. Future readers may be tempted to merge them; the ADR is the reason not to.
- **Follow-on owner**: whoever next touches the inspection probes. Re-read ADR-036 §"Category boundary" before considering a co-location move.

---

## 9. Outcome

- **One vocabulary, six knobs, one gate, one audit surface, one manifest**: the consolidation closed in five DELIVER MRs + one post-cleanup MR. The word "harness" is retired from product code as a generic descriptor; the `tests/acceptance/user-flow-state-machines/harness/` TS test-runner directory is the only proper-noun survivor (left untouched).
- **All 4 ADRs implemented and verified** end-to-end across five reviewer-approved MRs. The 9-cell production-safety matrix (CA-9) is the load-bearing invariant — any future gate change must keep all 9 cells GREEN.
- **Zero acceptance-scenario regression in the existing `project-and-chat-session-management/` suite** at any commit of MR-4 or MR-5 — phase-1 byte-identical wire contract + phase-2 atomic per-rename commits kept the safety net intact.
- **`NWAVE_HARNESS_KNOBS` deprecated, not deleted**: operators get one release of compatibility plus a structured `failure-simulation.config.deprecated` startup event naming the replacement (`FAILURE_SIMULATION_ENABLED`) and the semver-shaped `removal.target_release` (`2.0.0`).
- **Workspace consistency check now a refinery gate**: `tools/check_workspace_consistency.py` catches the class of bug that surfaced in frontend-coexistence's DI-5 before submission rather than at merge time. Sub-second runtime; runs on every `--auto` gate invocation.
- **The shared-package pattern is doubly precedented**: `shared/chat/` (ADR-014) and `shared/failure-simulation/` ([ADR-036](../../decisions/adr-036-failure-simulation-module-location.md)) are now the two canonical homes for cross-service code in this repo. Future cross-cutting concerns route to `shared/` by default.
- **Audit surface is OTel-aligned**: `event.name`, `service.name`, `timestamp`, `environment.tier`, `correlation_id` envelope on every event. Aggregation is platform-owned and zero in-repo aggregation UI was added — operators read the JSON lines directly from container stdout.
