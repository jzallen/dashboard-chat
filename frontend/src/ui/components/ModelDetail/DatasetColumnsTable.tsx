// DatasetColumnsTable — model-detail columns table for the dataset layer (MR-5).
//
// Presentational: renders a dataset's schema_config fields as a columns table
// (name + type, plus profile sample values where available). Views/reports keep
// their existing layer-specific columns/measures tables (ViewSchemaTable /
// ColumnsMetadataTable); this fills the dataset layer. Pure over its props.
// Consumes MR-1 tokens via ModelDetail.module.css. RED scaffold (created by DISTILL).
import type { ColumnProfile, SchemaConfig } from "@/dataCatalog";

export const __SCAFFOLD__ = true;

export interface DatasetColumnsTableProps {
  schema: SchemaConfig;
  profiles?: Record<string, ColumnProfile> | null;
}

export function DatasetColumnsTable(
  _props: DatasetColumnsTableProps,
): JSX.Element {
  throw new Error(
    "Not yet implemented — RED scaffold (MR-5 DatasetColumnsTable)",
  );
}
