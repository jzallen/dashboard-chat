import type { KnobCanonicalName, KnobManifestEntry, OwningService } from "./manifest.schema";

export interface InjectionContext {
  /** Incoming request headers, or undefined when not a request-scoped call. */
  readonly headers?: Headers | Record<string, string> | Array<[string, string]>;
  /** Incoming request body parsed as a record, or undefined. */
  readonly body?: Record<string, unknown>;
  /** XState event being processed, or undefined. */
  readonly event?: { readonly type: string };
  /** Correlation id for audit-log propagation. */
  readonly correlationId?: string;
  /** The service emitting the call (for audit envelope). */
  readonly serviceName: OwningService;
}

export class UnknownKnobError extends Error {
  readonly knobName: string;
  readonly manifestPath: string;
  constructor(name: string);
}

/**
 * Per-request decision point. Returns true iff the knob should fire its
 * registered effect.
 *
 * Throws `UnknownKnobError` when the canonical name is not in the manifest.
 */
export function shouldInject(knobName: KnobCanonicalName, ctx: InjectionContext): boolean;

/**
 * Scan the request context for failure-simulation-shaped wire signals that
 * do not correspond to any manifest entry. Emits one
 * `failure-simulation.unknown` audit line per unrecognized signal.
 */
export function detectUnknownSignals(ctx: InjectionContext): void;

/**
 * CI-lint helper used by the manifest-vs-source drift check. Narrows the type
 * to the branded `KnobCanonicalName` on success; throws on unknown names.
 */
export function assertKnown(name: string): asserts name is KnobCanonicalName;

export function findManifestEntry(name: string): KnobManifestEntry | undefined;
