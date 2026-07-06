/* The persistent chrome: <Topbar/> <Outlet/> <Overlays/>. Rendered inside the
   chat context (so nav intents can open the assistant dock) once the auth and
   onboarding gates have passed. */
import { useCallback, useMemo } from "react";
import { Outlet, useLocation } from "react-router";

import type { Edge, LineageNode } from "../../catalog";
import { useNavIntents } from "../../lib/nav";
import { useColdStorage } from "../ColdStorage";
import { useExport } from "../Export";
import { useFlashedNode } from "../FlashedNodeProvider";
import { useUpload } from "../Upload";
import { catalog, useCatalog } from "../useCatalog";
import { Overlays } from "./Overlays";
import { useTheme } from "./ThemeProvider";
import { Topbar } from "./Topbar";
import { useOpenNode } from "./useOpenNode";

export function Chrome() {
  const { flash } = useFlashedNode();
  const upload = useUpload(flash);
  const exporter = useExport();
  const cold = useColdStorage();
  // Re-render the shell on any catalog mutation (rename/archive/restore/add).
  const catalogVersion = useCatalog();
  const models = useMemo(() => catalog.listModels(), [catalogVersion]);
  const { rootClassName } = useTheme();
  const intents = useNavIntents();
  const location = useLocation();
  const orgOpen = location.pathname === "/org";

  // The assistant building a model: add it, then flash it in the canvas.
  const createModel = useCallback(
    (node: LineageNode, edge: Edge) => {
      catalog.addModel(node, edge);
      flash(node.id);
    },
    [flash],
  );

  const onOpenNode = useOpenNode(upload, intents);

  return (
    <div className={rootClassName + (orgOpen ? " org-open" : "")}>
      <div className="main">
        <Topbar
          upload={upload}
          exporter={exporter}
          cold={cold}
          models={models}
        />
        <div className="content">
          <div className="frame">
            <Outlet context={{ onOpenNode }} />
          </div>
        </div>
      </div>
      <Overlays
        upload={upload}
        exporter={exporter}
        cold={cold}
        createModel={createModel}
        onOpenNode={onOpenNode}
      />
    </div>
  );
}
