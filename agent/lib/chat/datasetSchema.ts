/**
 * Dataset-schema resolution for the agent (ssr-bff-gateway slice 3).
 *
 * The cookie-only `ui/` chat POST omits `tableSchema`, so the agent fetches the
 * dataset's columns from the backend itself and maps them into the
 * {@link TableSchema} shape the dataset prompt + tools already consume. This
 * makes the agent self-sufficient: a dataset in scope is enough to drive a
 * transform, regardless of whether the caller pre-loaded the schema.
 */

import type { BackendClient } from "./backend-client";
import type { TableSchema } from "./types";

type FieldSpec = { type?: string; label?: string };

/** Backend `schema_config` shape: `{ fields: { colName: { type, label? } } }`. */
type SchemaConfig = { fields?: Record<string, FieldSpec> } | null | undefined;

/** A persisted transform as returned by `GET /api/datasets/{id}?include_transforms=true`. */
type TransformLike = {
  id: string;
  transform_type?: string;
  target_column?: string | null;
  status?: string;
  nl_prompt?: string | null;
};

type DatasetResponseLike = {
  schema_config?: SchemaConfig;
  transforms?: TransformLike[];
  row_count?: number;
};

// Backend FieldConfig.type vocabulary → TableSchema column type. Anything
// unrecognized (or absent) falls back to "string", which the dataset prompt and
// tools handle safely.
const FIELD_TYPE_MAP: Record<string, TableSchema["columns"][number]["type"]> = {
  text: "string",
  select: "string",
  number: "number",
  boolean: "boolean",
  datetime: "date",
};

export function mapSchemaConfigToColumns(schemaConfig: SchemaConfig): TableSchema["columns"] {
  const fields = schemaConfig?.fields;
  if (!fields) return [];
  return Object.entries(fields).map(([id, spec]) => ({
    id,
    type: FIELD_TYPE_MAP[spec?.type ?? ""] ?? "string",
  }));
}

export function mapTransformsToActiveCleaning(
  transforms: TransformLike[] | undefined,
): NonNullable<TableSchema["activeCleaningTransforms"]> {
  if (!transforms) return [];
  return transforms
    .filter((t) => t.status !== "deleted")
    .map((t) => ({
      id: t.id,
      column: t.target_column ?? "",
      operation: t.transform_type ?? "clean",
      ...(t.nl_prompt ? { details: t.nl_prompt } : {}),
    }));
}

/**
 * Fetch the dataset and map it into a {@link TableSchema}. `activeFilters` and
 * `formatContext` are client-ephemeral (optional prompt hints) and left empty;
 * `rowCount` is best-effort — tolerated as 0 when the response omits it.
 *
 * Throws (via the BackendClient) on a non-2xx response or network error; the
 * caller is responsible for graceful degradation.
 */
export async function fetchTableSchema(
  datasetId: string,
  backend: BackendClient,
): Promise<TableSchema> {
  const res = (await backend.get(
    `/api/datasets/${datasetId}?include_transforms=true`,
  )) as DatasetResponseLike;

  return {
    columns: mapSchemaConfigToColumns(res?.schema_config),
    rowCount: typeof res?.row_count === "number" ? res.row_count : 0,
    activeCleaningTransforms: mapTransformsToActiveCleaning(res?.transforms),
  };
}
