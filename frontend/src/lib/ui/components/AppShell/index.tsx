import { useCallback, useState } from "react";
import { Outlet, useNavigate,useParams } from "react-router-dom";

import { type Dataset,datasetToSparse } from "@/api";

import { ChatProvider } from "../../context/ChatContext";
import { useOrgProjectsQuery,useOrgQuery } from "../../hooks/useOrgQuery";
import { useProjectQuery, useUpdateProjectDatasetCache } from "../../hooks/useProjectQuery";
import { QueryProvider } from "../../providers/QueryProvider";
import { SideNav } from "../SideNav";
import styles from "./AppShell.module.css";
import { ChatPanelConnected } from "./ChatPanelConnected";

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
