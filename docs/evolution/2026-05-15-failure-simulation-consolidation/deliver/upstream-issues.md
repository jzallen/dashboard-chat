# DELIVER — upstream issues / observations

Findings DELIVER surfaces back to prior waves. None of these blocked MR-1
landing; each is documented for the MR-2 / MR-3 / MR-4 dispatchers and for
the reviewer.

## MR-1 — incidentally-GREEN scenarios outside the MR-1 scenario set

Four DISTILL scenarios outside the MR-1 unskipped set turn GREEN once MR-1
lands — not because MR-1 over-delivers, but because the test asserts on
behavior that the MR-1 natural surface (`manifest` + `detectUnknownSignals`)
already produces.

| Test | Pytest mark | Behavior asserted | Why GREEN at MR-1 |
|---|---|---|---|
| `test_us_consol_3_audit_log.py::test_an_unknown_knob_emits_a_warning_audit_entry_with_manifest_pointer` | `mr_3` | `failure-simulation.unknown` emitted with `knob.name.raw` and `manifest.path` for a typo'd header | `detectUnknownSignals` is MR-1 scope (US-CONSOL-1 Scenarios 2/3) and emits the same event shape. The MR-3 test is effectively a duplicate of US-CONSOL-1 Scenario 3. |
| `test_us_consol_3_audit_log.py::test_audit_entries_are_absent_for_normal_requests` | `mr_3` | No `failure-simulation.*` invocation events for a request that carries no knob signal | MR-1's `shouldInject` is an inert stub (returns `false`, emits nothing) and `detectUnknownSignals` short-circuits on non-knob headers. The absence is natural at MR-1; MR-3's audit emitter does not have to add anything to satisfy this assertion. |
| `test_us_consol_4_migration.py::test_acceptance_suite_passes_after_adapter_phase_migration` | `mr_4` | The existing `project-and-chat-session-management/` suite directory exists AND the manifest lists 6 knobs | Both are structural invariants of MR-1 — no migration commits are needed for the assertions to hold. |
| `test_us_consol_4_migration.py::test_a_regression_is_caught_by_the_acceptance_suite_via_audit_log` | `mr_4` | A typo'd header produces `failure-simulation.unknown` (and no `fired`) | Uses `detectUnknownSignals` (MR-1 scope). `fired == []` follows from `shouldInject` being the inert MR-1 stub. |

**Disposition:** no change requested. The tests are correct; the pytest marks
suggest a later MR but the actual surface they exercise is MR-1. These tests
will continue to pass after MR-2/MR-3/MR-4 land their own changes — they are
load-bearing future-regression sentinels for the MR-1 stubs even though the
roadmap counted them in later MRs.

**For the MR-2 / MR-3 dispatcher:** when wiring the real gate and audit
emission, do not regress these four — they cover natural surface and
should stay GREEN through the rest of the rollout.

## MR-1 — KU-1 / KU-3 disposition

Per `roadmap.json::known_unknowns_handed_off_to_deliver`:

- **KU-1** (`removal.target_release` semver string) — deferred to MR-5. MR-1
  does not emit `failure-simulation.config.deprecated`; the field's content
  is the MR-5 dispatcher's call. DISTILL's `SEMVER_REGEX` shape assertion
  is the contract; any well-shaped semver string satisfies it.
- **KU-3** (`detectUnknownSignals` middleware placement order) — moot at
  MR-1. The MR-1 surface exposes the function for direct invocation; the
  middleware-position decision is deferred to MR-2 when the composition
  roots are wired. No DISTILL test depends on a middleware order at MR-1.

KU-2 (stdout-capture helper choice) was resolved in DISTILL.

## MR-2 — ui-state composition-root `probe()` deferred to MR-4

The MR-2 dispatch task description names ui-state's composition root as a
second site for `probe(process.env, "ui-state")` (alongside agent's). MR-2
lands the agent-side wiring + `registerInspectionRoutes` per ADR-036 and the
roadmap exit criteria, but **defers** the ui-state-side `probe()` call to
MR-4 (the phase-1 migration MR) for these reasons:

1. **No MR-2 test depends on ui-state's startup emission.** Every gate-event
   scenario in `test_us_consol_2_environment_gate.py` and
   `test_contract_assertions.py::test_ca_3/4/9` calls `probe()` directly
   from a node subprocess via the driver. None of them spawn ui-state.
2. **ui-state is not a `package.json` workspace in npm root config**
   (root `package.json` lists `frontend`, `agent`, `auth-proxy`,
   `shared/chat`, `shared/failure-simulation`). Adding the workspace dep
   `@dashboard-chat/shared-failure-simulation: "*"` to `ui-state/package.json`
   would either require:
   - Promoting ui-state to a workspace (changes 3 files but breaks
     `ui-state/Dockerfile`, which does a standalone `npm install --no-package-lock`
     and would fail to resolve the workspace package), OR
   - A `file:../shared/failure-simulation` protocol path AND extending the
     ui-state docker build context to include `../shared/failure-simulation`.

   Both touch the production image build path. MR-4 already plans to migrate
   ui-state's six knob callsites to `shouldInject(KNOB.x, ctx)`, at which
   point the workspace promotion is justified by the actual import need.
   Bundling the build-system change into the migration MR keeps MR-2's
   exit criteria honest.
3. **CA-7 still passes** because the inspection probes live in `agent/`
   (ADR-036), not in ui-state. The agent's `probe()` + `registerInspectionRoutes`
   are what gate `/debug/*` 404 vs 200.

**Disposition:** ui-state's `probe()` is wired in MR-4 alongside the
callsite migration. The ADR-036 invariant "every service that imports
the registry calls `probe()` at startup" is satisfied at the time
ui-state actually imports the registry — i.e., when its knob callsites
move to `shouldInject(...)`.

## MR-2 — header transport rendering uses canonical-name title-case prefix

The DESIGN component-design.md spec (`matchTransport()` pseudocode) names
a helper `renderHeader(entry)` without fixing the rendering algorithm. MR-2
implements it as kebab-case → Title-Case-Kebab with `X-` prefix:

```
force-create-session-failure  ⇒  X-Force-Create-Session-Failure
```

The DISTILL tests assert on the exact header string `X-Force-Create-Session-Failure`
etc., so the algorithm is implicit in the test contract. Documented here so
US-CONSOL-5 (new-knob walkthrough) doesn't have to re-derive it: a knob
named `force-list-projects-failure` renders as `X-Force-List-Projects-Failure`.

## MR-2 — event + body-field rendering bridges phase-1 legacyAlias

For event and body-field transports, MR-2 accepts BOTH the legacyAlias
value AND the canonical post-rename value during the phase-1 overlap window
(ADR-038):

| Knob | Canonical (post-MR-5) | Phase-1 legacy (today) |
|---|---|---|
| `force-failure-tag` | `__force_failure__` | `__harness_force_failure__` |
| `expire-token` | `__expire_token__` | `__harness_expire_token__` |
| `force-reissue-failures` (body) | `force_reissue_failures` | `harness_force_reissue_failures` |

The MR-2 transport-match implementation derives the canonical event/field
name from `legacyAlias.transportValue` by stripping the `__harness_` /
`harness_` prefix (NOT from `entry.name` — the `force-failure-tag` canonical
name does not render to `__force_failure_tag__`; the test contract calls for
`__force_failure__`). MR-5 drops the `legacyAlias` field and the canonical
rendering becomes the single source.

