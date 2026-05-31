// Pure breadcrumb route-context resolver — RED scaffold (created by DISTILL, MR-3).
//
// Framework-free (no React / react-router import) so it is unit-testable in
// isolation. Maps the active route params to the breadcrumb's display context:
// a "model" view (dataset / view / report detail) shows
// `OrgIcon / Project (link) / Model ▾`; any other route is a "list" context
// showing `OrgIcon / Project ▾`. See path-forward.md §4.1.
export const __SCAFFOLD__ = true;

export type ModelKind = "dataset" | "view" | "report";

export type BreadcrumbContext =
  | { kind: "list" }
  | { kind: "model"; modelKind: ModelKind; modelId: string };

export interface BreadcrumbParams {
  projectId?: string;
  viewId?: string;
  reportId?: string;
  datasetId?: string;
}

export function resolveBreadcrumbContext(
  _params: BreadcrumbParams,
): BreadcrumbContext {
  throw new Error("Not yet implemented — RED scaffold (breadcrumb MR-3)");
}
