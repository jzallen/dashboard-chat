// useModelDependencies — model-detail dependency strip data (MR-5).
//
// Wraps the existing dataCatalog list hooks (useDatasets / useViewsQuery /
// useReportsQuery) for the model's project, builds the MR-2 lineage graph, and
// derives the model's immediate upstream/downstream nodes. The dependency strip
// renders the result. No ui-state wire is touched — pure dataCatalog reads.
import { useMemo } from "react";

import type { LineageNode } from "../../core/lineage/buildGraph";
import { buildGraph } from "../../core/lineage/buildGraph";
import { deriveModelDependencies } from "../../core/lineage/dependencies";
import { useDatasets } from "./useDatasetQuery";
import { useReportsQuery } from "./useReportQuery";
import { useViewsQuery } from "./useViewQuery";

export interface UseModelDependenciesResult {
  upstream: LineageNode[];
  downstream: LineageNode[];
  isLoading: boolean;
}

const EMPTY_ARCHIVED: ReadonlySet<string> = new Set();

export function useModelDependencies(
  projectId: string | undefined,
  modelId: string | undefined,
): UseModelDependenciesResult {
  const datasets = useDatasets(projectId);
  const views = useViewsQuery(projectId);
  const reports = useReportsQuery(projectId);

  const isLoading = datasets.isLoading || views.isLoading || reports.isLoading;

  return useMemo(() => {
    if (!modelId) return { upstream: [], downstream: [], isLoading };
    const graph = buildGraph(
      datasets.data ?? [],
      views.data ?? [],
      reports.data ?? [],
      EMPTY_ARCHIVED,
    );
    const { upstream, downstream } = deriveModelDependencies(modelId, graph);
    return { upstream, downstream, isLoading };
  }, [modelId, datasets.data, views.data, reports.data, isLoading]);
}
