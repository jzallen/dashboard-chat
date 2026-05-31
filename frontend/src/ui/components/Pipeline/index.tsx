// PipelineLanding — data-connected lineage landing for a selected project (MR-2).
//
// The landing surface for a selected project (path-forward.md §4.2 — registered
// at `projects/:projectId/pipeline`; the full `/`-index swap + chat-as-overlay is
// MR-4). Reads the active project from the route params, pulls datasets / views /
// reports from the existing dataCatalog TanStack Query hooks (NOT ui-state), builds
// the lineage graph (empty archived set — cold storage is MR-7), and renders
// PipelineCanvas. Handles loading + empty-project states.
import { useParams } from "react-router";

import { buildGraph } from "../../../core/lineage/buildGraph";
import { useDatasets } from "../../hooks/useDatasetQuery";
import { useReportsQuery } from "../../hooks/useReportQuery";
import { useViewsQuery } from "../../hooks/useViewQuery";
import styles from "./Pipeline.module.css";
import { PipelineCanvas } from "./PipelineCanvas";

export function PipelineLanding(): JSX.Element {
  const { projectId } = useParams();

  const datasets = useDatasets(projectId);
  const views = useViewsQuery(projectId);
  const reports = useReportsQuery(projectId);

  if (datasets.isLoading || views.isLoading || reports.isLoading) {
    return <div data-testid="pipeline-loading" className={styles.state} />;
  }

  const graph = buildGraph(
    datasets.data ?? [],
    views.data ?? [],
    reports.data ?? [],
    new Set(),
  );

  if (graph.nodes.length === 0) {
    return <div data-testid="pipeline-empty" className={styles.state} />;
  }

  return <PipelineCanvas graph={graph} />;
}

export default PipelineLanding;
