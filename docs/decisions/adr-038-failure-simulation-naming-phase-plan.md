# ADR-038: Failure-Simulation Naming Scheme and Migration Phase Plan

**Status:** Accepted (2026-05-14)
**Date:** 2026-05-14
**Originating wave:** DESIGN — `failure-simulation-consolidation`
**Resolves:** `docs/evolution/2026-05-15-failure-simulation-consolidation/discuss/open-questions.md` Q4
**Companion ADRs:** ADR-035 (gate composition), ADR-036 (module location), ADR-037 (audit sink)

## Context

US-CONSOL-4 is the migration that bridges the scattered failure-simulation
surface (6 knobs across 6 files in `ui-state/` and `agent/`) to the
consolidated registry (`shared/failure-simulation/`, ADR-036). The
migration has two intertwined concerns:

1. **Naming.** Today's surface uses three transport-specific conventions
   (`X-Force-*` headers, `__harness_*` events, `harness_force_*` body
   field). The DISCUSS-wave naming-scheme recommendation in
   `open-questions.md` Q4 is: keep `X-Force-*` headers unchanged; drop
   the `harness_` prefix from events and body fields; the manifest's
   canonical name is verb-noun kebab-case, transport-agnostic.
2. **Phasing.** 25+ acceptance scenarios in
   `tests/acceptance/project-and-chat-session-management/` exercise the
   current knobs. The migration cannot regress any of them. The story
   commits to a three-phase plan (adapter → vocabulary cleanup →
   optional wire-rename); this ADR ratifies the phases and fixes the
   manifest schema that the registry consumes.

Memory `feedback_no_harness_no_nwave_in_product_names.md` constrains the
final naming: "harness" must not appear as a category descriptor; "nwave"
must not appear in any product-code name.

## Decision drivers

- **Stability wins where it can.** `X-Force-*` headers are already
  precise English. Renaming them costs every existing acceptance fixture
  for zero clarity gain.
- **Vocabulary cleanup is non-negotiable.** Events and body fields carry
  the `harness_` prefix; the prefix is the overloaded category descriptor
  the DISCUSS pass retired. They must rename.
- **Phasing must let the acceptance suite be the safety net.** Phase 1
  (adapter) keeps the wire identical so the existing suite passes
  unchanged. Phase 2 (vocabulary cleanup) renames events/body field in
  lockstep with the fixtures — atomic commits, each green at HEAD.
- **Atomic per-machine renames.** Each rename touches one canonical name
  in one machine and the test files exercising that name. The reviewer
  reads one rename per commit; the suite is green at HEAD of each.
- **Earned Trust (principle 12).** The manifest is a typed contract; the
  schema is enforced by Zod (or equivalent) at module load. The
  manifest-vs-source drift check is the empirical demonstration that
  every failure-simulation knob name referenced in production code has a
  corresponding manifest entry.

## Considered options on naming

### Option N1 — Keep all three conventions; just consolidate the gate

Headers stay `X-Force-*`, events stay `__harness_*`, body fields stay
`harness_force_*`. Only the registry/gate is consolidated.

- (−) Violates "retire harness as category descriptor" instruction.
- (−) Leaves three transport-specific conventions for Devon to remember.
- Rejected: the consolidation vocabulary explicitly retires `harness`.

### Option N2 — Headers `X-Force-*`; events drop `__harness_`; body fields drop `harness_` — SELECTED

Headers unchanged. Events: `__harness_force_failure__` →
`__force_failure__`; `__harness_expire_token__` → `__expire_token__`.
Body field: `harness_force_reissue_failures` → `force_reissue_failures`.
Manifest canonical name is kebab-case verb-noun, transport-agnostic.

- (+) Wire-identical on the dominant transport (headers) — no acceptance
  fixture change for the 3 header-transport scenarios.
- (+) Vocabulary cleanup on the two transports that carried `harness_`.
- (+) Manifest canonical name is the single source of truth; transports
  render from it.

### Option N3 — Rename headers to `X-Failure-Simulation-*` (full category prefix)

Headers become `X-Failure-Simulation-Create-Session-Failure` etc.

- (+) Maximum category-vocabulary consistency.
- (−) Every acceptance fixture changes for zero clarity gain.
- (−) "Force" is already precise (user's revision prompt explicitly
  noted this).
- Rejected.

### Option N4 — Rename headers to `X-Inject-Force-*` (compromise)

Headers become `X-Inject-Force-Create-Session-Failure`.

- (−) Verbose-redundant; "inject" + "force" is two synonyms for the same
  intent.
- Rejected.

## Decision outcome

**Option N2 — verb-noun canonical names; headers unchanged; events and
body field drop `harness_` prefix.**

### Naming scheme (canonical reference)

The manifest's canonical name is the source of truth. Per-transport
rendering is derived from it by the registry.

| Canonical name | Header rendering | Event rendering | Body-field rendering |
|---|---|---|---|
| `force-create-project-failure` | `X-Force-Create-Project-Failure` | n/a | n/a |
| `force-list-sessions-failure` | `X-Force-List-Sessions-Failure` | n/a | n/a |
| `force-create-session-failure` | `X-Force-Create-Session-Failure` | n/a | n/a |
| `force-reissue-failures` | n/a | n/a | `force_reissue_failures` |
| `force-failure-tag` | n/a | `__force_failure__` | n/a |
| `expire-token` | n/a | `__expire_token__` | n/a |

**Rendering rules** (encoded in `shared/failure-simulation/transports.ts`):

- Header rendering: `X-` + Title-Case-Hyphenated form of the canonical
  name (kebab-case → Title-Hyphenated by capitalizing each segment).
- Event rendering: `__` + snake-case form of the canonical name + `__`,
  with the canonical-name-specific rendering for cases where the verb
  differs (`force-failure-tag` → `__force_failure__` drops the `-tag`
  suffix because the manifest entry tags it with a distinguishing
  `eventDistinguisher` field).
- Body-field rendering: snake-case form of the canonical name.

The `force-failure-tag` canonical name carries an `eventDistinguisher`
because two distinct XState states emit `__force_failure__` events with
different semantic meanings; the manifest disambiguates them at the
service level even though they share the wire name. This is documented
in the manifest entry's `target.port` field.

### Manifest schema (TypeScript)

This is the typed shape every manifest entry conforms to. The DELIVER
wave implements the file; this ADR fixes the shape.

```ts
// shared/failure-simulation/manifest.schema.ts

export type KnobTransport = 'header' | 'event' | 'body-field';
export type OwningService = 'ui-state' | 'agent';
export type EnvironmentTier = 'dev' | 'ci' | 'staging' | 'production';
export type GatePolicy = 'permit' | 'deny';

export interface KnobManifestEntry {
  /**
   * Verb-noun kebab-case canonical name. Source of truth for this knob
   * across all transports, audit log entries, and CI lint checks.
   * Format: ^[a-z][a-z0-9-]*[a-z0-9]$
   */
  readonly name: string;

  /** The single transport this knob uses. */
  readonly transport: KnobTransport;

  /**
   * The port-boundary call this knob fires against. Used in audit log
   * `target.port` and in reviewer-readable diff context. Examples:
   * "createSession", "listSessions", "verifyJwt".
   */
  readonly target: string;

  /**
   * The service that consumes this knob and produces the failure.
   * Used to scope the audit log's `service.name` field.
   */
  readonly owningService: OwningService;

  /**
   * Disambiguator for cases where two manifest entries render to the
   * same wire name (e.g. `force-failure-tag` vs a hypothetical sibling
   * sharing `__force_failure__`). Optional; required only when the
   * transport-rendering function would otherwise produce a collision.
   */
  readonly eventDistinguisher?: string;

  /**
   * Per-tier gate policy. The matrix is always
   * { dev: 'permit', ci: 'permit', staging: 'deny', production: 'deny' }
   * today; the field is explicit so a future per-knob exception is
   * visible in the diff rather than encoded in the gate's algorithm.
   */
  readonly gate: Readonly<Record<EnvironmentTier, GatePolicy>>;

  /**
   * Required non-empty free-text explaining why this knob exists.
   * References the user story it enables (e.g. "US-206 lazy new-session
   * lifecycle error case"). US-CONSOL-5 schema validation rejects
   * empty/missing rationale.
   */
  readonly rationale: string;

  /**
   * Explicit yes/no from the author about whether a contract test was
   * considered as an alternative. No default — author must choose. The
   * value is informational; nothing in the runtime depends on it.
   * US-CONSOL-5 lint check verifies the field is present.
   */
  readonly contractTestAlternativeConsidered: boolean;
}

export const ManifestEntrySchema = /* Zod schema mirroring the type */;
export const Manifest: ReadonlyArray<KnobManifestEntry> = /* the 6 entries */;
```

The Zod schema enforces:

- `name` matches the kebab-case regex.
- `transport` is one of the three string literals.
- `target` and `rationale` are non-empty strings.
- `owningService` is one of the two service names.
- `gate` is a complete object with all four tier keys.
- `contractTestAlternativeConsidered` is present (true or false; no
  default).

### Phase plan for US-CONSOL-4

Three sequential phases, each implemented as a sequence of atomic
commits inside one MR. The acceptance suite (`cd tests/acceptance/project-
and-chat-session-management && uv run --no-project pytest`) must be
green at HEAD of every commit, not only at the final commit.

#### Phase 1 — Adapter (wire-identical; production-only edits)

**Goal:** rewrite the 6 callsites to call `shouldInject()` from
`shared/failure-simulation/`. Wire contract (header names, event names,
body field name) remains byte-identical to pre-migration so the existing
acceptance suite passes unchanged.

**Commits (one per logical callsite):**

1. `feat(shared): introduce failure-simulation registry skeleton + manifest with all 6 knobs (legacy wire names)`
   — adds the new package; manifest entries carry the canonical names
   AND a transitional `legacyAlias` field for the two transports that
   will rename in phase 2. The transport renderer reads the alias during
   phase 1.
2. `refactor(ui-state): route force-create-project-failure through the registry` — `ui-state/index.ts`, `ui-state/lib/machines/project-context.ts`.
3. `refactor(ui-state): route force-list-sessions-failure through the registry` — `ui-state/index.ts`.
4. `refactor(ui-state): route force-create-session-failure through the registry` — `ui-state/index.ts`, `ui-state/lib/machines/session-chat.ts`.
5. `refactor(agent): route force-reissue-failures through the registry` — `agent/index.ts` (still reading `harness_force_reissue_failures` body field).
6. `refactor(ui-state): route force-failure-tag through the registry` — `ui-state/lib/machines/login-and-org-setup.ts` (still receiving `__harness_force_failure__` event).
7. `refactor(ui-state): route expire-token through the registry` — `ui-state/lib/machines/login-and-org-setup.ts` (still receiving `__harness_expire_token__` event).
8. `refactor(agent): inspection probes register conditionally via registry verdict` — `agent/index.ts`, new `agent/lib/inspection/`.

After phase 1, every callsite is a `shouldInject()` call. The acceptance
suite passes unchanged. No test file is modified.

**Phase 1 acceptance check:** `git diff --stat` of phase-1 commits
shows zero files modified under `tests/acceptance/`.

#### Phase 2 — Vocabulary cleanup (atomic per-knob rename; production + tests together)

**Goal:** drop the `harness_` prefix from event names and the body
field. Each rename is one atomic commit that updates both production
source and the affected acceptance fixtures.

**Commits (one per rename):**

9. `refactor(ui-state,acceptance): rename __harness_force_failure__ → __force_failure__`
   — production: `ui-state/lib/machines/login-and-org-setup.ts`, manifest
   `legacyAlias` removed for `force-failure-tag`. Tests:
   `tests/acceptance/project-and-chat-session-management/test_us201_*`,
   `test_us202_*` (every fixture sending the event).
10. `refactor(ui-state,acceptance): rename __harness_expire_token__ → __expire_token__`
   — production: `ui-state/lib/machines/login-and-org-setup.ts`, manifest
   `legacyAlias` removed for `expire-token`. Tests: any fixture sending
   the event (login flow scenarios).
11. `refactor(agent,acceptance): rename harness_force_reissue_failures body field → force_reissue_failures`
   — production: `agent/index.ts`, manifest `legacyAlias` removed for
   `force-reissue-failures`. Tests: any fixture sending the body field.
12. `refactor(config): deprecate NWAVE_HARNESS_KNOBS; introduce FAILURE_SIMULATION_ENABLED`
   — production: `shared/failure-simulation/gate.ts` reads both with
   deprecation warning per ADR-035. `docker-compose.yml` and the dev
   overlay set `FAILURE_SIMULATION_ENABLED=true` alongside the legacy var.
   Tests: any fixture or compose overlay that mentions the legacy var.

After phase 2, the wire contract reflects the new naming; the legacy
event/body names are gone; `NWAVE_HARNESS_KNOBS` is honored for one
release with a deprecation warning.

**Phase 2 acceptance check:** every commit's `git diff` modifies both
`production source` (or `shared/failure-simulation/`) AND
`tests/acceptance/`. No commit modifies only one side.

#### Phase 3 — Legacy variable removal (post-overlap window)

**Goal:** stop honoring `NWAVE_HARNESS_KNOBS`. Lands one release after
phase 2.

**Commits:**

13. `refactor(shared): remove NWAVE_HARNESS_KNOBS legacy honor; emit failure-simulation.config.removed at startup if present`
   — production: `shared/failure-simulation/gate.ts`. Tests: any compose
   overlay still using the legacy var; any acceptance scenario that
   asserted the deprecation warning (replaced with assertion on the
   `removed` log event).

After phase 3, the legacy variable is fully inert. Two releases after
phase 2, even the `removed` log event is dropped (a tiny follow-up).

### `legacyAlias` field — the bridge between phase 1 and phase 2

To preserve wire compatibility through phase 1, the manifest schema
includes an optional `legacyAlias` field per entry:

```ts
export interface KnobManifestEntry {
  // ...existing fields...

  /**
   * Transitional. Present during phase 1 of US-CONSOL-4 only. Removed
   * by phase 2 rename commits. The transport renderer prefers the
   * alias over the canonical-name rendering when present.
   */
  readonly legacyAlias?: {
    readonly transportValue: string;
    readonly removalCommit: 'phase-2';
  };
}
```

Phase 1 lands with `legacyAlias` populated for `force-failure-tag`,
`expire-token`, and `force-reissue-failures`. Phase 2's rename commits
remove the `legacyAlias` field, which is the signal to the transport
renderer that the canonical-name rendering is now the wire name.

The `legacyAlias` field is gone from the schema entirely after phase 2.
A schema-versioning ADR follow-up is not needed because the field is
optional and its presence is transitional.

### CI enforcement (US-CONSOL-5 hooks)

These checks are ratified by this ADR; the DELIVER wave implements
them:

1. **Manifest-vs-source drift check:** a node script grep-matches every
   knob naming pattern (`X-Force-*` header, `__force_*__` /
   `__expire_*__` event, `force_*` body field) in `ui-state/`, `agent/`,
   and `shared/failure-simulation/`. Every match must correspond to a
   manifest entry. Failures block the merge queue.
2. **Schema validation:** the Zod schema rejects empty `rationale`,
   missing `contractTestAlternativeConsidered`, malformed `name`.
3. **Gate-startup probe verification:** a small smoke test loads each
   service's composition root and asserts the gate's `probe()` is
   called exactly once. Catches the failure mode "imported the registry
   but forgot to call `probe()`."

### Earned Trust — manifest schema probe

The manifest is the contract every callsite depends on. Per principle
12, three orthogonal layers verify the contract:

1. **Subtype check (compile-time):** `tsc` rejects a manifest entry that
   does not satisfy `KnobManifestEntry`. The Zod schema is the runtime
   mirror.
2. **Structural check (pre-commit AST):** the drift-check script walks
   the source tree for knob name patterns and verifies each has a
   manifest entry.
3. **Behavioral check (CI gold test):** the CI test parses the manifest
   at module load, asserts all 6 expected canonical names are present,
   and asserts each renders to the expected wire name for its transport.

Three orthogonal checks. A single-layer bypass is caught by at least one
of the other two.

## Consequences

### Positive

- Headers' wire contract is preserved through every phase — the 3
  header-transport scenarios (`force-create-*`) require zero acceptance-
  fixture changes.
- Vocabulary cleanup lands atomically per-rename, with the suite as
  safety net.
- Manifest is typed at compile time and validated at runtime; CI
  catches drift before merge.
- `legacyAlias` is the explicit bridge between phases 1 and 2 — the
  reviewer sees the transitional field appear (phase 1) and disappear
  (phase 2) in the diff history, which is auditable.

### Negative / accepted trade-offs

- One additional manifest field (`legacyAlias`) carried through phase 1
  for the sole purpose of phase-2 deletion. Bounded to one MR's
  lifetime; documented as transitional.
- Phase 2 commits intentionally touch test files, breaking the strict
  "production only" rule that phase 1 maintains. This is the one
  documented exception in `stories.md` US-CONSOL-4 technical notes.
- One release of overlap for `NWAVE_HARNESS_KNOBS` honoring. The
  removal MR (phase 3) is a separate small change.

### Neutral

- The canonical name `force-failure-tag` includes the suffix `-tag`
  even though its event rendering drops to `__force_failure__`. The
  suffix is the manifest disambiguator for cases where two knobs share
  a wire name; current usage is unique but the suffix is preserved as a
  future-proofing pattern.
- Header renaming (Option N3) remains an option for a future ADR if the
  team's preference shifts. The migration cost is one phase per header
  rename plus fixture updates. Out of scope for this consolidation.

## Open questions

None. Q4 from `open-questions.md` is resolved by this ADR.

## References

- `docs/evolution/2026-05-15-failure-simulation-consolidation/discuss/open-questions.md` — Q4
- `docs/evolution/2026-05-15-failure-simulation-consolidation/discuss/stories.md` —
  US-CONSOL-4, US-CONSOL-5
- `docs/evolution/2026-05-15-failure-simulation-consolidation/discuss/acceptance-criteria.md` —
  the 27 BDD scenarios (including the 6 US-CONSOL-4 scenarios) that the
  phase plan must keep green
- Memory `feedback_no_harness_no_nwave_in_product_names.md` — naming
  hygiene constraints
- ADR-029 (`X-Active-Scope`) — production-header distinctness preserved
