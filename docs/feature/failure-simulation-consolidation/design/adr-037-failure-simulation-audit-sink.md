# ADR-037: Failure-Simulation Audit Sink — Structured stdout (JSON lines)

**Status:** Accepted (2026-05-14)
**Date:** 2026-05-14
**Originating wave:** DESIGN — `failure-simulation-consolidation`
**Resolves:** `docs/feature/failure-simulation-consolidation/discuss/open-questions.md` Q3
**Companion ADRs:** ADR-035 (gate composition), ADR-036 (module location), ADR-038 (naming + phase plan)

## Context

US-CONSOL-3 (`stories.md`) commits to a structured audit trail of every
failure-simulation invocation. The DISCUSS recommendation in
`open-questions.md` Q3 is structured stdout (JSON lines, OTel-compatible
field shape, no new infrastructure dependency). Two alternatives were
considered: a dedicated Redis stream and OpenTelemetry spans.

The use case has two consumers:

1. **Devon, debugging a flaky scenario.** "Did this knob fire in this run?"
   — answered by grepping container logs for `failure-simulation.fired
   correlation_id=<id>`.
2. **On-call, investigating a suspected misfire in staging or production.**
   "Did any knob fire here over the incident window?" — answered by
   querying the platform's log-aggregation tooling with the
   `failure-simulation.*` event-name filter.

Both use cases are well-served by structured stdout. The two alternatives
add infrastructure dependencies that the current operational maturity
does not warrant.

## Decision drivers

- **Zero new infrastructure.** The codebase's dominant logging pattern is
  already JSON-on-stdout (see `agent/lib/chat/requestLog.ts` for the
  precedent). Adopting Redis streams or OTel for one feature creates
  bespoke ops handling for a small benefit.
- **Existing log-aggregation tooling.** Whatever the platform team
  eventually deploys (Loki / CloudWatch / Datadog / Elastic / etc.)
  consumes JSON lines from container stdout. The schema this ADR fixes is
  portable across all of them.
- **Compatibility with OTel semantic conventions.** Field names follow
  OTel conventions (`event.name`, `service.name`, `correlation_id`) so
  that a future OTel migration is a transform, not a rewrite.
- **No retention concern in the registry.** Stdout is fire-and-forget; the
  container runtime captures it, the platform handles rotation. The
  registry has zero retention/rotation logic to maintain.
- **Earned Trust (principle 12).** The audit emitter is itself a
  dependency the gate trusts. The emitter's contract — "every call emits
  exactly one valid JSON line on stdout" — is verified by a CI gold-test
  that parses the captured stdout.

## Considered options

### Option A — Structured stdout, JSON lines — SELECTED

The registry calls a structured-log helper that writes one JSON object
per audit event to stdout. Container log collectors pick the lines up
through the standard logging pipeline.

**Trade-offs:**

- (+) Zero new infrastructure.
- (+) Works in dev, ci, staging, production (with the gate's verdict
  determining whether `fired` events occur).
- (+) Matches existing logging pattern; no new mental model.
- (+) Portable to any future log-aggregation choice.
- (−) Mixed with general request logs; structured filtering via
  `event.name` prefix is the discriminator.
- (−) No built-in deduplication; if a request fires the same knob twice
  (legitimate or not), two audit entries are emitted.

### Option B — Dedicated Redis stream

The registry pushes entries into a Redis stream
(`ui-state:failure-simulation:audit`).

**Trade-offs:**

- (−) Introduces a Redis dependency for the agent service, which today
  does not use Redis the way ui-state does.
- (−) Adds operational concerns (stream pruning, consumer groups).
- (−) Querying requires Redis client tooling rather than standard log
  queries.
- (+) Survives container restart (with appropriate stream config).
- Rejected: over-engineered for the present use case.

### Option C — OpenTelemetry spans/events

Each invocation is emitted as an OTel span event attached to the
originating request trace.

**Trade-offs:**

- (+) Correlation-id "free" via span context propagation.
- (−) Requires OTel SDK and exporter setup that the project does not yet
  have.
- (−) Heavier dependency footprint than the use case warrants.
- (+) Future evolution if observability stack matures.
- Rejected: premature given current operational maturity.

## Decision outcome

**Option A — Structured stdout (JSON lines).**

### Audit event schema

All audit events share a common envelope and have a per-event payload
shape. Field names follow OTel semantic conventions where applicable
(`event.name`, `service.name`).

#### Envelope (every event)

| Field | Type | Required | Description |
|---|---|---|---|
| `event.name` | string | yes | One of the event names below |
| `service.name` | string | yes | The emitting service (`ui-state`, `agent`) |
| `timestamp` | ISO-8601 string | yes | UTC timestamp of emission |
| `environment.tier` | string | yes | `dev` / `ci` / `staging` / `production` / `unset` / `unknown` |
| `correlation_id` | string | no | Request correlation id when available |

The envelope is structured-log friendly: one JSON object per line on
stdout. No trailing log-format prefixes (timestamps from a logger
framework are out of scope — services log directly via
`console.log(JSON.stringify(...))`).

#### Event 1: `failure-simulation.fired`

Emitted when the gate is enabled AND the knob is in the manifest AND the
request carries the knob.

| Field | Type | Required | Description |
|---|---|---|---|
| `knob.name` | string | yes | Canonical kebab-case name (e.g. `force-create-session-failure`) |
| `knob.transport` | string | yes | `header` / `event` / `body-field` |
| `knob.value` | string | no | The header/field value (e.g. `transient`). Omitted when no semantic value (boolean events). |
| `target.port` | string | yes | The port boundary this knob fires at (e.g. `createSession`, `createProject`, `verifyJwt`) |
| `owning.service` | string | yes | The service that consumes the knob (`ui-state`, `agent`) |

Example:

```json
{
  "event.name": "failure-simulation.fired",
  "service.name": "ui-state",
  "timestamp": "2026-05-14T10:42:00.123Z",
  "environment.tier": "dev",
  "correlation_id": "req-abc-123",
  "knob.name": "force-create-session-failure",
  "knob.transport": "header",
  "knob.value": "transient",
  "target.port": "createSession",
  "owning.service": "ui-state"
}
```

#### Event 2: `failure-simulation.rejected`

Emitted when the gate is disabled AND the request carries a knob name.
Single event per request — the registry does not double-emit `rejected`
for unknown names that are also gate-rejected.

| Field | Type | Required | Description |
|---|---|---|---|
| `knob.name` | string | yes | Canonical name (or raw incoming name if unrecognized but matches the convention) |
| `knob.transport` | string | yes | `header` / `event` / `body-field` |
| `reason` | string | yes | `environment_tier_denies` / `flag_denies` |
| `gate.tier` | string | yes | Echo of `environment.tier` for query-side filtering convenience |
| `gate.flag` | string | yes | One of `true` / `false` / `unset` |

Example:

```json
{
  "event.name": "failure-simulation.rejected",
  "service.name": "ui-state",
  "timestamp": "2026-05-14T10:42:01.456Z",
  "environment.tier": "staging",
  "correlation_id": "req-xyz-789",
  "knob.name": "force-create-session-failure",
  "knob.transport": "header",
  "reason": "environment_tier_denies",
  "gate.tier": "staging",
  "gate.flag": "true"
}
```

#### Event 3: `failure-simulation.unknown`

Emitted when the gate is enabled AND the request carries a knob name that
is not in the manifest. The gate verdict is enabled in this case
(otherwise `rejected` is emitted first and takes precedence).

| Field | Type | Required | Description |
|---|---|---|---|
| `knob.name.raw` | string | yes | The exact incoming name (header value, event type, body-field key) |
| `knob.transport` | string | yes | `header` / `event` / `body-field` |
| `manifest.path` | string | yes | Pointer to the manifest file for Devon to consult |

Example:

```json
{
  "event.name": "failure-simulation.unknown",
  "service.name": "ui-state",
  "timestamp": "2026-05-14T10:42:02.789Z",
  "environment.tier": "dev",
  "correlation_id": "req-typo-007",
  "knob.name.raw": "force-crete-session-failure",
  "knob.transport": "header",
  "manifest.path": "shared/failure-simulation/manifest.ts"
}
```

#### Event 4: `failure-simulation.gate.enabled` / `failure-simulation.gate.disabled`

Emitted exactly once per process, at the composition root, from `probe()`
(see ADR-035). The two event names are mutually exclusive per process
lifetime.

| Field | Type | Required | Description |
|---|---|---|---|
| `gate.tier` | string | yes | The resolved `ENVIRONMENT` tier |
| `gate.flag` | string | yes | One of `true` / `false` / `unset` (from `FAILURE_SIMULATION_ENABLED` / legacy) |
| `gate.reason` | string | yes | `both_permit` / `environment_tier_denies` / `flag_denies` |
| `inspection_probes_registered` | boolean | yes | Whether the agent's `/debug/*` routes were registered |
| `manifest.knob_count` | number | yes | Number of entries in the manifest at boot |

Example (enabled):

```json
{
  "event.name": "failure-simulation.gate.enabled",
  "service.name": "ui-state",
  "timestamp": "2026-05-14T10:00:00.000Z",
  "environment.tier": "dev",
  "gate.tier": "dev",
  "gate.flag": "true",
  "gate.reason": "both_permit",
  "inspection_probes_registered": false,
  "manifest.knob_count": 6
}
```

Example (disabled):

```json
{
  "event.name": "failure-simulation.gate.disabled",
  "service.name": "agent",
  "timestamp": "2026-05-14T10:00:00.001Z",
  "environment.tier": "staging",
  "gate.tier": "staging",
  "gate.flag": "true",
  "gate.reason": "environment_tier_denies",
  "inspection_probes_registered": false,
  "manifest.knob_count": 6
}
```

`inspection_probes_registered` is service-scoped: it is `true` only for
the `agent` service when the gate verdict is enabled. The `ui-state`
service does not register inspection probes — the field is always
`false` for ui-state's startup event.

#### Event 5: `failure-simulation.config.deprecated` (companion event)

Emitted at startup, alongside the gate event, when legacy env vars are
present. Not strictly an audit event, but documented here for
completeness because the migration deprecates `NWAVE_HARNESS_KNOBS`.

| Field | Type | Required | Description |
|---|---|---|---|
| `env.legacy` | string | yes | The deprecated variable name (e.g. `NWAVE_HARNESS_KNOBS`) |
| `env.replacement` | string | yes | The replacement variable name (e.g. `FAILURE_SIMULATION_ENABLED`) |
| `removal.target_release` | string | yes | Semver-shaped target removal version |

Example:

```json
{
  "event.name": "failure-simulation.config.deprecated",
  "service.name": "ui-state",
  "timestamp": "2026-05-14T10:00:00.002Z",
  "environment.tier": "dev",
  "env.legacy": "NWAVE_HARNESS_KNOBS",
  "env.replacement": "FAILURE_SIMULATION_ENABLED",
  "removal.target_release": "v2.0.0"
}
```

The `removal.target_release` semver value is the DELIVER wave's
responsibility — this ADR fixes the field name and intent, not the
specific version string.

### Retention and rotation

**None at the registry layer.** Stdout is fire-and-forget; the container
runtime captures it; the platform handles rotation, retention, and
aggregation. The registry has zero retention/rotation logic to
maintain.

Operational expectations the DESIGN wave commits to (handed off to
platform-architect):

- Container stdout is captured by the existing log pipeline (today, that
  is local docker-compose `logs` in dev/ci; the platform team will
  configure aggregated retention in staging/production when the time
  comes).
- The `event.name` prefix `failure-simulation.*` is the filter contract.
  Any aggregation tool that supports JSON-field filtering can query the
  audit trail without bespoke parsing.
- No deduplication, no rate-limiting at the audit layer. If a high
  volume of `rejected` events appears in staging or production, that is
  a security-relevant signal that should not be suppressed.

### Audit emission point and ordering

The audit emitter is a function inside `shared/failure-simulation/audit.ts`
called from `shouldInject()` (see `component-design.md`). Ordering rules:

1. `shouldInject()` evaluates the gate verdict.
2. If verdict is disabled AND a knob name was carried in the request:
   emit `failure-simulation.rejected`. Return false.
3. If verdict is enabled AND knob name is unknown: emit
   `failure-simulation.unknown`. Return false.
4. If verdict is enabled AND knob name is known: emit
   `failure-simulation.fired`. Return true.
5. If no knob name was carried: emit nothing. Return false.

Exactly one audit event per `shouldInject()` invocation that carries a
knob. Zero audit events for requests that carry none. The acceptance
scenario "Audit entries are absent for normal requests" (US-CONSOL-3 AC)
maps directly to rule 5.

### Earned Trust — audit emitter probe

The audit emitter is a dependency the gate trusts. Per principle 12, the
contract is verified empirically:

1. **CI gold test (catalogued substrate lies):** the registry's test
   suite captures stdout from the emitter for each event type, parses the
   captured line as JSON, and asserts the schema. Captures the substrate
   lie "the emitter calls `console.log` correctly but produces malformed
   JSON because of a bad serializer."
2. **Cross-service correlation-id propagation:** a behavioral test fires
   a knob from an XState actor running in a worker context and asserts
   that the emitted audit entry carries the originating HTTP request's
   correlation id. Captures the substrate lie "correlation id propagated
   to the actor's context but not to the audit envelope."
3. **Field-name AST check:** a small pre-commit AST script (added in
   DELIVER) verifies that every call to the audit emitter uses a field
   name from the schema above. Catches the substrate lie "a callsite
   added a new field that won't be parseable downstream."

This is the Earned-Trust contract on the audit emitter.

## Consequences

### Positive

- Zero new infrastructure dependencies.
- One file (`shared/failure-simulation/audit.ts`) owns the schema; every
  callsite is uniform.
- Schema is portable across log-aggregation tools (Loki / CloudWatch /
  Datadog / Elastic / etc.) by virtue of being plain JSON lines with
  OTel-aligned field names.
- The `event.name` prefix `failure-simulation.*` makes filter queries
  trivial.
- On-call has a definitive query: "any `failure-simulation.fired` over the
  incident window where `environment.tier in {staging, production}`?"
  is a one-line filter.
- Correlation id is carried through the actor/worker boundary by
  explicit field, which is testable.

### Negative / accepted trade-offs

- Mixed with general request logs in stdout. Mitigated by the
  `event.name` prefix as the filter contract.
- No survival across container restart (compared to a Redis stream).
  Acceptable because the use case is investigation, not state — and the
  platform's log retention is the durability layer.
- No automatic span correlation (compared to OTel). Acceptable because
  the explicit `correlation_id` field provides the same join key for
  the present use case.

### Neutral

- A future migration to OTel would replace `console.log(JSON.stringify)`
  with `tracer.startSpan(...).addEvent(...)`. The field shape is already
  OTel-compatible; the schema lift is bounded.
- Aggregation/UI on the audit trail is explicitly out of scope (see
  `stories.md` "Stories explicitly deferred").

## Open questions

None. Q3 from `open-questions.md` is resolved by this ADR.

## References

- `docs/feature/failure-simulation-consolidation/discuss/open-questions.md` — Q3
- `docs/feature/failure-simulation-consolidation/discuss/stories.md` —
  US-CONSOL-3
- OpenTelemetry semantic conventions for events:
  <https://opentelemetry.io/docs/specs/semconv/general/events/>
- `agent/lib/chat/requestLog.ts` — existing stdout-logging precedent
