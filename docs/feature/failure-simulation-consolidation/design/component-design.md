# Component Design — Failure-Simulation Registry

DESIGN-wave deliverable for `failure-simulation-consolidation`. This document
specifies the registry's internal shape — type signatures, gate
evaluation algorithm, machine/middleware-facing API, audit-emitter
interface, declaration site for new knobs, and the step-by-step "add a
7th knob" walkthrough.

**DESIGN-wave discipline:** this document fixes interfaces and
algorithms, not implementations. The DELIVER wave writes the source
files; this document is the binding contract those source files satisfy.

## Module layout (reprise from ADR-036)

```
shared/failure-simulation/
  package.json              # @dashboard-chat/shared-failure-simulation
  tsconfig.json
  BUILD.bazel
  index.ts                  # public API re-exports
  manifest.ts               # the 6 typed entries (the SSOT data)
  manifest.schema.ts        # Zod schema + TS types
  gate.ts                   # EVAL_GATE + probe()
  registry.ts               # shouldInject() + transport matching
  audit.ts                  # structured event emitter
  transports.ts             # rendering rules (header / event / body-field)
  __fixtures__/
    manifest-golden.ts      # frozen reference for tests
```

## Manifest entry type signature

```ts
// shared/failure-simulation/manifest.schema.ts

export type KnobTransport = 'header' | 'event' | 'body-field';
export type OwningService = 'ui-state' | 'agent';
export type EnvironmentTier = 'dev' | 'ci' | 'staging' | 'production';
export type GatePolicy = 'permit' | 'deny';

/**
 * Verb-noun kebab-case canonical name. Pattern: ^[a-z][a-z0-9-]*[a-z0-9]$.
 * Used as the source of truth across audit log, manifest lookup, and CI
 * lint check.
 */
export type KnobCanonicalName = string & { readonly __brand: 'KnobCanonicalName' };

export interface KnobManifestEntry {
  readonly name: KnobCanonicalName;
  readonly transport: KnobTransport;
  readonly target: string;                  // e.g. "createSession"
  readonly owningService: OwningService;
  readonly eventDistinguisher?: string;     // optional collision disambiguator
  readonly gate: Readonly<Record<EnvironmentTier, GatePolicy>>;
  readonly rationale: string;               // non-empty (Zod-validated)
  readonly contractTestAlternativeConsidered: boolean;
  readonly legacyAlias?: {                  // transitional; phase 1 only
    readonly transportValue: string;
    readonly removalCommit: 'phase-2';
  };
}

export const ManifestEntrySchema: ZodType<KnobManifestEntry>;
```

The branded `KnobCanonicalName` type protects against passing a raw
string at the `shouldInject()` boundary — TS will require an explicit
cast or a manifest lookup.

## Initial manifest contents

The DELIVER wave populates `manifest.ts` with these 6 entries (the
canonical-name renderings per ADR-038 are shown for reference; the
`legacyAlias` entries vanish after phase 2):

| `name` | `transport` | `target` | `owningService` | `legacyAlias` (phase 1) |
|---|---|---|---|---|
| `force-create-project-failure` | `header` | `createProject` | `ui-state` | none (already kebab-case via `X-Force-Create-Project-Failure`) |
| `force-list-sessions-failure` | `header` | `listSessions` | `ui-state` | none |
| `force-create-session-failure` | `header` | `createSession` | `ui-state` | none |
| `force-reissue-failures` | `body-field` | `chatBegin` | `agent` | `harness_force_reissue_failures` |
| `force-failure-tag` | `event` | `loginAndOrgSetup.authenticating` | `ui-state` | `__harness_force_failure__` |
| `expire-token` | `event` | `loginAndOrgSetup.authenticated` | `ui-state` | `__harness_expire_token__` |

Every entry has `gate: { dev: 'permit', ci: 'permit', staging: 'deny',
production: 'deny' }`, a non-empty `rationale` field referencing the
relevant US-2xx, and `contractTestAlternativeConsidered: false` for the
existing six (none of them was authored under the new sprawl-friction
mechanism).

## Gate evaluation algorithm (`gate.ts`)

### Type signatures

```ts
export interface GateVerdict {
  readonly state: 'enabled' | 'disabled';
  readonly reason: 'both_permit' | 'environment_tier_denies' | 'flag_denies';
  readonly tier: EnvironmentTier | 'unset' | 'unknown';
  readonly flag: 'true' | 'false' | 'unset';
}

export interface EnvSource {
  readonly ENVIRONMENT?: string;
  readonly FAILURE_SIMULATION_ENABLED?: string;
  readonly NWAVE_HARNESS_KNOBS?: string;     // legacy, deprecated
}

export function evalGate(env: EnvSource): GateVerdict;

export function probe(env: EnvSource, serviceName: OwningService): GateVerdict;
```

### Algorithm (specification — pseudocode mirrors ADR-035)

```
evalGate(env: EnvSource) -> GateVerdict:
  tier = readTier(env.ENVIRONMENT)
  flag = readFlag(env)

  if tier in {'production', 'staging', 'unset', 'unknown'}:
    return { state: 'disabled', reason: 'environment_tier_denies', tier, flag }

  // tier is now 'dev' or 'ci'
  if flag != 'true':
    return { state: 'disabled', reason: 'flag_denies', tier, flag }

  return { state: 'enabled', reason: 'both_permit', tier, flag }


readTier(raw: string | undefined) -> EnvironmentTier | 'unset' | 'unknown':
  if raw is undefined or empty: return 'unset'
  normalized = raw.trim().toLowerCase()
  if normalized in {'dev', 'ci', 'staging', 'production'}: return normalized
  return 'unknown'


readFlag(env: EnvSource) -> 'true' | 'false' | 'unset':
  if env.FAILURE_SIMULATION_ENABLED is set:
    return parseBool(env.FAILURE_SIMULATION_ENABLED)

  if env.NWAVE_HARNESS_KNOBS is set:
    emitDeprecationEvent({
      env_legacy: 'NWAVE_HARNESS_KNOBS',
      env_replacement: 'FAILURE_SIMULATION_ENABLED',
      removal_target_release: <DELIVER decides>
    })
    return parseBool(env.NWAVE_HARNESS_KNOBS)

  return 'unset'


parseBool(s: string) -> 'true' | 'false':
  // Strict parse. Only the literal string 'true' is true.
  if s.trim().toLowerCase() == 'true': return 'true'
  return 'false'
```

### `probe()` semantics

```
probe(env, serviceName) -> GateVerdict:
  verdict = evalGate(env)

  emitStartupEvent({
    event_name: verdict.state == 'enabled'
      ? 'failure-simulation.gate.enabled'
      : 'failure-simulation.gate.disabled',
    service_name: serviceName,
    gate_tier: verdict.tier,
    gate_flag: verdict.flag,
    gate_reason: verdict.reason,
    inspection_probes_registered: <set by caller after registration>,
    manifest_knob_count: manifest.length
  })

  return verdict
```

`probe()` is called exactly once per process by the composition root.
It is idempotent on the env (same env produces same verdict), but
emits the startup event only once because the composition root only
calls it once. A second call (test scenario) would emit a second event;
production code calls it once.

## Machine/middleware-facing API (`registry.ts`)

The single API every callsite consumes. This is the dependency the
failure-simulation registry exposes to the rest of the codebase.

### Type signatures

```ts
export interface InjectionContext {
  /** Incoming request headers, or undefined when not a request-scoped call. */
  readonly headers?: HeadersInit | undefined;

  /** Incoming request body parsed as a record, or undefined. */
  readonly body?: Record<string, unknown> | undefined;

  /** XState event being processed, or undefined. */
  readonly event?: { readonly type: string } | undefined;

  /** Correlation id for audit-log propagation. */
  readonly correlationId?: string | undefined;

  /** The service emitting the call (for audit envelope). */
  readonly serviceName: OwningService;
}

/**
 * The single decision point every callsite calls. Returns true iff the
 * knob should fire its registered effect at the call site.
 *
 * Semantics:
 *   - If the gate verdict is disabled AND the context carries a knob
 *     name matching this knob's transport-rendering: emit
 *     failure-simulation.rejected; return false.
 *   - If the gate verdict is enabled AND the context carries this
 *     specific knob: emit failure-simulation.fired; return true.
 *   - If the gate verdict is enabled AND the context carries a knob
 *     name NOT in the manifest (typo, removed knob): emit
 *     failure-simulation.unknown; return false.
 *   - If the context carries no knob: emit nothing; return false.
 *
 * Throws iff `knobName` is not a known KnobCanonicalName at compile
 * time (i.e. the caller passed a raw string). At runtime this throws
 * UnknownKnobError pointing at the manifest file.
 */
export function shouldInject(
  knobName: KnobCanonicalName,
  ctx: InjectionContext
): boolean;

/**
 * CI-side helper used by the manifest-vs-source drift check. Throws if
 * `name` is not in the manifest.
 */
export function assertKnown(name: string): asserts name is KnobCanonicalName;
```

### Callsite ergonomics

Before consolidation (today, in `ui-state/index.ts`):

```ts
if (req.headers.get('X-Force-Create-Session-Failure') === 'transient' &&
    process.env.NWAVE_HARNESS_KNOBS === 'true') {
  return c.json({ error: 'forced' }, 500);
}
```

After consolidation (the same callsite):

```ts
if (shouldInject(KNOB.forceCreateSessionFailure, {
  headers: req.headers,
  correlationId,
  serviceName: 'ui-state',
})) {
  return c.json({ error: 'forced' }, 500);
}
```

`KNOB` is a typed accessor exported from `shared/failure-simulation/`:

```ts
export const KNOB = {
  forceCreateProjectFailure: 'force-create-project-failure' as KnobCanonicalName,
  forceListSessionsFailure: 'force-list-sessions-failure' as KnobCanonicalName,
  forceCreateSessionFailure: 'force-create-session-failure' as KnobCanonicalName,
  forceReissueFailures: 'force-reissue-failures' as KnobCanonicalName,
  forceFailureTag: 'force-failure-tag' as KnobCanonicalName,
  expireToken: 'expire-token' as KnobCanonicalName,
} as const;
```

The const-object pattern gives Devon autocomplete and prevents typos at
the call site: `KNOB.forceCreateSesionFailure` (typo) is a TS error
before the test runs.

### How `shouldInject()` decides

Internal flow inside `registry.ts`:

```
shouldInject(knobName, ctx) -> boolean:
  entry = manifest.find(e => e.name == knobName)
  if entry is undefined:
    throw new UnknownKnobError(knobName, manifest.path)

  verdict = gate.cachedVerdict()       // set once by probe()

  // Determine whether the context carries THIS knob's wire signal.
  signalPresent = matchTransport(entry, ctx)

  if !signalPresent:
    return false                        // no audit; normal request

  if verdict.state == 'disabled':
    audit.emit({
      event_name: 'failure-simulation.rejected',
      service_name: ctx.serviceName,
      knob_name: entry.name,
      knob_transport: entry.transport,
      reason: verdict.reason,
      gate_tier: verdict.tier,
      gate_flag: verdict.flag,
      correlation_id: ctx.correlationId,
    })
    return false

  audit.emit({
    event_name: 'failure-simulation.fired',
    service_name: ctx.serviceName,
    knob_name: entry.name,
    knob_transport: entry.transport,
    knob_value: extractTransportValue(entry, ctx),
    target_port: entry.target,
    owning_service: entry.owningService,
    correlation_id: ctx.correlationId,
  })
  return true


matchTransport(entry, ctx) -> boolean:
  if entry.transport == 'header':
    headerName = renderHeader(entry)              // 'X-Force-Create-Session-Failure'
    return ctx.headers?.has(headerName) ?? false

  if entry.transport == 'event':
    eventName = renderEventOrLegacy(entry)        // '__force_failure__' or legacyAlias
    return ctx.event?.type == eventName

  if entry.transport == 'body-field':
    fieldName = renderFieldOrLegacy(entry)        // 'force_reissue_failures' or legacyAlias
    return ctx.body?.[fieldName] != null

  return false
```

### How unknown knob names produce `failure-simulation.unknown`

The `shouldInject()` API receives a `KnobCanonicalName` — by definition
a manifest entry exists. Unknown names arrive when:

1. A request carries a header / event / body field matching the
   transport convention but not corresponding to any manifest entry
   (Devon's typo case).
2. The dispatch code that routes from "incoming wire signal" to
   "manifest lookup" cannot find a match.

The registry exposes a separate dispatch entrypoint for this case:

```ts
/**
 * Called by middleware at the request boundary to detect unknown
 * failure-simulation signals that don't correspond to any manifest entry.
 * Emits failure-simulation.unknown for each unknown signal found.
 */
export function detectUnknownSignals(ctx: InjectionContext): void;
```

The middleware in `ui-state/index.ts` and `agent/index.ts` calls
`detectUnknownSignals()` after request parsing, before the route
handlers run. The function is a no-op when no knob-pattern signals are
present and emits `failure-simulation.unknown` for each unrecognized
signal otherwise.

## Audit-log emitter interface (`audit.ts`)

```ts
export type AuditEvent =
  | FailureSimulationFiredEvent
  | FailureSimulationRejectedEvent
  | FailureSimulationUnknownEvent
  | FailureSimulationGateEnabledEvent
  | FailureSimulationGateDisabledEvent
  | FailureSimulationConfigDeprecatedEvent;

export function emit(event: AuditEvent): void;
```

Each event type is a discriminated union member with the exact shape
specified in ADR-037. The implementation writes
`console.log(JSON.stringify(event))` on a single line. The Zod schemas
mirroring each type sit in `manifest.schema.ts` alongside the manifest
schema (one schema file for the whole package).

### Cross-actor correlation-id propagation

When `shouldInject()` is called from inside an XState actor (e.g.
`createSessionEagerlyFn` running in a worker context), the
`InjectionContext.correlationId` must be set explicitly by the caller.
The orchestrator (per ADR-028) threads correlation ids into actor input
via XState's `input` parameter:

```ts
// ui-state/lib/orchestrator.ts (conceptual)
const projectMachine = spawnChild('project-context', {
  input: { correlationId, principalId }
});

// project-context.ts internal actor invocation:
const createSessionFn = fromPromise(async ({ input }) => {
  if (shouldInject(KNOB.forceCreateSessionFailure, {
    headers: input.requestHeaders,
    correlationId: input.correlationId,
    serviceName: 'ui-state',
  })) {
    throw new Error('forced session-create failure');
  }
  // ... normal path
});
```

The propagation is a property of the actor's `input` schema, which
ADR-028 already commits the team to. This component design adds the
`correlationId` field to that input schema where it isn't already
present.

## How a knob registers itself (declaration site)

The manifest entry is the declaration. Knobs do not register themselves
imperatively at module load — they are declared as data in
`manifest.ts`. The Zod schema validates each entry at module load; an
entry that fails validation crashes the import with a clear error.

The declaration site is one file. There is no decorator, no
registration call, no annotation. Devon adds an entry; that is the
registration.

## How a new knob is added (the 7th-knob walkthrough)

Walk-through of US-CONSOL-5's intent: Devon adds a new knob `force-list-
projects-failure` for a hypothetical US-209 scenario. The mechanism
ensures the registration is deliberate.

### Step 1 — Devon adds the manifest entry

Edit `shared/failure-simulation/manifest.ts`. Append:

```ts
{
  name: 'force-list-projects-failure' as KnobCanonicalName,
  transport: 'header',
  target: 'listProjects',
  owningService: 'ui-state',
  gate: { dev: 'permit', ci: 'permit', staging: 'deny', production: 'deny' },
  rationale: 'US-209: deterministic 5xx on list-projects to validate empty-state fallback under partial-failure',
  contractTestAlternativeConsidered: false,
}
```

**File touched:** `shared/failure-simulation/manifest.ts` (single addition).

### Step 2 — Devon adds the typed accessor

Edit the `KNOB` const object in `shared/failure-simulation/index.ts` (or
wherever the const lives):

```ts
export const KNOB = {
  // ... existing 6 entries
  forceListProjectsFailure: 'force-list-projects-failure' as KnobCanonicalName,
} as const;
```

**File touched:** `shared/failure-simulation/index.ts`.

### Step 3 — Devon wires the production-side callsite

Edit `ui-state/index.ts` (or whichever module handles the `GET
/api/projects` request):

```ts
app.get('/api/projects', async (c) => {
  if (shouldInject(KNOB.forceListProjectsFailure, {
    headers: c.req.raw.headers,
    correlationId: c.get('correlationId'),
    serviceName: 'ui-state',
  })) {
    return c.json({ error: 'forced' }, 500);
  }
  // ... normal handler
});
```

**File touched:** `ui-state/index.ts`.

### Step 4 — Devon writes the acceptance scenario

Edit (or create) the relevant pytest file under
`tests/acceptance/project-and-chat-session-management/`. The scenario
sends `X-Force-List-Projects-Failure: transient` and asserts the 500
response.

**File touched:** one pytest file.

### Step 5 — Devon runs the acceptance suite

```
cd tests/acceptance/project-and-chat-session-management
uv run --no-project pytest tests/test_us209_*.py
```

Scenario goes RED (no production code change yet), then GREEN once
step 3's wiring is in place. The audit log shows
`failure-simulation.fired name=force-list-projects-failure` in the test
output.

### Step 6 — Devon submits the MR via `gt mq submit`

The refinery runs `./tools/test/test.sh --auto`. The merge-queue
gate runs the manifest-vs-source drift check; the new manifest entry
matches the new source-side reference; CI is green.

### Reviewer's checks (from US-CONSOL-5)

1. The MR diff contains exactly: the new manifest entry, the new
   accessor, the production-side wiring, the acceptance scenario.
2. The rationale field is non-empty and references a user story.
3. The `contractTestAlternativeConsidered` field is explicit (true or
   false; no default).
4. The reviewer evaluates the knob-vs-contract-test trade-off based on
   the rationale.

### What stops Devon from skipping the manifest?

Three independent enforcement layers (the Earned-Trust ArchUnit-style
trio from principle 12):

1. **TS compile-time:** the `KnobCanonicalName` branded type means
   passing `'force-list-projects-failure'` to `shouldInject()` without
   the cast (i.e. without declaring the manifest entry) is a type
   error.
2. **Manifest-vs-source drift check (CI):** a small node script grep-
   matches every `X-Force-*` / `__force_*__` / `__expire_*__` /
   `force_*` pattern in production source and verifies each
   corresponds to a manifest entry. Failures block the merge queue.
3. **Runtime probe (test-time):** the CI gold test loads each service's
   composition root and asserts `probe()` emits the expected manifest
   count. A new knob without manifest registration would not appear in
   the count and would either not fire (with `failure-simulation.unknown`
   in the audit log) or fail the count assertion.

Three orthogonal layers. Bypassing one is caught by the other two.

## Failure modes the design defends against

| Failure mode | Defense |
|---|---|
| Devon adds a header check without a manifest entry | TS branded type rejects untyped string; CI drift check rejects unregistered name |
| Devon types `force-crete-session-failure` (typo) in a fixture | `detectUnknownSignals` emits `failure-simulation.unknown` with manifest-path pointer; assertion fails on missing `failure-simulation.fired` |
| Olivia sets `ENVIRONMENT=DEV` (uppercase) in staging by mistake | Normalized to `dev`; flag still required; `FAILURE_SIMULATION_ENABLED` is unset in staging → verdict disabled |
| Olivia sets `ENVIRONMENT=marketing` (unknown tier) | `readTier` returns `'unknown'`; verdict disabled with `environment_tier_denies` |
| Devon forgets to call `probe()` in a service's composition root | CI gold test fails because no `failure-simulation.gate.*` event is emitted at startup |
| A knob fires in an actor with no correlation-id input | Audit entry emits without `correlation_id` field (optional); test fixture failure surfaces the missing thread |
| A knob fires twice for one request | Two `failure-simulation.fired` audit entries — the count is itself the diagnostic signal; no silent dedup |
| `console.log` is monkey-patched in a test and swallows the audit event | CI gold test captures stdout via process-level pipe, not via mocked `console.log` |

## Performance characteristics

The registry is on the request hot path. Required characteristics:

- **`probe()`**: called once per process. Allowed to allocate, parse, log.
  Cost is irrelevant.
- **`shouldInject()`**: called per knob-bearing request. Must be O(1) on
  the cached verdict path. Manifest lookup is a `Map<string, entry>`
  build at module load (~6 entries today, ~10–20 entries at growth
  ceiling). Header / body / event match is one read.
- **`audit.emit`**: called per knob-bearing request (0 for normal
  requests per ADR-037 ordering rules). Synchronous `console.log`. Cost
  acceptable given the rate (failure simulation is acceptance-test-driven,
  not production-traffic-driven).
- **`detectUnknownSignals`**: called per request at middleware boundary.
  Must short-circuit cheaply on the dominant case (no knob signals
  present): one header-prefix check, one body-field-prefix check, one
  event-name-prefix check. Total: 3 string-prefix comparisons in the
  no-knob case.

No allocation per request in the no-knob path. The non-trivial costs
are bounded to knob-bearing requests, which by construction are
test/dev-environment requests.

## Versioning posture

The `@dashboard-chat/shared-failure-simulation` package is internal-only.
No external consumers. Semver discipline within the monorepo: a
breaking change to the manifest schema or the `shouldInject()` signature
is a follow-up ADR. The `legacyAlias` field is the only transitional
shape ADR-038 commits to; it is removed in phase 2 atomically.
