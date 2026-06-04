/* Routed content: one view per route. */
import type { ReactNode } from "react";

import type { LineageNode } from "../../lib/catalog";
import { AllChats } from "../AllChats";
import { ModelDetail } from "../ModelDetail";
import { OrgSettings } from "../OrgSettings";
import { Workspace } from "../Workspace";
import { useTheme } from "./ThemeProvider";
import type { NavApi } from "./useNavigation";

export function RouteFrame({
  nav,
  onOpenNode,
  justAdded,
}: {
  nav: NavApi;
  onOpenNode: (node: LineageNode) => void;
  justAdded: string | null;
}) {
  const { route } = nav;
  const { dark, toggleDark } = useTheme();
  const views: Record<string, () => ReactNode> = {
    workspace: () => <Workspace onOpen={onOpenNode} justAdded={justAdded} />,
    model: () => <ModelDetail node={route.node!} onOpen={nav.openModel} />,
    engines: () => (
      <Stub
        title="Query Engines"
        sub="DuckDB · connected. Manage compute for previews and exports."
      />
    ),
    chats: () => <AllChats go={nav.go} />,
    org: () => <OrgSettings dark={dark} onToggleDark={toggleDark} />,
  };
  return (
    <div className="content">
      <div className="frame">{(views[route.name] ?? (() => null))()}</div>
    </div>
  );
}

function Stub({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ padding: 40 }}>
      <h1 className="serif" style={{ fontSize: 22, color: "var(--text-900)" }}>
        {title}
      </h1>
      <p style={{ color: "var(--text-500)" }}>{sub}</p>
    </div>
  );
}
