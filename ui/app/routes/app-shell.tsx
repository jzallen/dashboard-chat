/* The layout route — composition root of the persistent chrome.

   - Redirects to /login when there's no session, so an unauthenticated deep-link
     folds into the dev sign-in.
   - Authenticated entries pass the onboarding gate (D6): bootstrap the
     StateProxy document, wait while it's still verifying, fold onboarding-phase
     principals (and org'd principals with no projects yet) into /onboarding,
     and only then render the chrome.
   - useChat() is the transient assistant-dock context (chatOpen); it stays out
     of the URL.
   - The chrome is <Topbar/> <Outlet/> <Overlays/> under ThemeProvider (provided
     by root.tsx). */
import { useSelector } from "@xstate/react";
import { useCallback, useEffect, useMemo } from "react";
import { Navigate, Outlet, useLocation } from "react-router";

import { hasSession } from "../auth/tokenStorage";
import type { Edge, LineageNode } from "../catalog";
import { Overlays } from "../components/AppShell/Overlays";
import { useTheme } from "../components/AppShell/ThemeProvider";
import { Topbar } from "../components/AppShell/Topbar";
import { useColdStorage } from "../components/ColdStorage";
import { useExport } from "../components/Export";
import { useFlashedNode } from "../components/FlashedNodeProvider";
import { useUpload } from "../components/Upload";
import { catalog, refreshOrgGlobal, useCatalog } from "../components/useCatalog";
import { ChatProvider } from "../lib/chatContext";
import { useNavIntents } from "../lib/nav";
import { useStateProxy } from "../lib/StateProxyProvider";

// The first authenticated entry point: fetch the real org-global payloads
// (projects/org) so they replace the fixture seed before any child route (the
// home redirect, the project layout) reads them. Gated on the session flag so it
// never fires during the unauthenticated login round-trip. Runs once —
// shouldRevalidate returns false (org-global data doesn't change with navigation).
export async function clientLoader() {
  if (hasSession()) await refreshOrgGlobal();
  return null;
}

export function shouldRevalidate() {
  return false;
}

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

/* ─── the onboarding gate (D6) ────────────────────────────────────────────────

   Engaged only when a session exists. Reads the StateProxy document (the one
   app-wide proxy from StateProxyProvider) and dispatches:

     onboarding verifying           → waiting surface (transient; ALSO the
                                      anonymous pre-first-frame document — never
                                      a redirect)
     phase rejected                 → /onboarding (02-03 renders the honest
                                      session_rejected surface — one surface)
     phase onboarding + needs_org /
       creating_org /
       error_recoverable            → /onboarding
     phase advanced + projectContext
       no_projects                  → /onboarding (the default-project step)
     anything else                  → the chrome, exactly as before

   /onboarding never redirects an authenticated user back here, and the gate
   never targets /login when a session exists — no loops. */

const ONBOARDING_ACTIVE_STATES = new Set([
  "needs_org",
  "creating_org",
  "error_recoverable",
]);

function OnboardingGate() {
  const { proxy, ensureBootstrap } = useStateProxy();
  const phase = useSelector(proxy, (doc) => doc.phase);
  const onboardingState = useSelector(
    proxy,
    (doc) => doc.regions.onboarding.state,
  );
  const projectContextState = useSelector(
    proxy,
    (doc) => doc.regions.projectContext.state,
  );

  useEffect(() => {
    void ensureBootstrap();
  }, [ensureBootstrap]);

  if (phase === "rejected") return <Navigate to="/onboarding" replace />;
  if (onboardingState === "verifying") {
    return (
      <main className="shell-waiting">
        <p>Checking your session…</p>
      </main>
    );
  }
  if (phase === "onboarding" && ONBOARDING_ACTIVE_STATES.has(onboardingState)) {
    return <Navigate to="/onboarding" replace />;
  }
  if (phase !== "onboarding" && projectContextState === "no_projects") {
    return <Navigate to="/onboarding" replace />;
  }
  return (
    <ChatProvider>
      <Chrome />
    </ChatProvider>
  );
}

export default function AppShell() {
  if (!hasSession()) return <Navigate to="/login" replace />;
  return <OnboardingGate />;
}
