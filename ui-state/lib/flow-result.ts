// Result type for the FlowOrchestrator public API. The orchestrator returns
// these instead of throwing so HTTP adapters can map success/failure with a
// single total function and need no try/catch. Mirrors the backend's
// Success/Failure convention. This module is a sink — it imports nothing, so
// orchestrator.ts and the per-machine routers can both depend on it with no
// import cycle.

export type FlowError =
  | { kind: "unknown_machine"; machine: string }
  | { kind: "dispatch_error"; message: string };

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: FlowError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const err = <T = never>(error: FlowError): Result<T> => ({
  ok: false,
  error,
});

/** The message a thrown exception would have carried, for sites that keep a
 *  bespoke 500 shape (no unknown_machine 404 branch). `UnknownMachineError`'s
 *  own `.message` is `Unknown machine: <m>`, so this stays byte-identical to
 *  the prior `(err as Error).message`. */
export function errorMessage(error: FlowError): string {
  return error.kind === "unknown_machine"
    ? `Unknown machine: ${error.machine}`
    : error.message;
}
