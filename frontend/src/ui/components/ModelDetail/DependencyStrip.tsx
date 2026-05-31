// DependencyStrip — model-detail upstream/downstream dependency strip (MR-5).
//
// Presentational: renders the model's immediate producers (upstream) and
// consumers (downstream) as links to their detail routes
// (dataset → /table/:id, view → /view/:id, report → /report/:id). Pure over its
// props; the data comes from useModelDependencies. Consumes MR-1 tokens via
// ModelDetail.module.css. RED scaffold (created by DISTILL).
export const __SCAFFOLD__ = true;

export interface DependencyNode {
  id: string;
  name: string;
  kind: "dataset" | "view" | "report";
}

export interface DependencyStripProps {
  upstream: DependencyNode[];
  downstream: DependencyNode[];
  isLoading?: boolean;
}

export function DependencyStrip(_props: DependencyStripProps): JSX.Element {
  throw new Error("Not yet implemented — RED scaffold (MR-5 DependencyStrip)");
}
