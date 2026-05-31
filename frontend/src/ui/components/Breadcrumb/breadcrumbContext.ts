// Pure breadcrumb route-context resolver — RED scaffold (created by DISTILL, MR-3).
//
// Framework-free (no React / react-router import) so it is unit-testable in
// isolation. Maps the active route params to the breadcrumb's display context:
// a "model" view (dataset / view / report detail) shows
// `OrgIcon / Project (link) / Model ▾`; any other route is a "list" context
// showing `OrgIcon / Project ▾`. See path-forward.md §4.1.

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
  params: BreadcrumbParams,
): BreadcrumbContext {
  if (params.viewId) {
    return { kind: "model", modelKind: "view", modelId: params.viewId };
  }
  if (params.reportId) {
    return { kind: "model", modelKind: "report", modelId: params.reportId };
  }
  if (params.datasetId) {
    return { kind: "model", modelKind: "dataset", modelId: params.datasetId };
  }
  return { kind: "list" };
}
