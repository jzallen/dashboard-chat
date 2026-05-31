// CompiledSqlPanel — model-detail compiled SQL section (MR-5).
//
// Presentational: a collapsible panel showing the model's compiled SQL with its
// ref() wiring (Report.sql_definition / Dataset.staging_sql / View.sql_definition).
// Renders an empty-state when no SQL is available. Pure over its props. Consumes
// MR-1 tokens via ModelDetail.module.css. RED scaffold (created by DISTILL).
export const __SCAFFOLD__ = true;

export interface CompiledSqlPanelProps {
  sql?: string | null;
  title?: string;
}

export function CompiledSqlPanel(_props: CompiledSqlPanelProps): JSX.Element {
  throw new Error("Not yet implemented — RED scaffold (MR-5 CompiledSqlPanel)");
}
