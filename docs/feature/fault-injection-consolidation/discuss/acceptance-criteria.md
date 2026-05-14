<!-- markdownlint-disable MD024 -->

# Fault-Injection Consolidation — Acceptance Criteria

Given-When-Then scenarios for each of US-CONSOL-1..5. Scenario titles describe *business outcomes for Devon/Olivia*, not implementation details (no "Registry sets a flag" or "Manifest object has a key"). The acceptance suite expansion implied by these scenarios is itself a DISTILL-wave deliverable — this document defines the contract, not the test code.

## Naming choices in this document

- **Headers**: HTTP headers retain the `X-Force-*` convention (e.g. `X-Force-Create-Session-Failure`). Justification: `X-Force-*` is already precise and self-documenting; `X-Inject-Force-*` is verbose-redundant; `X-Fault-Inject-*` adds a category prefix without adding clarity. The user's revision prompt explicitly noted "force is precise" — this document honors that. See `open-questions.md` Q4 for the full naming-scheme decision matrix.
- **Events**: XState event names drop the `__harness_` prefix to verb-only: `__force_failure__`, `__expire_token__`. Rename lands in US-CONSOL-4 phase 2.
- **Body fields**: `harness_force_reissue_failures` → `force_reissue_failures`. Rename lands in US-CONSOL-4 phase 2.
- **Audit-log event names**: `fault-injection.fired` / `fault-injection.rejected` / `fault-injection.unknown` (was `harness.knob.*`).
- **Gate startup log event**: `fault-injection.gate.enabled` / `fault-injection.gate.disabled` (was `harness.gate.*`).
- **Module/registry**: "fault-injection registry" (was "harness module").
- **Inspection probes**: the `/debug/*` endpoints are called *inspection probes* throughout (not "harness debug endpoints" — they aren't fault injection, they're observation).

Story-to-scenario index:

| Story | Scenarios |
|---|---|
| US-CONSOL-1: Unified registry | 5 |
| US-CONSOL-2: Environment gate | 7 |
| US-CONSOL-3: Audit log | 5 |
| US-CONSOL-4: Migration | 6 |
| US-CONSOL-5: Sprawl friction | 4 |
| **Total** | **27 scenarios** |

27 new BDD scenarios across 5 stories. US-CONSOL-2 is on the upper edge at 7; US-CONSOL-4 grew to 6 to cover the vocabulary-cleanup phase (see DoR note on right-sizing).

---

## US-CONSOL-1: Unified fault-injection registry with consistent naming

### Scenario: A developer discovers every available knob in one file

Given Devon is writing a new acceptance scenario in `tests/acceptance/project-and-chat-session-management/`
When he opens the fault-injection manifest file
Then he sees a list of every existing knob with its canonical name, transport, target port boundary, and owning service
And the manifest is the single document referenced by both production-side gates and test-side fixtures
And he does not need to grep `ui-state/lib/machines/` or `agent/` to discover any knob

### Scenario: A knob outside the manifest is rejected at runtime

Given a request arrives carrying a header, event, or body field matching the fault-injection knob naming scheme
And no manifest entry exists for that name
When the fault-injection registry evaluates the request
Then the knob is treated as no-op
And a `fault-injection.unknown` log entry is emitted naming the offending knob
And the underlying request proceeds with normal (un-forced) behavior

### Scenario: A typo'd knob name surfaces a discoverable error

Given Devon sends a request with header `X-Force-Crete-Session-Failure: transient` (typo of `Create`)
When the fault-injection registry processes the request
Then the response logs a hint listing valid knob names or pointing to the manifest file
And Devon's failing scenario message references "see fault-injection manifest"

### Scenario: All 6 existing knobs are listed in the manifest after consolidation

Given the consolidation has landed (US-CONSOL-4 complete)
When the manifest file is read
Then it contains entries for:
  - `force-create-project-failure` (header transport — `X-Force-Create-Project-Failure`)
  - `force-list-sessions-failure` (header transport — `X-Force-List-Sessions-Failure`)
  - `force-create-session-failure` (header transport — `X-Force-Create-Session-Failure`)
  - `force-reissue-failures` (body-field transport — `force_reissue_failures`)
  - `force-failure-tag` (event transport — `__force_failure__`)
  - `expire-token` (event transport — `__expire_token__`)
And each entry includes canonical name, transport, target port boundary, owning service, and rationale

### Scenario: The manifest is the single source of truth across services

Given the `ui-state` service and the `agent` service both ship fault-injection knobs
When each service starts
Then both services read the same canonical manifest (whether by shared package import or shared schema file)
And neither service hardcodes a knob name that is absent from the manifest

---

## US-CONSOL-2: Environment-tiered gate

### Scenario: Production deployments reject every knob invocation

Given a service is running with `ENVIRONMENT=production`
And the deprecated `NWAVE_HARNESS_KNOBS=true` is also set (worst-case misconfiguration)
When a request arrives carrying any fault-injection header, event, or body field
Then the knob is treated as no-op for that request
And a `fault-injection.rejected` log entry is emitted with reason `environment_tier_denies`
And the underlying request proceeds with its normal behavior
And no `/debug/*` inspection-probe route is registered on any service

### Scenario: Staging deployments reject every knob invocation by default

Given a service is running with `ENVIRONMENT=staging`
When a request arrives carrying a fault-injection header
Then the knob is treated as no-op
And the gate decision is logged at startup as `fault-injection.gate.disabled environment=staging`
And no `/debug/*` inspection-probe route is registered

### Scenario: Dev and CI environments permit knob invocation

Given a service is running with `ENVIRONMENT=dev` (or `ENVIRONMENT=ci`)
And the knob is registered in the manifest
When a request arrives carrying that knob
Then the knob fires its registered effect
And a `fault-injection.fired` audit entry is emitted

### Scenario: Unset ENVIRONMENT defaults to production-restrictive

Given a service starts with no `ENVIRONMENT` value
When the fault-injection registry initializes
Then the gate defaults to the most restrictive tier
And every subsequent knob invocation is rejected
And a startup log entry warns `ENVIRONMENT unset — defaulting to production-restrictive gate`

### Scenario: Inspection-probe endpoints are absent (404), not denied (403), outside dev/ci

Given a service starts with `ENVIRONMENT=staging` or `ENVIRONMENT=production`
When the agent service initializes its Hono router
Then no route is registered for `GET /debug/last-request-scope`
And no route is registered for `GET /debug/request-log`
And no route is registered for `POST /debug/request-log/clear`
And a request to any of those paths returns HTTP 404

### Scenario: Gate verdict is logged exactly once at startup

Given a service starts in any environment tier
When the fault-injection registry initializes
Then exactly one structured log entry is emitted at startup
And the entry names the environment tier, the verdict (`enabled` or `disabled`), and the reason
And no per-request gate-status log is emitted (only per-invocation audit — see US-CONSOL-3)

### Scenario: Production behavior is independent of deprecated flag values

Given a service is running with `ENVIRONMENT=production`
When the same hostile request is replayed against `NWAVE_HARNESS_KNOBS=true`, `NWAVE_HARNESS_KNOBS=false`, and `NWAVE_HARNESS_KNOBS=unset`
Then the response is identical in all three cases (no knob fires, no inspection-probe route registered)
And the legacy flag has no observable effect outside `ENVIRONMENT in {dev, ci}`
And if DESIGN selects a defense-in-depth companion flag (`FAULT_INJECTION_ENABLED` or similar), it likewise has no observable effect in production

---

## US-CONSOL-3: Audit log

### Scenario: A fired knob emits exactly one structured audit entry

Given the fault-injection registry is enabled (`ENVIRONMENT=dev`)
And a knob is registered in the manifest
When a request fires the knob
Then exactly one log entry is emitted with event name `fault-injection.fired`
And the entry contains: canonical knob name, transport, ENVIRONMENT tier, correlation id (when available), timestamp
And the entry is parseable as structured data (JSON or whichever serialization DESIGN selects)

### Scenario: A rejected knob emits a distinct audit entry

Given the fault-injection registry is gated off (`ENVIRONMENT=staging`)
When a request carries a fault-injection knob header
Then exactly one log entry is emitted with event name `fault-injection.rejected`
And the entry contains the requested knob name, the ENVIRONMENT tier, and the rejection reason

### Scenario: An unknown knob emits a warning audit entry

Given a request carries a knob name not present in the manifest
And the fault-injection registry is enabled
When the fault-injection registry processes the request
Then exactly one log entry is emitted with event name `fault-injection.unknown`
And the entry contains the offending name and a pointer to the manifest file

### Scenario: Audit entries are absent for normal requests

Given a request carries no fault-injection header, event, or body field
When the fault-injection registry processes the request
Then no `fault-injection.*` log entries are emitted
And no per-request overhead is added to non-test traffic

### Scenario: Audit entries cross the actor / worker boundary

Given a knob fires inside an XState actor running outside the originating HTTP request context (e.g. `createSessionEagerlyFn`)
When the audit entry is emitted
Then the entry's correlation id matches the originating HTTP request's correlation id
And Devon can join the actor-side audit row to the test-side HTTP assertion

---

## US-CONSOL-4: Migration

### Scenario: Acceptance suite passes against the adapter phase

Given the migration MR has rewritten all 6 knob callsites to route through the fault-injection registry (phase 1 only)
And the firing-path wire contract (header names, event names, body field name) is byte-identical to pre-migration
When the full acceptance suite runs at the migration HEAD via `cd tests/acceptance/project-and-chat-session-management && uv run --no-project pytest`
Then every scenario that passed pre-migration still passes
And the suite reports zero new failures and zero new skips

### Scenario: Adapter-phase commits contain zero test changes

Given the migration MR's phase-1 (adapter) commits are reviewed
When the reviewer lists files modified under `tests/acceptance/` for those commits
Then the count is zero
And the only changed files in phase 1 are production sources, the new fault-injection registry, and the manifest

### Scenario: Vocabulary-cleanup commits rename production and tests atomically

Given the migration MR's phase-2 (vocabulary cleanup) commits are reviewed
When the reviewer reads each rename commit
Then the commit modifies both the production source and the affected acceptance fixtures atomically
And the affected name transitions are documented:
  - `__harness_force_failure__` → `__force_failure__`
  - `__harness_expire_token__` → `__expire_token__`
  - `harness_force_reissue_failures` body field → `force_reissue_failures`
  - `NWAVE_HARNESS_KNOBS` env var → deprecated (read with warning, behavior preserved)
And HTTP headers under `X-Force-*` are NOT renamed (DISCUSS decision per Q4)
And each rename commit is green at HEAD

### Scenario: Each knob migration is an atomic commit

Given the migration MR is composed per CLAUDE.md commit convention
When the reviewer reads the commit log
Then each commit migrates exactly one knob (one canonical name, possibly across multiple files for one logical knob) OR one rename
And each commit's acceptance suite is green at its HEAD (not only at the final HEAD)

### Scenario: A regression is caught by the acceptance suite, not by production behavior

Given a regression is introduced mid-migration (e.g. a callsite is no longer wired)
When the acceptance suite runs
Then at least one scenario fails
And the failure message references the specific knob that no longer fires
And the audit log (US-CONSOL-3) shows either the absent `fault-injection.fired` entry or a `fault-injection.unknown` entry

### Scenario: `NWAVE_HARNESS_KNOBS` is deprecated, not deleted, on migration completion

Given US-CONSOL-4 has landed
And a developer's local environment still sets `NWAVE_HARNESS_KNOBS=true`
When the dev compose service starts with `ENVIRONMENT=dev`
Then the fault-injection registry honors the legacy flag (knobs still fire)
And a startup log entry warns `fault-injection.config.deprecated env=NWAVE_HARNESS_KNOBS replacement=<DESIGN-selected name>`
And migration is independent of the ENVIRONMENT gate landing (US-CONSOL-2 lands separately)

---

## US-CONSOL-5: Sprawl friction

### Scenario: A knob without a manifest entry fails CI

Given a developer adds a string match for a fault-injection knob name in production code
And no corresponding manifest entry exists
When the CI lint check (or build gate) runs
Then the check fails with a message naming the offending file, line number, and missing manifest entry
And the MR cannot be merged via `gt mq submit` until the manifest is updated

### Scenario: A manifest entry requires a non-empty rationale

Given a developer adds a manifest entry with an empty or absent `rationale` field
When schema validation runs (locally or in CI)
Then validation fails with a message pointing at the empty rationale field
And the developer is prompted to articulate why the knob is needed instead of a contract test

### Scenario: A manifest entry requires explicit contract-test consideration

Given a developer adds a manifest entry without the `contract_test_alternative_considered` field
When schema validation runs
Then validation fails with a message pointing at the missing field
And the developer must explicitly set true or false (no default)

### Scenario: A 7th knob lands as a normal MR with manifest, wiring, and scenario

Given a developer follows the documented add-a-knob procedure
When their MR is reviewed
Then the diff contains exactly: a new manifest entry, the production-side wiring change, and the acceptance scenario using it
And the reviewer can evaluate the knob-vs-contract-test tradeoff by reading the rationale field
And the MR is mergeable via `gt mq submit` once the rationale is accepted

---

## Cross-story integration scenarios

These exist because the stories compose, and the composition itself has observable behavior.

### Scenario: All 6 existing knobs remain functional in the dev compose service after every story lands

Given US-CONSOL-1, 2, 3, 4, 5 have all landed
And the dev compose service runs with `ENVIRONMENT=dev` (and either the deprecated `NWAVE_HARNESS_KNOBS=true` or the DESIGN-selected replacement flag)
When the full acceptance suite runs
Then every scenario in `tests/acceptance/project-and-chat-session-management/` passes
And the audit log shows `fault-injection.fired` entries for each knob invocation
And the manifest lists all 6 knobs

### Scenario: A hostile-environment integration test asserts production safety

Given a one-off integration test (added in DISTILL) launches services with `ENVIRONMENT=production`
When the test replays every fault-injection header, event, and body field from the acceptance suite against the production-mode services
Then every replayed knob is no-op (request proceeds normally)
And every replayed `/debug/*` request returns 404
And the audit log shows `fault-injection.rejected` for every replayed knob
