/**
 * Per-layer display copy — the human-facing name, dbt folder hint, and
 * description each pipeline layer renders with. Keyed off the {@link Layer}
 * vocabulary owned by the catalog. Pure display text — layer color is carried
 * by the per-layer `.layer-*` CSS classes (theme.css), not here.
 *
 * This is presentation metadata, not catalog data, so it lives beside the app
 * rather than inside the catalog. Components read it directly.
 */
import type { Layer } from "../catalog";

/** Display copy for one pipeline layer. */
export type LayerMeta = {
  name: string;
  dbt: string;
  desc: string;
};

export const LAYER_META: Record<Layer, LayerMeta> = {
  source: { name: "Sources", dbt: "seeds / sources", desc: "Raw uploaded CSVs" },
  staging: { name: "Datasets", dbt: "staging · stg_", desc: "Cleaned one-to-one with each upload" },
  intermediate: { name: "Views", dbt: "intermediate · int_", desc: "Joins & reshaping across datasets" },
  mart: { name: "Reports", dbt: "marts · fct_ / dim_", desc: "Aggregations ready for consumption" },
};
