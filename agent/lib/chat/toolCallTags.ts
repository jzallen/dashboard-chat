/**
 * tool→tag map for the assistant audit (rich-catalog §2.4 / §2.8).
 *
 * Co-located with the agent's transform dispatchers (the source of truth for the
 * tool names). The agent resolves the audit tag from the cleaning operation and
 * sends it in the tool-call record's payload; the backend re-validates the tag
 * against its AUDIT_TAGS vocabulary at the inbound boundary.
 *
 * The vocabulary mirrors ui/src/lib/catalog/lineage.ts AUDIT_TAGS.
 */

export type AuditTag =
  | "create"
  | "source"
  | "join"
  | "filter"
  | "grain"
  | "measure"
  | "config"
  | "clean"
  | "fix"
  | "cast"
  | "shape";

/**
 * The cleaning/filter operations the AGENT executes against the backend (the
 * toggleable transform tools). Maps each to its display tag per §2.4:
 *   trim + case ops → clean, fill_null → fix, map_values → cast, filter → filter.
 */
const OPERATION_TAGS: Record<string, AuditTag> = {
  trim: "clean",
  upper: "clean",
  lower: "clean",
  title: "clean",
  snake: "clean",
  kebab: "clean",
  fill_null: "fix",
  map_values: "cast",
  filter: "filter",
};

/** Resolve the audit tag for a cleaning operation; defaults to "clean". */
export function auditTagForOperation(operation: string): AuditTag {
  return OPERATION_TAGS[operation] ?? "clean";
}
