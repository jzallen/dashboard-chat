// PipelineLanding — data-connected lineage landing for a selected project (MR-2).
//
// The landing surface for a selected project (path-forward.md §4.2 — registered
// at `projects/:projectId/pipeline`; the full `/`-index swap + chat-as-overlay is
// MR-4). Reads the active project from the route params, pulls datasets / views /
// reports from the existing dataCatalog TanStack Query hooks (NOT ui-state), builds
// the lineage graph (empty archived set — cold storage is MR-7), and renders
// PipelineCanvas. Handles loading + empty-project states.
//
// MR-6: hosts the standalone upload modal — toolbar-triggered (a fresh source) and
// reopened by activating a source (dataset) node. Detached from the assistant; reuses
// the existing uploadFile / updateDataset clients (no ui-state wire touch).
import { useState } from "react";
import { useParams } from "react-router";

import type { DatasetSparse } from "@/dataCatalog";

import type { LineageNode } from "../../../core/lineage/buildGraph";
import { buildGraph } from "../../../core/lineage/buildGraph";
import { useArchivedDatasets, useDatasets } from "../../hooks/useDatasetQuery";
import { useReportsQuery } from "../../hooks/useReportQuery";
import { useViewsQuery } from "../../hooks/useViewQuery";
import { ColdStorageDrawer } from "../ColdStorage";
import { UploadModal } from "../UploadModal";
import styles from "./Pipeline.module.css";
import { PipelineCanvas } from "./PipelineCanvas";

export function PipelineLanding(): JSX.Element {
  const { projectId } = useParams();

  const datasets = useDatasets(projectId);
  const archivedDatasets = useArchivedDatasets(projectId);
  const views = useViewsQuery(projectId);
  const reports = useReportsQuery(projectId);

  const [modalOpen, setModalOpen] = useState(false);
  const [reopenSource, setReopenSource] = useState<DatasetSparse | null>(null);
  const [fridgeOpen, setFridgeOpen] = useState(false);

  if (datasets.isLoading || views.isLoading || reports.isLoading) {
    return <div data-testid="pipeline-loading" className={styles.state} />;
  }

  // MR-7: feed the live archived id set into the EXISTING buildGraph archived seam — an
  // archived source leaves the live graph (it is absent from the default list) and its
  // downstream goes orphaned. The default `datasets` list already excludes archived rows.
  const archivedIds = new Set((archivedDatasets.data ?? []).map((ds) => ds.id));

  const graph = buildGraph(
    datasets.data ?? [],
    views.data ?? [],
    reports.data ?? [],
    archivedIds,
  );

  if (graph.nodes.length === 0) {
    return <div data-testid="pipeline-empty" className={styles.state} />;
  }

  // Activating a source (dataset) node reopens the upload modal for that source;
  // view/report nodes are not upload sources, so they are ignored here.
  const handleNodeActivate = (node: LineageNode): void => {
    if (node.kind !== "dataset") return;
    const dataset = (datasets.data ?? []).find((d) => d.id === node.id) ?? null;
    setReopenSource(dataset);
    setModalOpen(true);
  };

  const openFreshUpload = (): void => {
    setReopenSource(null);
    setModalOpen(true);
  };

  return (
    <div className={styles.landing}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.toolbarButton}
          data-testid="upload-source-button"
          onClick={openFreshUpload}
        >
          Upload source
        </button>
        <button
          type="button"
          className={styles.toolbarButton}
          data-testid="fridge-toolbar-button"
          aria-label="Open cold storage"
          onClick={() => setFridgeOpen(true)}
        >
          🧊 Cold storage
        </button>
      </div>
      <PipelineCanvas graph={graph} onNodeActivate={handleNodeActivate} />
      <UploadModal
        open={modalOpen}
        projectId={projectId ?? ""}
        existingSource={reopenSource}
        onClose={() => setModalOpen(false)}
        onSourceCreated={() => setModalOpen(false)}
      />
      <ColdStorageDrawer
        open={fridgeOpen}
        projectId={projectId ?? ""}
        onClose={() => setFridgeOpen(false)}
      />
    </div>
  );
}

export default PipelineLanding;
