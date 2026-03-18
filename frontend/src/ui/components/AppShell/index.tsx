import { useState } from "react";
import { Outlet, useParams } from "react-router-dom";

import { StreamProvider } from "@/stream/StreamProvider";

import { ChatProvider } from "../../context/ChatContext";
import { useOrgProjectsQuery, useOrgQuery } from "../../hooks/useOrgQuery";
import { useProjectQuery } from "../../hooks/useProjectQuery";
import { QueryProvider } from "../../providers/QueryProvider";
import { SideNav } from "../SideNav";
import { UnifiedNav } from "../SideNav/UnifiedNav";
import styles from "./AppShell.module.css";

export interface AppShellContext {
  orgId: string | null;
  orgName: string | null;
  project: import("@/dataCatalog").Project | null;
  projects: import("@/dataCatalog").Project[] | null;
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
      <div className={styles.shell}>
        <SideNav orgName={orgName} collapsed={navCollapsed} onToggleCollapse={() => setNavCollapsed((v) => !v)}>
          <UnifiedNav orgId={orgId} collapsed={navCollapsed} />
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
    <QueryProvider>
      <AppShellInner />
    </QueryProvider>
  );
}
