/* The layout route — composition root of the chrome. Replaces src/app/app.tsx
   (mount) + src/app/AppShell/AppShell.tsx (minus RouteFrame, now <Outlet/>).

   - RequireAuth redirects to /login when there's no token (mirrors frontend's
     guard), so an unauthenticated deep-link folds into the dev sign-in.
   - useChat() is the transient assistant-dock context (chatOpen) the old
     useNavigation.ts held; it stays out of the URL.
   - The chrome is <Topbar/> <Outlet/> <Overlays/> under ThemeProvider (provided
     by root.tsx). */
import { useCallback, useMemo } from "react";
import { Navigate, Outlet, useLocation } from "react-router";

import { getToken } from "../auth/tokenStorage";
import type { Edge, LineageNode } from "../catalog";
import { Overlays } from "../components/AppShell/Overlays";
import { useTheme } from "../components/AppShell/ThemeProvider";
import { Topbar } from "../components/AppShell/Topbar";
import { useColdStorage } from "../components/ColdStorage";
import { useExport } from "../components/Export";
import { useFlashedNode } from "../components/FlashedNodeProvider";
import { useUpload } from "../components/Upload";
import { catalog, useCatalog } from "../components/useCatalog";
import { ChatProvider } from "../lib/chatContext";
import { useNavIntents } from "../lib/nav";

/* ─── the chrome (inside the chat context, so nav intents can open the dock) ─── */

function Chrome() {
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

  // Opening a lineage node bridges two domains: a source opens its upload
  // window, anything else routes to the model detail view.
  const onOpenNode = useCallback(
    (node: LineageNode) => {
      if (node.layer === "source") upload.openUpload(node);
      else intents.openNode(node);
    },
    [upload, intents],
  );

  return (
    <div className={rootClassName + (orgOpen ? " org-open" : "")}>
      <div className="main">
        <Topbar upload={upload} exporter={exporter} cold={cold} models={models} />
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

export default function AppShell() {
  if (!getToken()) return <Navigate to="/login" replace />;
  return (
    <ChatProvider>
      <Chrome />
    </ChatProvider>
  );
}
