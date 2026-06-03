/**
 * Per-layer display copy — the human-facing name, dbt folder hint, and
 * description each pipeline layer renders with. Keyed off the {@link Layer}
 * vocabulary owned by the catalog.
 *
 * Layer color is no longer carried here: the `--ln`/`--ln-soft` custom-property
 * handles moved to per-layer CSS classes (`.layer-*` in theme.css), applied via
 * `className`. This file is now pure display text.
 *
 * This is presentation metadata, not catalog data, so it lives beside the app
 * rather than inside data.js (the fixture data source). Components read it
 * directly; the composition root bridges it onto globalThis for the still-bundled
 * prototype scripts.
 */
import type { Layer } from "../lib/catalog";

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
