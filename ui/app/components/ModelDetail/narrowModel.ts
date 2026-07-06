/**
 * The single narrowing seam from a loose lineage node to a discriminated
 * {@link Model}.
 *
 * `LineageNode.ref` is the loose {@link ModelRef} index-signature bag; every
 * detail panel is written against the full discriminated {@link Model}. Rather
 * than let each panel blind-cast the bag (`ref as unknown as Model`) — a silent
 * failure the moment the backend shape drifts — every panel routes through here.
 * A runtime check on `ref.kind` gates the cast: an absent ref or an unknown kind
 * yields `null`, so the caller degrades gracefully (renders a fallback / nothing)
 * instead of dereferencing a mis-typed field mid-tree.
 *
 * Deliberately lightweight — a discriminant check, not a full schema validation
 * (no Zod in this layer). It trusts the field set behind a recognised `kind`.
 */
import type { LineageNode, Model, ModelKind } from "../../catalog";

const MODEL_KINDS: readonly ModelKind[] = ["dataset", "view", "report"];

function isModelKind(kind: unknown): kind is ModelKind {
  return typeof kind === "string" && MODEL_KINDS.includes(kind as ModelKind);
}

/**
 * Narrow a node's `ref` to a discriminated {@link Model}, or `null` when the
 * node carries no model ref or an unrecognised `kind`.
 */
export function narrowModel(node: LineageNode): Model | null {
  const ref = node.ref;
  if (!ref || !isModelKind(ref.kind)) return null;
  return ref as unknown as Model;
}
