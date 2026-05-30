import { useEffect, useState } from "react";
import { Outlet, useParams } from "react-router";

import { StreamProvider } from "@/stream/StreamProvider";

import { ChatProvider, useChatContext } from "../../context/ChatContext";
import { useOrgProjectsQuery, useOrgQuery } from "../../hooks/useOrgQuery";
import { useProjectQuery } from "../../hooks/useProjectQuery";
import { SideNav } from "../SideNav";
import { UnifiedNav } from "../SideNav/UnifiedNav";
import styles from "./AppShell.module.css";
import { RequireAuth, RequireOrg } from "./guards";

export interface AppShellContext {
  orgId: string | null;
  orgName: string | null;
  project: import("@/dataCatalog").Project | null;
  projects: import("@/dataCatalog").Project[] | null;
}

/**
 * Keeps the chat engine's active project in sync with the shell's current
 * project so chat invocations carry a project_id (the agent's scope resolver
 * requires it). Uses the same fallback as the nav: the route's project when a
 * projectId is in the URL, else the first org project — the standalone
 * /chat/:channelId route has no projectId param. Renders nothing; lives inside
 * ChatProvider so it can reach the context.
 */
function ActiveProjectSync({ projectId }: { projectId: string | null }) {
  const { registerProjectId } = useChatContext();
  useEffect(() => {
    registerProjectId(projectId);
  }, [projectId, registerProjectId]);
  return null;
}

function AppShellInner() {
  const { projectId } = useParams<{ projectId?: string }>();
  const [navCollapsed, setNavCollapsed] = useState(false);

  // Always fetch org info
  const { data: org } = useOrgQuery();
  const orgId = org?.id ?? null;
  const orgName = org?.name ?? null;

  // Project-mode data (for outlet context backward compat)
  const { data: project = null } = useProjectQuery(projectId ?? "");

  // Org-mode data
  const { data: projects = null } = useOrgProjectsQuery();

  const outletContext: AppShellContext = { orgId, orgName, project, projects };

  return (
    <StreamProvider>
    <ChatProvider>
      <ActiveProjectSync projectId={project?.id ?? projects?.[0]?.id ?? null} />
      <div className={styles.shell}>
        <SideNav orgName={orgName} collapsed={navCollapsed} onToggleCollapse={() => setNavCollapsed((v) => !v)}>
          <UnifiedNav orgId={orgId} collapsed={navCollapsed} projectId={project?.id ?? projects?.[0]?.id ?? null} />
        </SideNav>
        <main className={styles.viewWindow}>
          <Outlet context={outletContext} />
        </main>
      </div>
    </ChatProvider>
    </StreamProvider>
  );
}

export function AppShell() {
  return (
    <RequireAuth>
      <RequireOrg>
        <AppShellInner />
      </RequireOrg>
    </RequireAuth>
  );
}

export default AppShell;
