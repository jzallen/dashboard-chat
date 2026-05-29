// Barrel for the onboarding XState machine directory.
//
// The public surface is intentionally MINIMAL (the only things consumed outside
// this directory):
//   - createOnboardingMachine — the statechart factory (used by
//     strategy.ts to spawn the actor).
//   - OnboardingInput — the begin-envelope type a composition root passes
//     into the machine on createActor; consumed by chat-app's parent statechart
//     (which pins its own `types.input` to it) and by callers that build the
//     input directly.
//   - RequestClient + OnboardingDeps — the two I/O-contract types a
//     composition root needs to WIRE the machine (the `fetch` port + its deps
//     bundle); consumed by orchestrator.ts, router.ts, and the test configs.
//
// Everything else — the context/event/state types, the guards, actions,
// resolvers, and validation — is an implementation detail of the machine and
// lives under ./machine.ts + ./setup/. It is deliberately NOT re-exported here.

export { createOnboardingMachine } from "./machine.ts";
export type { OnboardingInput } from "./setup/types.ts";
export type { RequestClient, OnboardingDeps } from "./setup/actors.ts";
