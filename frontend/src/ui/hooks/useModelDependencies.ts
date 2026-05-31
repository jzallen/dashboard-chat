// useModelDependencies — model-detail dependency strip data (MR-5).
//
// Wraps the existing dataCatalog list hooks (useDatasets / useViewsQuery /
// useReportsQuery) for the model's project, builds the MR-2 lineage graph, and
// derives the model's immediate upstream/downstream nodes. The dependency strip
// renders the result. No ui-state wire is touched — pure dataCatalog reads.
//
// RED scaffold (created by DISTILL); body implemented at DELIVER.
import type { LineageNode } from "../../core/lineage/buildGraph";

export const __SCAFFOLD__ = true;

export interface UseModelDependenciesResult {
  upstream: LineageNode[];
  downstream: LineageNode[];
  isLoading: boolean;
}

export function useModelDependencies(
  _projectId: string | undefined,
  _modelId: string | undefined,
): UseModelDependenciesResult {
  throw new Error(
    "Not yet implemented — RED scaffold (MR-5 useModelDependencies)",
  );
}
