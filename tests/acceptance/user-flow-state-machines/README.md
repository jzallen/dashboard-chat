# Acceptance Suite — user-flow-state-machines

TypeScript-native BDD acceptance tests for the `login-and-org-setup`
flow (J-001) and the four-piece ui-state contract.

## Layout

See `docs/feature/user-flow-state-machines/distill/wave-decisions.md`
§DWD-1 for the rationale.

```
features/                    # Gherkin feature files
steps/                       # Cucumber step definitions + shared helpers
harness/                     # TS UserFlowHarness (first-class US-004 deliverable)
```

## Walking Skeleton Strategy: C

Real local adapters with a fake WorkOS over loopback HTTP. See DWD-2.
Compose stack: auth-proxy + agent + backend + query-engine + MinIO +
ui-state (NEW) + frontend-remix (NEW) = 7 services.

## Running locally

```bash
cd tests/acceptance/user-flow-state-machines

# Bring up the 7-service compose stack (DELIVER lands the compose profile
# once ui-state and frontend-remix images exist; today the scaffold builds
# the ui-state image to 501).
npm install
npm run compose:up

# Run only the walking skeleton (smoke test).
npm run test:smoke

# Run all currently-enabled scenarios (one at a time; @skip excluded).
npm run test:enabled

# Run the full suite (errors on @skip — expected during RED).
npm run test
```

## DELIVER sequence

Per `roadmap.json` (six steps mapped to the three carpaccio slices).
DELIVER's first action each step is to remove `@skip` from one scenario,
move its step definitions out of `deferred-steps.ts` into a per-slice
file, then implement outside-in.

## Boundary enforcement (CM-A)

```bash
# Should print "OK" — tests must never import from ui-state source.
grep -rE 'from .*ui-state/lib' . || echo OK
```
