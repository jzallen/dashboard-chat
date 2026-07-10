/* Pure CSV schema inference for the upload flow: reads a CSV blob's header row
   and a small value sample to name each column and guess text-vs-number. No
   React/DOM/network dependencies — a plain string→schema transform. */
import type { FieldDef } from "../../catalog";

/** The columns inferred from a CSV blob plus its data-row count. */
export type InferredSchema = { cols: FieldDef[]; rows: number };

/**
 * Infer a column schema from raw CSV `text`.
 *
 * The first non-blank line is the header row; the next up to seven lines are
 * sampled to guess each column's type. A column is `number` only when it has at
 * least one non-empty sampled value and every sampled value parses as a number;
 * otherwise it is `text`. Surrounding double quotes are stripped from headers,
 * and a blank header falls back to `column_<n>` (1-based). Blank lines are
 * ignored throughout, so `rows` counts non-blank lines minus the header.
 *
 * Returns `null` when `text` has no non-blank lines.
 */
export function inferSchema(text: string): InferredSchema | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return null;
  const strip = (s: string) => (s || "").trim().replace(/^"|"$/g, "");
  const headers = lines[0].split(",").map(strip);
  const sample = lines.slice(1, 8).map((l) => l.split(","));
  const cols = headers.map((h, i) => {
    const vals = sample
      .map((r) => (r[i] !== undefined ? r[i].trim() : ""))
      .filter((v) => v !== "");
    const numeric = vals.length > 0 && vals.every((v) => !isNaN(Number(v)));
    return { name: h || `column_${i + 1}`, type: numeric ? "number" : "text" };
  });
  return { cols, rows: lines.length - 1 };
}
