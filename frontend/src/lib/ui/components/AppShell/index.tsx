import { useEffect, useState } from "react";
import { Outlet, useParams } from "react-router-dom";
import { getProject, type Project } from "@/api";
import { ChatProvider } from "../../context/ChatContext";
import { ProjectNav } from "../ProjectNav";
import { ChatPanelConnected } from "./ChatPanelConnected";
import styles from "./AppShell.module.css";

const DEFAULT_PROJECT_ID = "default-project-001";

export function AppShell() {
  const { datasetId } = useParams<{ datasetId?: string }>();
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    const loadProject = async () => {
      try {
        const projectData = await getProject(DEFAULT_PROJECT_ID);
        setProject(projectData);
      } catch (err) {
        console.error("Failed to load project:", err);
      }
    };
    loadProject();
  }, []);

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
        <ChatPanelConnected />
      </div>
    </ChatProvider>
  );
}
