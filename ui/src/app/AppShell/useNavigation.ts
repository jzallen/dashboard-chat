/* Navigation: where you are (route + current project) and the assistant dock.
   go() is the intent dispatcher leaf views call ("open this recent", "open the
   assistant"); openModel/selectProject/toggleOrg are the shell's direct moves. */
import { useCallback, useRef, useState } from "react";

import type { LineageNode, ProjectSummary } from "../../lib/catalog";
import { catalog } from "../useCatalog";

/** A route, plus the optional payload some routes carry. Kept deliberately loose
    so go()/setRoute share one shape; model routes carry a node. */
export type Route = {
  name: string;
  node?: LineageNode;
  nodeId?: string | null;
};

export function useNavigation() {
  const projects = catalog.listProjects();
  const [route, setRoute] = useState<Route>({ name: "workspace" });
  const [projectId, setProjectId] = useState(projects[0].id);
  const [chatOpen, setChatOpen] = useState(false);
  const beforeOrgRef = useRef<Route>({ name: "workspace" });

  const openChat = useCallback(() => setChatOpen(true), []);
  const closeChat = useCallback(() => setChatOpen(false), []);
  const openModel = useCallback(
    (node: LineageNode) => setRoute({ name: "model", node }),
    [],
  );
  const selectProject = useCallback((p: ProjectSummary) => {
    setProjectId(p.id);
    setRoute({ name: "workspace" });
  }, []);
  const toggleOrg = useCallback(() => {
    setRoute((r) => {
      if (r.name === "org")
        return beforeOrgRef.current || { name: "workspace" };
      beforeOrgRef.current = r;
      return { name: "org" };
    });
  }, []);
  const go = useCallback((r: Route) => {
    if (r.name === "openRecent") {
      const node = r.nodeId ? catalog.getNode(r.nodeId) : null;
      if (node && node.ref) {
        setRoute({ name: "model", node });
        setChatOpen(true);
        return;
      }
      setRoute({ name: "workspace" });
      setChatOpen(true);
      return;
    }
    if (r.name === "assistant") {
      setChatOpen(true);
      return;
    }
    setRoute(r);
  }, []);

  const projectName = (projects.find((p) => p.id === projectId) || projects[0])
    .name;

  return {
    route,
    setRoute,
    projectId,
    projectName,
    go,
    openModel,
    selectProject,
    toggleOrg,
    chatOpen,
    openChat,
    closeChat,
  };
}
export type NavApi = ReturnType<typeof useNavigation>;
