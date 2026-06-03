/**
 * Audit-tag → icon-name map for rendering AI-edit / transform tags. Shared
 * display metadata (like layerMeta.ts): read by the lineage audit stream and by
 * the chat/detail audit views. Presentation copy, not catalog data.
 */
export const TAG_ICON: Record<string, string> = {
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
