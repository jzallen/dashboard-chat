# ADR-035: Failure-Simulation Gate Composition — `ENVIRONMENT` × `FAILURE_SIMULATION_ENABLED`

**Status:** Accepted (2026-05-14)
**Date:** 2026-05-14
**Originating wave:** DESIGN — `failure-simulation-consolidation`
**Resolves:** `docs/feature/failure-simulation-consolidation/discuss/open-questions.md` Q1
**Companion ADRs:** ADR-036 (module location), ADR-037 (audit sink), ADR-038 (naming + phase plan)

## Context

The DISCUSS wave (`stories.md` US-CONSOL-2; `open-questions.md` Q1) identified that
today's failure-simulation surface is gated by a single boolean env var,
`NWAVE_HARNESS_KNOBS=true`. The user's revision prompt explicitly framed the
problem as "defense-in-depth is missing: the only gate is a single env var" and
asked for a higher-order `ENVIRONMENT` tier discriminator. Two clean designs
exist:

- **Q1.a — single-source-of-truth:** `ENVIRONMENT` alone gates the surface;
  no companion flag survives.
- **Q1.b — defense-in-depth, AND-composition:** both `ENVIRONMENT in {dev, ci}`
  AND `FAILURE_SIMULATION_ENABLED=true` must hold for any knob to fire.

Separately, the legacy env var name `NWAVE_HARNESS_KNOBS` is structurally
incorrect — the `NWAVE_` prefix suggests the flag belongs to the nwave-ai
SDLC tooling, when in fact it gates production-runtime test behavior on the
system under development. The naming correction is non-negotiable (user's
revision prompt; memory `feedback_no_harness_no_nwave_in_product_names.md`).

## Decision drivers

- **User-stated requirement: defense-in-depth.** The DISCUSS prompt explicitly
  asked for two gates so that one misconfigured env var no longer equals "DoS
  surface open." A single-source-of-truth design re-introduces the same shape
  of risk that motivated the consolidation — it just renames the single point
  of failure from `NWAVE_HARNESS_KNOBS` to `ENVIRONMENT`.
- **Conway's-Law fit.** Olivia (operator) owns `ENVIRONMENT` — it is a
  tier-discriminator she manages across many concerns. Devon (engineer) owns
  `FAILURE_SIMULATION_ENABLED` — it is a feature-specific dev-loop toggle. Two
  separate roles, two separate flags, AND-composed at the registry.
- **Fail-closed semantics.** Both variables individually fail closed when
  unset. The composition is monotone — adding any second gate cannot
  open the surface that the first gate already closed.
- **Naming hygiene.** Every replacement candidate carries the `failure-simulation`
  category name so that audit log events (`failure-simulation.fired`), the module
  (`shared/failure-simulation/`), and the gate flag (`FAILURE_SIMULATION_ENABLED`)
  all line up under one vocabulary.
- **Earned Trust (principle 12).** The gate is a dependency every machine
  trusts blindly today. The composition design includes a startup probe that
  evaluates both variables, logs the verdict, and refuses to register the
  inspection-probe routes when the verdict is `disabled`. The probe is the
  empirical demonstration that the gate honors its contract — see "Probe
  contract" below.

## Considered options

### Option A — `ENVIRONMENT`-only (Q1.a)

`FAILURE_SIMULATION_ENABLED` does not exist. `ENVIRONMENT in {dev, ci}` is the
sole permit; staging and production deny. `NWAVE_HARNESS_KNOBS` is deprecated
and removed without replacement.

**Trade-offs:**

- (+) Simplest interaction matrix: 4 cases (one per environment tier).
- (+) Operators have one variable to remember.
- (−) Defeats the user's stated motivation — replaces one single-point-of-failure
  with another single-point-of-failure.
- (−) An operator who sets `ENVIRONMENT=dev` in staging by accident (debugging
  session, copy-paste from local override) re-opens the entire surface. No
  second line of defense.

### Option B — AND-composition, `ENVIRONMENT` × `FAILURE_SIMULATION_ENABLED` (Q1.b) — SELECTED

`ENVIRONMENT in {dev, ci}` **AND** `FAILURE_SIMULATION_ENABLED=true` must both
hold. Either variable alone blocks the surface. `NWAVE_HARNESS_KNOBS` is
deprecated (one-release overlap; read with warning; behavior preserved) and
removed at the end of the overlap window.

**Trade-offs:**

- (+) True defense-in-depth: two simultaneous misconfigurations required.
- (+) Conway-Law fit: Olivia owns `ENVIRONMENT`; Devon owns
  `FAILURE_SIMULATION_ENABLED`.
- (+) Migration path is additive: legacy `NWAVE_HARNESS_KNOBS=true` is
  honored as a synonym for `FAILURE_SIMULATION_ENABLED=true` during the overlap
  window with a deprecation warning, so existing dev environments do not
  break on day one.
- (−) Interaction matrix grows to 4×2 = 8 cases (documented below).
- (−) Devon must set two env vars locally — mitigated by the dev compose
  overlay setting both by default.

### Option C — per-knob opt-in (Q1.c)

`ENVIRONMENT` is the master gate; each individual knob is further gated by
a per-knob env var.

**Trade-offs:**

- (−) Multiplies operational surface for no asked-for benefit.
- (−) Adds N runtime decision points without a use case driving them.
- Rejected: nobody asked for per-knob runtime opt-out; Devon's actual need
  is "disable all knobs locally" which AND-composition already provides.

## Decision outcome

**Option B (Q1.b) — AND-composition with `FAILURE_SIMULATION_ENABLED` as the
defense-in-depth flag.**

### Composition algorithm (specification — not implementation)

The gate's verdict is computed once at service startup, cached for the
process lifetime, and emitted as a structured log event (see ADR-037).
Per-request gate evaluation is a cached read — no per-request env-var
parse.

```
verdict := EVAL_GATE(env: EnvironmentSource)

EVAL_GATE(env):
  tier := READ_TIER(env)          # see READ_TIER below
  flag := READ_FLAG(env)          # see READ_FLAG below

  if tier in {production, staging, unset, unknown}:
    return { state: disabled, reason: environment_tier_denies, tier: tier, flag: flag }

  if flag is false or flag is unset:
    return { state: disabled, reason: flag_denies, tier: tier, flag: flag }

  return { state: enabled, reason: both_permit, tier: tier, flag: flag }


READ_TIER(env):
  raw := env.ENVIRONMENT
  if raw is unset: return unset                          # fail-closed
  normalized := lowercase(raw).trim()
  if normalized in {dev, ci, staging, production}: return normalized
  return unknown                                          # fail-closed


READ_FLAG(env):
  primary := env.FAILURE_SIMULATION_ENABLED
  legacy  := env.NWAVE_HARNESS_KNOBS

  if primary is set:
    return parse_bool(primary)                           # true/false; invalid → false
  if legacy is set:
    EMIT_DEPRECATION_WARNING(legacy)                     # one-release overlap
    return parse_bool(legacy)
  return unset                                            # → false in EVAL_GATE
```

### Interaction matrix (8 cases)

| `ENVIRONMENT` | `FAILURE_SIMULATION_ENABLED` | Verdict | Reason |
|---|---|---|---|
| `dev` | `true` | enabled | `both_permit` |
| `dev` | `false` or unset | disabled | `flag_denies` |
| `ci` | `true` | enabled | `both_permit` |
| `ci` | `false` or unset | disabled | `flag_denies` |
| `staging` | `true` | disabled | `environment_tier_denies` |
| `staging` | `false` or unset | disabled | `environment_tier_denies` |
| `production` | `true` | disabled | `environment_tier_denies` |
| `production` | `false` or unset | disabled | `environment_tier_denies` |
| unset / unknown | anything | disabled | `environment_tier_denies` |

The matrix is monotone: there is no `{tier, flag}` pair where the verdict
is enabled that does not require `tier in {dev, ci}` AND `flag = true`.

### `NWAVE_HARNESS_KNOBS` deprecation path

One-release overlap, then removal. Specifically:

1. **On migration MR (US-CONSOL-4 phase 2) landing:** the registry reads both
   `FAILURE_SIMULATION_ENABLED` (preferred) and `NWAVE_HARNESS_KNOBS` (legacy).
   When the legacy variable is present:
   - If `FAILURE_SIMULATION_ENABLED` is also set, the primary wins; legacy
     is ignored with a `failure-simulation.config.deprecated` warning naming the
     replacement.
   - If only the legacy is set, it is parsed as the flag value with a
     `failure-simulation.config.deprecated` warning naming the replacement and
     stating "behavior preserved for one release."
2. **One release after the migration lands** (tracked as a follow-up MR
   referencing this ADR): the registry stops reading `NWAVE_HARNESS_KNOBS`.
   If still present in env, the registry logs
   `failure-simulation.config.removed env=NWAVE_HARNESS_KNOBS` at startup but
   does not honor it. Local `.env` files and docker-compose overlays that
   still set the legacy variable must be updated.
3. **Two releases after migration:** no log emitted; the variable is fully
   inert.

The "one release" unit is one merge cycle through `gt mq submit` of the
removal MR, not a calendar period. The DESIGN wave commits to the path,
not to a date.

### Probe contract (Earned Trust)

The composition algorithm is a dependency every machine in `ui-state/` and
every middleware in `agent/` trusts. Per principle 12, the gate exposes a
`probe()` operation called once at composition root (service startup),
before any route is registered or any actor is spawned. The probe:

1. Evaluates `EVAL_GATE` against the live process env.
2. Emits a single structured log entry (`failure-simulation.gate.enabled` or
   `failure-simulation.gate.disabled`) with the verdict (see ADR-037 schema).
3. Emits a `failure-simulation.config.deprecated` entry if legacy variables are
   present (independent of verdict).
4. Returns the cached verdict to the composition root, which then decides
   whether to register the `/debug/*` inspection-probe routes (only if
   verdict is enabled).

Failure-simulation scenarios the probe must survive (catalogued for the
CI gold-test runner per principle 12):

| Substrate lie / misconfiguration | Probe's required behavior |
|---|---|
| `ENVIRONMENT` unset | Verdict: disabled, reason: `environment_tier_denies`, tier: `unset` |
| `ENVIRONMENT=DEV` (uppercase) | Normalized to `dev`; verdict honors `FAILURE_SIMULATION_ENABLED` |
| `ENVIRONMENT=dev` with whitespace | Trimmed; verdict honors `FAILURE_SIMULATION_ENABLED` |
| `ENVIRONMENT=marketing` (typo) | Verdict: disabled, reason: `environment_tier_denies`, tier: `unknown` |
| Both `FAILURE_SIMULATION_ENABLED=true` and `NWAVE_HARNESS_KNOBS=false` | Primary wins; legacy ignored; deprecation warning emitted |
| Only `NWAVE_HARNESS_KNOBS=true` set | Legacy honored; deprecation warning emitted; verdict honors `ENVIRONMENT` |
| `FAILURE_SIMULATION_ENABLED=yes` (non-boolean) | Parsed as false (strict parse); verdict: disabled, reason: `flag_denies` |
| Service restarted between request 1 and request 2 with different env | Verdict re-evaluated; cached for new process lifetime |

The composition root invariant is **wire then probe then use**: the gate's
probe MUST run before any route registration or actor spawning. If the
probe emits a `disabled` verdict in an environment a developer expected to
be `enabled` (e.g. `ENVIRONMENT=dev` set in a worker container that forgot
to inherit `FAILURE_SIMULATION_ENABLED`), the startup log makes the discrepancy
visible at boot time, not at first-failing acceptance scenario.

## Consequences

### Positive

- Two independent misconfigurations required to open the surface; no single
  env-var flip exposes it.
- Conway's-Law fit: operator's tier-discriminator and engineer's feature
  toggle are separate variables managed by separate roles.
- Migration is additive — existing dev environments keep working through the
  overlap window with a deprecation warning, no day-one breakage.
- Verdict is logged once at startup with structured fields, so Olivia gets
  affirmative evidence the gate is closed in staging (not absence of
  evidence).
- The startup probe is the empirical Earned-Trust demonstration that the
  gate honors its contract before any request can exercise it.

### Negative / accepted trade-offs

- 8-case interaction matrix instead of a 4-case matrix. Documented above
  and in the gate's startup log. Mitigated by Devon writing
  `FAILURE_SIMULATION_ENABLED=true` only twice (once in his local `.env`,
  once in `docker-compose.yml`).
- Dual variable maintenance during the overlap window: legacy
  `NWAVE_HARNESS_KNOBS` and primary `FAILURE_SIMULATION_ENABLED` both
  honored. Mitigated by deprecation log; bounded to one release.
- Devon's mental model now distinguishes `ENVIRONMENT` from
  `FAILURE_SIMULATION_ENABLED`. He cannot enable knobs by flipping one
  variable; he must understand both. This is the cost of defense-in-depth
  and is the explicit user-asked-for outcome.

### Neutral

- `ENVIRONMENT` value space is fixed at four tiers: `dev`, `ci`, `staging`,
  `production`. Adding a fifth tier (e.g. `qa`, `preview`) requires a
  follow-up ADR clarifying the gate's policy for that tier.
- Per-knob opt-in (Option C) is not designed in. If a future use case
  needs it, this ADR composes — the per-knob toggle would be a third AND
  in `EVAL_GATE` without breaking the existing two.

## Open questions

None. Q1 from `open-questions.md` is resolved by this ADR.

## References

- `docs/feature/failure-simulation-consolidation/discuss/stories.md` — US-CONSOL-2
- `docs/feature/failure-simulation-consolidation/discuss/open-questions.md` — Q1
- ADR-029 (`X-Active-Scope` propagation contract) — confirms test-only knob
  surface must remain visually distinct from production headers; the gate
  decision here is independent of that contract.
- Memory `feedback_no_harness_no_nwave_in_product_names.md` — naming hygiene
  constraint on `FAILURE_SIMULATION_ENABLED`.
