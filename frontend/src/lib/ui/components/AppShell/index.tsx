import { useCallback, useState } from "react";
import { Outlet, useParams, useNavigate } from "react-router-dom";
import { datasetToSparse, type Dataset } from "@/api";
import { ChatProvider } from "../../context/ChatContext";
import { QueryProvider } from "../../providers/QueryProvider";
import { useProjectQuery, useUpdateProjectDatasetCache } from "../../hooks/useProjectQuery";
import { useOrgQuery, useOrgProjectsQuery } from "../../hooks/useOrgQuery";
import { SideNav } from "../SideNav";
import { ChatPanelConnected } from "./ChatPanelConnected";
import styles from "./AppShell.module.css";

export interface AppShellContext {
  orgName: string | null;
  project: import("@/api").Project | null;
  projects: import("@/api").Project[] | null;
}

function AppShellInner() {
  const { projectId, datasetId } = useParams<{ projectId?: string; datasetId?: string }>();
  const navigate = useNavigate();
  const [navCollapsed, setNavCollapsed] = useState(false);

  const isProjectMode = Boolean(projectId);

  // Always fetch org info
  const { data: org } = useOrgQuery();
  const orgName = org?.name ?? null;

  // Project-mode data
  const { data: project = null } = useProjectQuery(projectId ?? "");
  const { addDatasetToProject } = useUpdateProjectDatasetCache(projectId ?? "");

  // Org-mode data
  const { data: projects = null } = useOrgProjectsQuery();

  const handleDatasetCreated = useCallback((dataset: Dataset) => {
    addDatasetToProject(datasetToSparse(dataset));
  }, [addDatasetToProject]);

  const handleNavigateToDataset = useCallback(
    (id: string) => {
      navigate(`/projects/${projectId}/datasets/${id}`);
    },
    [projectId, navigate]
  );

  const outletContext: AppShellContext = { orgName, project, projects };

  return (
    <ChatProvider>
      <div className={styles.shell}>
        {isProjectMode && project ? (
          <SideNav
            mode="project"
            orgName={orgName}
            project={project}
            activeDatasetId={datasetId ?? null}
            collapsed={navCollapsed}
            onToggleCollapse={() => setNavCollapsed((v) => !v)}
          />
        ) : (
          <SideNav
            mode="org"
            orgName={orgName}
            projects={projects ?? []}
            activeProjectId={null}
            collapsed={navCollapsed}
            onToggleCollapse={() => setNavCollapsed((v) => !v)}
          />
        )}
        <main className={styles.viewWindow}>
          <Outlet context={outletContext} />
        </main>
        <ChatPanelConnected
          projectId={projectId ?? null}
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
