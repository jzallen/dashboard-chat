/**
 * Per-layer display configuration — the human-facing name, dbt folder hint,
 * description, and the CSS custom-property handles each pipeline layer renders
 * with. Keyed off the {@link Layer} vocabulary owned by src/lib/graph.ts.
 *
 * This is presentation metadata, not catalog data, so it lives beside the app
 * rather than inside data.js (the fixture data source). Components read it
 * directly; the composition root bridges it onto globalThis for the still-bundled
 * prototype scripts.
 */
import type { Layer } from "../lib/graph";

/** Display metadata for one pipeline layer. */
export type LayerMeta = {
  key: Layer;
  name: string;
  dbt: string;
  color: string;
  bg: string;
  desc: string;
};

export const LAYER_META: Record<Layer, LayerMeta> = {
  source: { key: "source", name: "Sources", dbt: "seeds / sources", color: "var(--layer-source)", bg: "var(--layer-source-bg)", desc: "Raw uploaded CSVs" },
  staging: { key: "staging", name: "Datasets", dbt: "staging · stg_", color: "var(--layer-staging)", bg: "var(--layer-staging-bg)", desc: "Cleaned one-to-one with each upload" },
  intermediate: { key: "intermediate", name: "Views", dbt: "intermediate · int_", color: "var(--layer-intermediate)", bg: "var(--layer-intermediate-bg)", desc: "Joins & reshaping across datasets" },
  mart: { key: "mart", name: "Reports", dbt: "marts · fct_ / dim_", color: "var(--layer-mart)", bg: "var(--layer-mart-bg)", desc: "Aggregations ready for consumption" },
};
