<!-- markdownlint-disable MD024 -->

# Fault-Injection Consolidation — User Stories

DISCUSS-wave deliverable. Personas are developers and operators, not end users; the fault-injection knobs exist to make acceptance suites deterministic, not to ship behavior. Stories follow LeanUX template (Problem / Who / Solution / Examples / UAT / AC / KPIs / Notes). Each story is S-sized (1-3 days) and intended to land as one merge request via `gt mq submit`.

## Vocabulary note

This DISCUSS pass deliberately retires the overloaded word "harness" as a category descriptor. Throughout these stories:

- **fault injection** is the category — the mechanism for forcing deterministic failures at port boundaries (industry-standard term; matches Istio, AWS FIS, chaos-engineering literature).
- **inspection probes** (or **inspection endpoints**) are the read-only observability endpoints exposed under `/debug/*` on the agent service. These are *not* fault injection; they are observation. The consolidation gates both with the same ENVIRONMENT mechanism, but the boundary between the two categories is documented.
- **fault-injection knob** is one specific lever (header, event, or body field) that forces one specific failure.
- **fault-injection registry** is the consolidated module/manifest.
- The TypeScript test-runner directory at `tests/acceptance/user-flow-state-machines/harness/` ("UserFlowHarness") is a proper noun and is unchanged.
- The product names do not carry "nwave" — nwave-ai is the SDLC tool that drives this codebase but is not part of the system under development.

## System Constraints (cross-cutting)

These apply to every story below. They are not re-stated per-story.

- **ADR-028 (machines are leaves)**: no machine imports another machine. The consolidated registry is a *service the machines depend on*, not a state-graph mixin. State-injection events (the renamed `__force_failure__`, `__expire_token__`) remain machine-local; the registry only mediates the env-gate, the manifest, and the audit log.
- **ADR-029 (X-Active-Scope is production contract)**: test-only headers and production-contract headers must remain visually and structurally distinguishable. The naming scheme cannot collide with `X-Active-Scope`, `X-Org-Id`, `X-User-Email`, or any other header an operator might encounter in a real request.
- **ADR-033/034 (source-tree directories named for body of source)**: location of the new module is a DESIGN-wave decision; the story commits to *consolidation*, not to a particular path. Recommended path (see `open-questions.md` Q2): `shared/fault-injection/` (precedent: `shared/chat/`).
- **Brownfield**: the 6 existing knobs already power 25+ acceptance scenarios across `tests/acceptance/project-and-chat-session-management/`. No knob is being removed or having its semantics re-litigated. Wire-compatibility on the *firing* path is mandatory until US-CONSOL-4 lands an explicit migration. The legacy *names* (`__harness_*`, `harness_force_reissue_failures`, `NWAVE_HARNESS_KNOBS`) are deprecated and renamed in US-CONSOL-4's migration scope.
- **Personas**: "Devon" = backend/full-stack engineer adding or modifying a fault-injection knob. "Olivia" = operator deploying the stack; she never *uses* knobs but is the implicit beneficiary of the safer environment gate.

---

## US-CONSOL-1: Unified fault-injection registry with consistent naming

### Problem

Devon is writing a new acceptance scenario and needs to force a specific failure at a port boundary. He opens the codebase and finds three conventions in use for the same intent: `X-Force-*` HTTP headers for the JS-side actors, `__harness_*` XState events for the login machine, and a body-field `harness_force_reissue_failures` for one specific route. The conventions encode the same intent — force a deterministic failure for the next port-boundary call — but Devon has to grep three locations to discover what's available, and the word "harness" means six different things in this codebase (env-var gates, force-failure headers, the TS UserFlowHarness, debug endpoints, body-field flags). He copies the wrong pattern, gets a knob that fires at the wrong layer, and burns half a day debugging why his scenario passes locally but flakes in CI.

### Who

- **Devon**, backend/full-stack engineer authoring an acceptance scenario.
- Works in `ui-state/lib/machines/` and `tests/acceptance/<feature>/` daily.
- Motivation: write one new scenario without learning three knob dialects or decoding which "harness" the codebase means in any given file.

### Solution

A single in-repo manifest (`fault-injection.manifest.ts` or equivalent — DESIGN decides shape) lists every knob with: canonical name, transport (header / event / body-field), port boundary it targets, owning service, and the production guarantee that it is unreachable. Discovery is one file-read, not three grep sessions. Naming follows a single scheme across transports — DESIGN selects the scheme from the candidates in `open-questions.md`. The word "harness" is retired from the category vocabulary; the registry is the *fault-injection registry*.

### Domain Examples

#### 1: Happy path — Devon adds a scenario forcing a session-create failure

Devon opens `fault-injection.manifest.ts`, sees `force-create-session-failure` listed with transport `header`, copies the header name, drops it into his pytest fixture, scenario goes RED. He never opens `session-chat.ts`.

#### 2: Edge case — Devon needs a brand-new knob (a 7th)

Devon adds an entry to `fault-injection.manifest.ts` describing his new knob. Without the entry, the runtime gate refuses to honor the knob even with `ENVIRONMENT=dev`. CI runs a manifest-vs-implementation drift check (see US-CONSOL-3 / US-CONSOL-5 for the enforcement mechanism); a knob referenced in code without a manifest entry fails the gate.

#### 3: Error path — Devon mis-names a knob in his scenario

Scenario sends `X-Force-Crete-Session-Failure` (typo). The registry logs `unknown fault-injection knob "force-crete-session-failure" — see fault-injection.manifest.ts` and returns the request unchanged. The scenario fails loudly with a referenced manifest entry, not silently with a passing happy-path response.

### UAT Scenarios (BDD)

#### Scenario: Devon discovers every available knob in one file

Given Devon is writing a new acceptance scenario in `tests/acceptance/project-and-chat-session-management/`
When he opens the fault-injection manifest file
Then he sees every existing knob listed with its canonical name, transport, target port boundary, and owning service
And the manifest is the single source of truth referenced by both production-side gates and test-side fixtures

#### Scenario: A knob outside the manifest is rejected at runtime

Given a request arrives carrying a header (or event, or body-field) matching the fault-injection naming scheme
And no manifest entry exists for that name
When the fault-injection registry evaluates the request
Then the knob is treated as no-op
And a `fault-injection.unknown` log entry is emitted with the offending name
And the underlying request proceeds with its normal (un-forced) behavior

#### Scenario: An unknown-knob typo surfaces a discoverable error

Given Devon sends a request with header `X-Force-Crete-Session-Failure: transient` (typo of `Create`)
When the fault-injection registry processes the header
Then the response body or trailer contains a list of valid knob names (or a pointer to the manifest)
And Devon's failing scenario message references "see fault-injection manifest" instead of failing silently

### Acceptance Criteria

- [ ] One manifest file lists all 6 existing knobs by canonical name
- [ ] Every knob entry declares: canonical name, transport, target port boundary, owning service, gate behavior in each ENVIRONMENT tier
- [ ] Unknown knob names are no-ops with structured warning emitted (not silent pass-through)
- [ ] Typo'd knob names surface a discoverable hint pointing at the manifest

### Outcome KPIs

- **Who**: developers adding acceptance scenarios.
- **Does what**: discovers available knobs from one file instead of three locations.
- **By how much**: knob-discovery time drops from ~15 min (current grep dance) to <2 min (single file open).
- **Measured by**: time-to-first-knob in a new dev's first acceptance scenario, sampled from `git log --follow` on the acceptance suite.
- **Baseline**: ~15 min based on the audit conversation that produced this DISCUSS.

### Technical Notes

- DESIGN owns the manifest schema and serialization choice (TS object vs YAML vs Zod schema).
- The manifest is *not* deleted in production — it ships with the bundle but the gate refuses to honor any entry when ENVIRONMENT is staging or production (see US-CONSOL-2).
- Naming scheme is *not* finalized in this story — see `open-questions.md`. US-CONSOL-1 commits to a unified scheme; DESIGN picks the actual scheme. DISCUSS recommends keeping `X-Force-*` for headers and dropping the `harness` prefix from events and body fields (verb-only canonical names).

---

## US-CONSOL-2: Environment-tiered gate replaces single-boolean fault-injection switch

### Problem

Olivia (operator) accidentally sets `NWAVE_HARNESS_KNOBS=true` in the staging compose overlay during a debugging session. The staging environment is auth-proxy-protected but reachable from any developer's laptop. A misconfigured pipeline merges the overlay and ships the flag to staging for two days. Nothing breaks visibly — but during that window, anyone with a valid staging token can send `X-Force-Create-Session-Failure: transient` and DoS every session-create call. The current single-boolean gate offers no defense in depth: one env-var flip is the entire security surface. Devon doesn't know this either; he assumed the flag was "tests only" because `docker-compose.yml` set it for the dev compose service. Compounding the confusion: the env var carries an `NWAVE_` prefix that mistakenly suggests it's part of the nwave-ai SDLC tooling rather than a fault-injection gate on the system under development.

### Who

- **Olivia**, the operator deploying the stack to staging or production.
- **Devon** (secondary), the engineer reading the gate logic and reasoning about safety.
- Motivation: make it *structurally impossible* to expose the fault-injection surface in a prod-shaped environment, not just policy-impossible. Also: stop pretending nwave-ai (a developer tool) has anything to do with runtime production safety.

### Solution

The fault-injection registry reads a higher-order `ENVIRONMENT` variable (values: `dev`, `ci`, `staging`, `production`) and honors knobs only when `ENVIRONMENT in {dev, ci}`. If DESIGN chooses Q1.b (defense-in-depth, see `open-questions.md`), a second flag `FAULT_INJECTION_ENABLED` (or whichever DESIGN selects) composes with AND: both must permit. The legacy `NWAVE_HARNESS_KNOBS` env var is *deprecated* — read but logged-as-deprecated when present; replaced fully in US-CONSOL-4. The registry logs the gate decision on startup so operators see `fault-injection.gate.disabled environment=staging` in container logs.

### Domain Examples

#### 1: Happy path — Devon runs the acceptance suite locally

Container starts with `ENVIRONMENT=dev`. Registry logs `fault-injection.gate.enabled environment=dev tier=permissive`. Acceptance scenarios send `X-Force-Create-Session-Failure` and the failure fires deterministically.

#### 2: Edge case — Olivia ships staging with the legacy `NWAVE_HARNESS_KNOBS=true` left over from a debugging session

Container starts with `ENVIRONMENT=staging` AND `NWAVE_HARNESS_KNOBS=true` (the deprecated flag). Registry logs `fault-injection.gate.disabled environment=staging reason=environment_tier_denies` plus a deprecation warning for the legacy flag. Every subsequent `X-Force-*` header is ignored. Olivia's misconfiguration is contained by the ENVIRONMENT gate even though the legacy flag is misset.

#### 3: Error path — Production deploy without `ENVIRONMENT` set at all

Container starts with neither variable set. Registry logs `fault-injection.gate.disabled environment=<unset> reason=fail_closed default_tier=production`. The default is restrictive (production-equivalent) — fail-closed, never fail-open. Olivia's missing config does not accidentally enable knobs.

### UAT Scenarios (BDD)

#### Scenario: Production environment rejects every knob invocation

Given a service is running with `ENVIRONMENT=production`
And the deprecated `NWAVE_HARNESS_KNOBS=true` is also set (worst-case misconfiguration)
When a request arrives carrying any fault-injection header, event, or body field
Then the knob is treated as no-op
And a `fault-injection.rejected` log entry is emitted with reason `environment_tier_denies`
And the underlying request proceeds with its normal (un-forced) behavior
And no `/debug/*` inspection-probe route is registered on any service

#### Scenario: Staging environment rejects every knob invocation by default

Given a service is running with `ENVIRONMENT=staging`
When a request arrives carrying a fault-injection header
Then the knob is treated as no-op
And the gate decision is logged at startup as `fault-injection.gate.disabled environment=staging`

#### Scenario: dev and ci environments permit knob invocation

Given a service is running with `ENVIRONMENT=dev` (or `ENVIRONMENT=ci`)
And the knob is registered in the manifest (see US-CONSOL-1)
When a request arrives carrying that knob
Then the knob fires its registered effect
And a `fault-injection.fired` audit entry is emitted (see US-CONSOL-3)

#### Scenario: Unset ENVIRONMENT defaults to production-restrictive

Given a service starts with no `ENVIRONMENT` value at all
When the fault-injection registry initializes
Then the gate defaults to the most restrictive tier (production-equivalent)
And every subsequent knob invocation is rejected
And a startup log entry warns `ENVIRONMENT unset — defaulting to production-restrictive gate`

#### Scenario: Inspection-probe endpoints are not registered outside dev/ci

Given a service starts with `ENVIRONMENT=staging` or `ENVIRONMENT=production`
When the agent service initializes its Hono router
Then no route is registered for `GET /debug/last-request-scope`, `GET /debug/request-log`, or `POST /debug/request-log/clear`
And a request to any of those paths returns 404 (route absent), not 403 (route present but denied)

### Acceptance Criteria

- [ ] Gate honors `ENVIRONMENT in {dev, ci}` only; staging and production deny all knobs
- [ ] Unset `ENVIRONMENT` fails closed (defaults to production-restrictive)
- [ ] Gate decision logged at service startup, once, with environment value and verdict
- [ ] Inspection-probe endpoints (`/debug/*` on agent) are conditionally registered — absent (404) outside dev/ci, not present-and-denied (403)
- [ ] Behavior is identical regardless of `NWAVE_HARNESS_KNOBS` value when `ENVIRONMENT` is staging or production
- [ ] If DESIGN selects a defense-in-depth companion flag (Q1.b), behavior is identical regardless of that flag's value when `ENVIRONMENT` is staging or production

### Outcome KPIs

- **Who**: any malicious or accidental request sender targeting staging or production.
- **Does what**: can no longer fire a fault-injection knob via header, event, or body-field.
- **By how much**: 0 of 6 knobs reachable in staging/production (down from 6 of 6 today if the boolean flag is misset).
- **Measured by**: a hostile-environment integration test that asserts every knob is no-op when `ENVIRONMENT=production`.
- **Baseline**: today, the single boolean is the only line of defense; misconfiguration in staging exposes the full surface.

### Technical Notes

- The interaction between `ENVIRONMENT` and the optional defense-in-depth flag is intentionally deferred to `open-questions.md` Q1 — DESIGN drafts an ADR before this story is built.
- `ENVIRONMENT` value semantics (4 tiers vs N tiers, casing, default value) is a DESIGN decision.
- This story does not touch the existing knobs' wire format — it only adds a stricter gate above them. Migration to the new naming scheme (event prefix drop, body-field prefix drop, legacy env-var deprecation) is US-CONSOL-4.

---

## US-CONSOL-3: Structured audit log of every fault-injection invocation

### Problem

Devon's acceptance scenario passes in CI but fails locally. He suspects a knob fired in CI that didn't fire locally (or vice versa), but the current implementation has no audit trail — knobs fire silently. He drops `console.log` calls into `project-context.ts`, `session-chat.ts`, and `login-and-org-setup.ts`, reruns the suite, fishes through container logs, and burns an afternoon reconstructing what happened. The on-call rotation has the same problem if a staging incident ever traces back to "a knob shouldn't have fired here": the only evidence is the *behavior* of the broken request, not a structured record of which knob the request triggered.

### Who

- **Devon**, debugging a flaky or environment-divergent scenario.
- **On-call engineer**, investigating an incident where the suspicion (rightly or wrongly) is "a knob fired in a non-dev tier".
- Motivation: fault-injection firings should be first-class observable events, not implicit side-effects of grep-able strings in source.

### Solution

The fault-injection registry emits one structured log entry per knob invocation containing: knob canonical name, transport, request correlation id (where available), ENVIRONMENT tier, gate verdict (`fired` / `rejected` / `unknown`), and timestamp. Sink is a DESIGN decision (`open-questions.md`), but the emission point is owned by this story.

### Domain Examples

#### 1: Happy path — Devon traces a flaky scenario

Devon greps container logs for `fault-injection.fired` and sees three entries with correlation id `abc-123`, one per knob fired during the scenario. He matches them to his pytest output and immediately identifies that the CI run fired a fourth knob that the local run didn't.

#### 2: Edge case — Audit entry survives the request lifecycle

A knob fires inside `createSessionEagerlyFn` (an XState actor running in a worker context). The audit entry still carries the correlation id propagated from the originating HTTP request, so Devon can join the worker-side audit row to his HTTP-side scenario assertion.

#### 3: Error path — On-call investigates a suspected misfire

An incident postmortem questions whether a knob fired in staging. On-call queries the log sink for `fault-injection.fired environment=staging` over the incident window. Either result (rows present → real issue, rows absent → eliminate the hypothesis) is a definitive answer in <2 minutes.

### UAT Scenarios (BDD)

#### Scenario: A fired knob emits a structured audit entry

Given the fault-injection registry is enabled (`ENVIRONMENT=dev`)
And a knob is registered in the manifest
When a request fires the knob
Then exactly one log entry is emitted with event name `fault-injection.fired`
And the entry contains the knob's canonical name, transport, request correlation id (when available), and ENVIRONMENT tier
And the entry is parseable as structured JSON (or whichever format DESIGN selects)

#### Scenario: A rejected knob emits a distinct audit entry

Given the fault-injection registry is gated off (`ENVIRONMENT=staging`)
When a request carries a knob header
Then a log entry is emitted with event name `fault-injection.rejected`
And the entry contains the requested knob name, the ENVIRONMENT tier, and the rejection reason

#### Scenario: An unknown knob emits a warning audit entry

Given a request carries a knob name not present in the manifest
When the fault-injection registry processes the request
Then a log entry is emitted with event name `fault-injection.unknown`
And the entry contains the offending name and a pointer to the manifest file

#### Scenario: Audit entries are absent when no knob is present

Given a normal request with no fault-injection headers, events, or body fields
When the fault-injection registry processes the request
Then no `fault-injection.*` log entries are emitted (audit is invocation-triggered, not request-triggered)

### Acceptance Criteria

- [ ] Every knob invocation produces exactly one structured audit entry
- [ ] Audit entry fields: canonical name, transport, ENVIRONMENT tier, verdict, correlation id (when available), timestamp
- [ ] Three verdict types: `fired`, `rejected`, `unknown`
- [ ] No audit entry for requests that carry no knob (no per-request overhead)
- [ ] Audit emission survives the XState actor / worker boundary (correlation id propagates)

### Outcome KPIs

- **Who**: developers and on-call engineers investigating fault-injection divergence.
- **Does what**: identifies which knobs fired in which run using a structured log query.
- **By how much**: time-to-evidence drops from ~30 min (grep + reasoning) to <5 min (single log query).
- **Measured by**: time-to-resolution on the next knob-divergence investigation, qualitative.
- **Baseline**: today, no audit trail; reconstruction is via behavioral inference.

### Technical Notes

- Sink (stdout, dedicated Redis stream, OTel span) is a DESIGN decision — see `open-questions.md`.
- The audit emission point lives in the fault-injection registry; the production callsites in machines/actors should not embed `console.log` calls of their own.
- This story does not introduce a query UI or aggregation layer — that's an operator-facing concern outside this DISCUSS scope.
- The audit log is for fault-injection events only. The `/debug/*` inspection probes (a different category — read-only observability) have their own logging surface and are not in scope for this story.

---

## US-CONSOL-4: Migrate the 6 existing knobs to the consolidated surface without breaking acceptance scenarios

### Problem

US-CONSOL-1, 2, and 3 design the new registry, but the 6 existing knobs power 25+ acceptance scenarios across `tests/acceptance/project-and-chat-session-management/test_us201_*`, `test_us202_*`, `test_us206_*`, `test_us207_*` (and US-208 once it lands). Devon can't switch the production code over to the new registry without simultaneously updating every fixture and assertion — but doing both in one MR makes the diff unreviewable and the rollback story incoherent. Olivia can't validate the gate behavior change against a moving wire contract. This story is the *migration* — the bridge from "scattered" to "consolidated" — and it is itself an MR-shaped unit of work that must not regress any of the 25+ scenarios. The migration additionally handles the *vocabulary cleanup* that the DISCUSS revision prompt mandated: drop `harness` from event/body names, deprecate `NWAVE_HARNESS_KNOBS`.

### Who

- **Devon**, executing the migration MR.
- **Reviewer** (Devon's peer), validating that no acceptance scenario regressed.
- Motivation: ship the consolidation in a way that lets the acceptance suite act as the safety net, not the casualty.

### Solution

A staged migration with three checkpoints:

1. **Adapter phase**: the new fault-injection registry is introduced. Existing callsites in `project-context.ts`, `session-chat.ts`, `login-and-org-setup.ts`, `ui-state/index.ts`, `agent/index.ts`, `agent/lib/chat/requestLog.ts` are rewritten to call the registry. The wire contract (header names, event names, body field) stays byte-identical on the firing path so the existing fixtures still work. The acceptance suite passes unchanged in this checkpoint.
2. **Vocabulary cleanup phase**: deprecated names are renamed in lockstep across production and acceptance suites:
   - `__harness_force_failure__` → `__force_failure__`
   - `__harness_expire_token__` → `__expire_token__`
   - `harness_force_reissue_failures` body field → `force_reissue_failures`
   - `NWAVE_HARNESS_KNOBS` env var → deprecated (read with warning; behavior unchanged for one release; replaced by `ENVIRONMENT` per US-CONSOL-2 and the defense-in-depth flag DESIGN selects in Q1)
   - HTTP headers `X-Force-*` — **unchanged** (DISCUSS recommends keeping; "force" is precise; `X-Inject-Force-*` is verbose-redundant). See open-questions.md Q4.
3. **Wire-contract phase 3 (optional)**: if DESIGN selects Q4.c (verb-noun canonical names everywhere), a third phase renames any remaining transport-specific encodings. Currently not anticipated to be needed.

This story commits to phases 1 and 2. Phase 3, if needed, is a follow-up story scoped after DESIGN's naming decision.

### Domain Examples

#### 1: Happy path — adapter phase

Devon's MR replaces the direct check `if (forceFailure())` in `createProjectFn` with `faultInjection.shouldForce("force-create-project-failure", { transport: "header", req })`. The check still reads the `X-Force-Create-Project-Failure` header (byte-identical wire). Full acceptance suite (`cd tests/acceptance/project-and-chat-session-management && uv run --no-project pytest`) is green. US-201/202/206/207 scenarios unchanged.

#### 2: Edge case — a knob with two transports must route through the same registry

`force_reissue_failures` (after rename from `harness_force_reissue_failures`) is a *body-field* knob, not a header. The adapter must route both transports through one registry call: `faultInjection.shouldForce("force-reissue-failures", { transport: "body", req })`. The reviewer specifically inspects this case in the migration MR.

#### 3: Error path — a scenario regresses mid-migration

Devon runs the suite and `test_us207_project_switching_is_atomic.py` fails. The failure message includes the audit log lines from US-CONSOL-3 showing which knobs *did* fire. Devon sees that `X-Force-Create-Session-Failure` was no longer wired through `session-chat.ts:createSessionEagerlyFn`. He reverts that callsite, the scenario goes green, and he ships the partial migration. The remaining callsite is a separate atomic commit.

#### 4: Vocabulary cleanup edge case — `NWAVE_HARNESS_KNOBS` deprecation logging

During phase 2, Devon runs the dev compose service with the legacy `NWAVE_HARNESS_KNOBS=true` still set in his local `.env`. Startup logs:

```
fault-injection.gate.enabled environment=dev tier=permissive
fault-injection.config.deprecated env=NWAVE_HARNESS_KNOBS replacement=FAULT_INJECTION_ENABLED migrate_by=v2.0.0
```

Knobs still fire (backwards compatible) but the deprecation is loud.

### UAT Scenarios (BDD)

#### Scenario: Acceptance suite passes against the adapter phase

Given the migration MR has rewritten all 6 knob callsites to route through the fault-injection registry
And the firing-path wire contract is unchanged from pre-migration (adapter phase only)
When the full acceptance suite runs (`cd tests/acceptance/project-and-chat-session-management && uv run --no-project pytest`)
Then all scenarios that previously passed still pass
And no scenario was modified in the adapter-phase commits (production code only)

#### Scenario: Vocabulary-cleanup commits rename both production and tests atomically

Given the vocabulary-cleanup phase is reviewed
When the reviewer reads each rename commit (e.g. `__harness_force_failure__` → `__force_failure__`)
Then the commit modifies both the production source and the affected acceptance fixtures
And the commit is green at HEAD (suite passes with the rename applied on both sides)

#### Scenario: Each knob callsite is rewritten atomically

Given the migration MR is composed of atomic commits per CLAUDE.md commit convention
When the reviewer reads the commit log
Then each commit migrates one logical callsite (one knob, one file) or one rename
And each commit's acceptance suite run is green at HEAD of that commit

#### Scenario: Pre-existing acceptance scenarios are the safety net

Given a regression is introduced mid-migration
When the acceptance suite runs
Then at least one scenario fails with a message that names the specific knob that no longer fires
And the failure points to the fault-injection audit log (`fault-injection.fired` absence or `fault-injection.unknown` presence)

#### Scenario: `NWAVE_HARNESS_KNOBS` is deprecated, not deleted

Given the migration MR lands
And a developer's local environment still sets `NWAVE_HARNESS_KNOBS=true`
When the dev compose service starts
Then the fault-injection registry honors the legacy flag (behavior unchanged)
And a deprecation warning is emitted at startup naming the replacement env var

### Acceptance Criteria

- [ ] All 6 knobs (4 headers, 1 body field, 1 event family) route through the new fault-injection registry
- [ ] Firing-path wire contract is byte-identical to pre-migration on completion of phase 1 (adapter)
- [ ] Phase 2 renames (`__harness_*` → `__force_*` / `__expire_*`; body field `harness_force_reissue_failures` → `force_reissue_failures`; deprecated `NWAVE_HARNESS_KNOBS`) land in atomic commits, each green at HEAD
- [ ] Each callsite migration is a separate atomic commit
- [ ] Full acceptance suite green at HEAD of each commit (not just final HEAD)
- [ ] Migration MR does not change ENVIRONMENT gate behavior (US-CONSOL-2 lands separately)
- [ ] `NWAVE_HARNESS_KNOBS` is deprecated (read with warning, behavior preserved) — not deleted

### Outcome KPIs

- **Who**: future-Devon doing the next migration or refactor in this area.
- **Does what**: locates all fault-injection firings via the registry's API, not via grep across 6 files.
- **By how much**: callsite count for "where do knobs live" drops from 6 files to 1 module.
- **Measured by**: `grep -r "X-Force-\\|__force_\\|force_reissue_failures" --include="*.ts" -l | wc -l` returns 1 (the registry file) plus the manifest, instead of today's 6.
- **Baseline**: today, the grep (using the old patterns) returns matches across `ui-state/index.ts`, `project-context.ts`, `session-chat.ts`, `login-and-org-setup.ts`, `agent/index.ts`, `agent/lib/chat/requestLog.ts`.

### Technical Notes

- Phase 2 vocabulary cleanup *does* touch `tests/acceptance/` (event names and body field name appear in fixtures). This is the one intentional exception to the "no test changes" rule that applies to phase 1.
- Acceptance suite is the safety net — the migration cannot proceed if any pre-migration scenario fails.
- The agent service's `/debug/*` inspection-probe endpoints are part of the migration: the conditional-registration logic moves into the fault-injection registry's startup hook (despite the probes being a separate category, they share the ENVIRONMENT gate). The boundary is documented in `journey.md` and in `open-questions.md` Q2.

---

## US-CONSOL-5: Knob-sprawl friction — adding a 7th knob requires manifest registration

### Problem

The audit that produced this DISCUSS revealed that the 6 existing fault-injection knobs grew organically — each was added when a new acceptance scenario needed it, with no review checkpoint asking "should this be a knob at all, or should the test use a contract test / fixture / fake?" Devon (six months from now) will be tempted to add a 7th knob the same way: drop a header check into wherever it's convenient, write the scenario, ship it. Without friction at the *adding* step, the surface keeps growing. The user has already agreed (out-of-scope for this DISCUSS) that contract tests are the long-term answer — but in the meantime, the act of adding a new knob should at least be deliberate and reviewable.

### Who

- **Devon**, adding a 7th knob.
- **Reviewer**, evaluating Devon's knob-addition MR.
- Motivation: make knob-addition friction *just high enough* that the right conversation happens, without blocking legitimate additions.

### Solution

Two mechanisms compose:

1. **Manifest registration is mandatory**: a knob referenced in production code without a manifest entry is treated as `unknown` at runtime (US-CONSOL-1) and fails a CI lint check. Devon literally cannot add a knob without editing `fault-injection.manifest.ts`.
2. **Manifest entry requires a justification field**: each entry includes a free-text `rationale` field referencing the user story (US-2xx) the knob exists to enable, plus a `contract_test_alternative_considered` boolean. Reviewer evaluates the rationale.

This is friction, not blockade. The intent is to surface the decision, not refuse it.

### Domain Examples

#### 1: Happy path — Devon adds a 7th knob for US-209

Devon adds an entry: `{ name: "force-list-projects-failure", transport: "header", target: "list-projects", owning_service: "ui-state", rationale: "US-209 requires deterministic list-projects 5xx", contract_test_alternative_considered: false }`. Reviewer asks "why not contract test?" — Devon answers, reviewer accepts, MR lands.

#### 2: Edge case — Devon ships a knob without manifest entry

Devon adds `X-Force-List-Projects-Failure` to `ui-state/index.ts` but forgets the manifest entry. CI runs the manifest-vs-source drift check, finds the header string in source without a corresponding manifest entry, fails the build with `fault-injection knob "force-list-projects-failure" referenced in ui-state/index.ts:217 has no manifest entry`. Devon's MR is blocked at CI, not at runtime in production.

#### 3: Error path — Devon adds a knob with empty rationale

Devon adds the manifest entry but leaves `rationale: ""`. The schema validation (TS type, Zod, JSON schema — DESIGN picks) rejects the empty string. CI fails. Devon must articulate the rationale or revert.

### UAT Scenarios (BDD)

#### Scenario: A knob without a manifest entry fails CI

Given a developer adds a string match for a fault-injection knob name in production code
And no corresponding manifest entry exists
When the CI lint check runs
Then the check fails with a message naming the offending file, line, and missing manifest entry
And the developer cannot merge the MR until the manifest is updated

#### Scenario: A manifest entry requires a non-empty rationale

Given a developer adds a manifest entry with `rationale: ""` (or omits the field)
When schema validation runs (CI or local)
Then validation fails with a message pointing at the empty rationale
And the developer is prompted to articulate why the knob is needed instead of a contract test

#### Scenario: Adding a 7th knob is reviewable in one MR

Given a developer adds a 7th knob (manifest entry + production-side wiring + acceptance scenario using it)
When the reviewer reads the MR
Then the manifest entry shows the rationale and contract-test-considered flag
And the reviewer can evaluate the knob-vs-contract-test tradeoff without reading the wiring code first

### Acceptance Criteria

- [ ] CI fails if production code references a knob name not in the manifest
- [ ] Manifest schema requires non-empty `rationale` and explicit `contract_test_alternative_considered` boolean
- [ ] Each manifest entry references the user story (US-2xx) it exists to enable
- [ ] Adding a 7th knob is a normal MR (no special process), just with the manifest entry and rationale

### Outcome KPIs

- **Who**: developer adding a new fault-injection knob.
- **Does what**: pauses to articulate rationale and consider contract-test alternative.
- **By how much**: target a measurable conversation in 100% of knob-addition MRs (rationale field is non-empty and reviewer has commented on it).
- **Measured by**: spot-check of the next 3 knob-addition MRs after consolidation lands.
- **Baseline**: today, knobs are added without a review checkpoint specific to their existence.

### Technical Notes

- The CI lint check is a separate concern — likely a small node script grepping for known knob-name patterns and cross-referencing the manifest. DESIGN decides the exact mechanism.
- This story does not enforce that contract tests *are* written — only that the alternative is considered. The user explicitly placed contract-test migration out of scope for this DISCUSS.

---

## Stories explicitly deferred

These were considered and held back, in keeping with the right-sizing principle. Listed here so reviewers see what was *not* bundled:

- **Replace any specific knob with a contract test** — out of scope per the prompt.
- **Remove the `/debug/*` inspection-probe endpoints** — their existence is settled; the consolidation just gates them via the same ENVIRONMENT mechanism. The category boundary between fault-injection knobs and inspection probes is documented in `open-questions.md` Q2.
- **Build a query UI or aggregation layer on the audit log** — operator-facing observability is its own thing.
- **Final renaming of `X-Force-*` headers (if DESIGN chooses Q4.c or Q4.b in open-questions.md)** — depends on DESIGN's naming decision; currently anticipated to be unnecessary because `X-Force-*` is already precise.

---

## Scope Assessment: PASS — 5 stories, 2-3 modules (ui-state + agent + manifest), estimated 6-8 days total

Each story is independently MR-shaped. US-CONSOL-1, 2, 3 can land in parallel (different production-side surfaces). US-CONSOL-4 depends on 1 (manifest must exist). US-CONSOL-5 depends on 1 (registration mechanism must exist). US-CONSOL-4's phase 2 (vocabulary cleanup) is the only phase that touches `tests/acceptance/` — phase 1 (adapter) is production-only.
