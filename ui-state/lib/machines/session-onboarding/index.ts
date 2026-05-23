// Barrel for the session-onboarding XState machine directory.
//
// The public surface is intentionally MINIMAL (the only things consumed outside
// this directory):
//   - createSessionOnboardingMachine — the statechart factory (used by
//     strategy.ts to spawn the actor).
//   - RequestClient + SessionOnboardingDeps — the two I/O-contract types a
//     composition root needs to WIRE the machine (the `fetch` port + its deps
//     bundle); consumed by orchestrator.ts, router.ts, and the test configs.
//
// Everything else — the context/event/state types, the guards, actions,
// resolvers, and validation — is an implementation detail of the machine and
// lives under ./machine.ts + ./setup/. It is deliberately NOT re-exported here.

export { createSessionOnboardingMachine } from "./machine.ts";
export type { RequestClient, SessionOnboardingDeps } from "./setup/actors.ts";
