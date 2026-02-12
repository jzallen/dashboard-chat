import { useCallback, useState } from "react";
import { Outlet, useParams, useNavigate } from "react-router-dom";
import { datasetToSparse, type Dataset } from "@/api";
import { ChatProvider } from "../../context/ChatContext";
import { QueryProvider } from "../../providers/QueryProvider";
import { useProjectQuery, useUpdateProjectDatasetCache } from "../../hooks/useProjectQuery";
import { ProjectNav } from "../ProjectNav";
import { ChatPanelConnected } from "./ChatPanelConnected";
import styles from "./AppShell.module.css";

function AppShellInner() {
  const { projectId: routeProjectId, datasetId } = useParams<{ projectId?: string; datasetId?: string }>();
  const projectId = routeProjectId!;
  const navigate = useNavigate();
  const [navCollapsed, setNavCollapsed] = useState(false);

  const { data: project = null } = useProjectQuery(projectId);
  const { addDatasetToProject } = useUpdateProjectDatasetCache(projectId);

  const handleDatasetCreated = useCallback((dataset: Dataset) => {
    addDatasetToProject(datasetToSparse(dataset));
  }, [addDatasetToProject]);

  const handleNavigateToDataset = useCallback(
    (id: string) => {
      navigate(`/projects/${projectId}/datasets/${id}`);
    },
    [projectId, navigate]
  );

  return (
    <ChatProvider>
      <div className={styles.shell}>
        <ProjectNav
          project={project}
          activeDatasetId={datasetId ?? null}
          collapsed={navCollapsed}
          onToggleCollapse={() => setNavCollapsed((v) => !v)}
        />
        <main className={styles.viewWindow}>
          <Outlet context={{ project }} />
        </main>
        <ChatPanelConnected
          projectId={projectId}
          onDatasetCreated={handleDatasetCreated}
          onNavigateToDataset={handleNavigateToDataset}
        />
      </div>
    </ChatProvider>
  );
}

export function AppShell() {
  return (
    <QueryProvider>
      <AppShellInner />
    </QueryProvider>
  );
}
