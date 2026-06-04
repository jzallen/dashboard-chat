/**
 * Audit-tag → icon-name map for rendering AI-edit / transform tags. Shared
 * display metadata (like layerMeta.ts): read by the lineage audit log and by
 * the chat/detail audit views. Presentation copy, not catalog data.
 */
import type { IconName } from "./primitives";

export const TAG_ICON: Record<string, IconName> = {
  create: "plus",
  join: "join",
  filter: "filter",
  grain: "clock",
  measure: "sparkle",
  config: "gear",
  clean: "check",
  fix: "check",
  cast: "refresh",
  shape: "table",
  source: "database",
  default: "sparkle",
};
