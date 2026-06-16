/**
 * auditMappers — the PURE assistant-audit boundary mapper, shared by the browser
 * {@link metadataApiSource} and the server-side `/project/:projectId` `loader`.
 * Both fold the project's `GET /api/projects/{pid}/audit` list into the same
 * per-node shape off this one definition (no drift).
 *
 * No React, no HTTP, no auth imports — just the backend audit rows (post
 * envelope-unwrap) → the `Record<nodeId, AuditEntry[]>` the lineage graph folds.
 * Mirrors {@link import("./lineageMappers")}: the fetch lives in the adapter;
 * this is pure.
 */
import type { AuditEntry, AuditTag } from "../lineage";

/**
 * An assistant-audit row as the backend returns it (post envelope-unwrap): the
 * entry `id` flattened alongside the snake_case attributes from
 * `GET /api/projects/{pid}/audit`. `tool`/`say`/`tag` come from the entry's JSON
 * payload; `transform_id`/`enabled` from the reversed-FK join (`null` for
 * log-only entries). Grouped by `node_id` + mapped to {@link AuditEntry} by
 * {@link toAuditByNode}.
 */
export interface BackendAuditEntry {
  id: string;
  node_id: string;
  node_kind: string;
  tool: string;
  say: string;
  tag: AuditTag;
  transform_id?: string | null;
  enabled?: boolean | null;
}

/**
 * Fold a flat audit-entry list into the `Record<nodeId, AuditEntry[]>` shape the
 * graph expects, preserving the backend's `(node_id, sequence, created_at)`
 * order within each node. snake_case → camelCase at the boundary.
 */
export function toAuditByNode(
  entries: BackendAuditEntry[],
): Record<string, AuditEntry[]> {
  const byNode: Record<string, AuditEntry[]> = {};
  for (const entry of entries) {
    (byNode[entry.node_id] ??= []).push({
      tool: entry.tool,
      say: entry.say,
      tag: entry.tag,
      auditEntryId: entry.id,
      transformId: entry.transform_id,
      enabled: entry.enabled ?? undefined,
    });
  }
  return byNode;
}
