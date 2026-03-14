import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Outlet, useNavigate,useParams } from "react-router-dom";

import { StreamProvider } from "@/stream/StreamProvider";

import { ChatProvider } from "../../context/ChatContext";
import { datasetKeys, useDatasets } from "../../hooks/useDatasetQuery";
import { useOrgProjectsQuery,useOrgQuery } from "../../hooks/useOrgQuery";
import { useProjectQuery } from "../../hooks/useProjectQuery";
import { QueryProvider } from "../../providers/QueryProvider";
import { SideNav } from "../SideNav";
import { OrgNav } from "../SideNav/OrgNav";
import { ProjectNav } from "../SideNav/ProjectNav";
import styles from "./AppShell.module.css";
import { ChatPanelConnected } from "./ChatPanelConnected";

export interface AppShellContext {
  orgName: string | null;
  project: import("@/dataCatalog").Project | null;
  projects: import("@/dataCatalog").Project[] | null;
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
  const { data: datasets } = useDatasets(projectId);
  const queryClient = useQueryClient();

  // Org-mode data
  const { data: projects = null } = useOrgProjectsQuery();

  const handleDatasetCreated = useCallback(() => {
    if (projectId) {
      queryClient.invalidateQueries({ queryKey: datasetKeys.list(projectId) });
    }
  }, [projectId, queryClient]);

  const handleNavigateToDataset = useCallback(
    (id: string) => {
      navigate(`/projects/${projectId}/datasets/${id}`);
    },
    [projectId, navigate]
  );

  const outletContext: AppShellContext = { orgName, project, projects };

  return (
    <StreamProvider>
    <ChatProvider>
      <div className={styles.shell}>
        {isProjectMode && project ? (
          <SideNav orgName={orgName} collapsed={navCollapsed} onToggleCollapse={() => setNavCollapsed((v) => !v)}>
            <ProjectNav
              project={project}
              datasets={datasets ?? []}
              activeDatasetId={datasetId ?? null}
              collapsed={navCollapsed}
              onSelectProject={() => navigate(`/projects/${project.id}`)}
              onSelectDataset={(dsId) => navigate(`/projects/${project.id}/datasets/${dsId}`)}
            />
          </SideNav>
        ) : (
          <SideNav orgName={orgName} collapsed={navCollapsed} onToggleCollapse={() => setNavCollapsed((v) => !v)}>
            <OrgNav
              projects={projects ?? []}
              activeProjectId={null}
              collapsed={navCollapsed}
              onSelectProject={(id) => navigate(`/projects/${id}`)}
            />
          </SideNav>
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
    </StreamProvider>
  );
}

export function AppShell() {
  return (
    <QueryProvider>
      <AppShellInner />
    </QueryProvider>
  );
}
