/* The app shell — composition root. Wires navigation + the per-overlay hooks
   (upload / export / cold storage) into the topbar, routed frame, and overlay
   layer (rendered under the ThemeProvider). */
import { useCallback, useMemo } from "react";

import type { Edge, LineageNode } from "../../lib/catalog";
import { useColdStorage } from "../ColdStorage";
import { useExport } from "../Export";
import { catalog } from "../fixtureSource";
import { useFlashedNode } from "../FlashedNodeProvider";
import { useUpload } from "../Upload";
import { useCatalog } from "../useCatalog";
import { Overlays } from "./Overlays";
import { RouteFrame } from "./RouteFrame";
import { useTheme } from "./ThemeProvider";
import { Topbar } from "./Topbar";
import { useNavigation } from "./useNavigation";

export function AppShell() {
  const nav = useNavigation();
  const { flash } = useFlashedNode();
  const upload = useUpload(flash);
  const exporter = useExport();
  const cold = useColdStorage();
  // Re-render the shell on any catalog mutation (rename/archive/restore/add).
  const catalogVersion = useCatalog();
  const models = useMemo(() => catalog.listModels(), [catalogVersion]);
  const { rootClassName } = useTheme();

  // The assistant building a model: add it, then flash it in the canvas.
  const createModel = useCallback(
    (node: LineageNode, edge: Edge) => {
      catalog.addModel(node, edge);
      flash(node.id);
    },
    [flash],
  );

  // Opening a lineage node bridges two domains: a source opens its upload
  // window, anything else routes to the model detail view.
  const onOpenNode = (node: LineageNode) => {
    if (node.layer === "source") upload.openUpload(node);
    else nav.openModel(node);
  };

  return (
    <div
      className={rootClassName + (nav.route.name === "org" ? " org-open" : "")}
    >
      <div className="main">
        <Topbar
          nav={nav}
          upload={upload}
          exporter={exporter}
          cold={cold}
          models={models}
        />
        <RouteFrame nav={nav} onOpenNode={onOpenNode} />
      </div>
      <Overlays
        nav={nav}
        upload={upload}
        exporter={exporter}
        cold={cold}
        createModel={createModel}
      />
    </div>
  );
}
