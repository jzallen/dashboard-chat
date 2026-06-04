/* The app shell — composition root. Wires navigation + source actions into the
   topbar, routed frame, and overlay layer (rendered under the ThemeProvider). */
import { useMemo } from "react";

import type { LineageNode } from "../../lib/catalog";
import { catalog } from "../fixtureSource";
import { useCatalog } from "../useCatalog";
import { Overlays } from "./Overlays";
import { RouteFrame } from "./RouteFrame";
import { useTheme } from "./ThemeProvider";
import { Topbar } from "./Topbar";
import { useNavigation } from "./useNavigation";
import { useSourceActions } from "./useSourceActions";

export function AppShell() {
  const nav = useNavigation();
  const sources = useSourceActions();
  // Re-render the shell on any catalog mutation (rename/archive/restore/add).
  const catalogVersion = useCatalog();
  const models = useMemo(() => catalog.listModels(), [catalogVersion]);
  const { rootClassName } = useTheme();

  // Opening a lineage node bridges the two domains: a source opens its upload
  // window, anything else routes to the model detail view.
  const onOpenNode = (node: LineageNode) => {
    if (node.layer === "source") sources.openUpload(node);
    else nav.openModel(node);
  };

  return (
    <div
      className={rootClassName + (nav.route.name === "org" ? " org-open" : "")}
    >
      <div className="main">
        <Topbar nav={nav} sources={sources} models={models} />
        <RouteFrame
          nav={nav}
          onOpenNode={onOpenNode}
          justAdded={sources.justAdded}
        />
      </div>
      <Overlays nav={nav} sources={sources} />
    </div>
  );
}
