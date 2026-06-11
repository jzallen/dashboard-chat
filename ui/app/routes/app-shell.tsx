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
import { apiGet, apiPost } from "../catalog/dataSources/backendClient";
import { Overlays } from "../components/AppShell/Overlays";
import { useTheme } from "../components/AppShell/ThemeProvider";
import { Topbar } from "../components/AppShell/Topbar";
import { useColdStorage } from "../components/ColdStorage";
import { useExport } from "../components/Export";
import { useFlashedNode } from "../components/FlashedNodeProvider";
import { LoadingSurface } from "../components/LoadingSurface/LoadingSurface";
import { useUpload } from "../components/Upload";
import { catalog, refreshOrgGlobal, useCatalog } from "../components/useCatalog";
import { ChatProvider } from "../lib/chatContext";
import { createLogger } from "../lib/log";
import { useNavIntents } from "../lib/nav";
import {
  createOnboardingDriver,
  type OnboardingClient,
} from "../lib/onboarding-driver";
import { useStateProxy } from "../lib/StateProxyProvider";

/** The default backend client adapter — the Phase-B probe's real HTTP port. */
const defaultClient: OnboardingClient = {
  get: (path) => apiGet(path),
  post: (path, body) => apiPost(path, body),
};

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

/* ─── the onboarding gate (CDO-S5; ADR-050 §e.4/§f) ───────────────────────────

   Engaged only when a session exists. Reads the StateProxy document (the one
   app-wide proxy from StateProxyProvider) and dispatches:

     onboarding awaiting_org_report → waiting surface (transient; ALSO the
                                      anonymous pre-first-frame zero state — never
                                      a redirect). On this state the gate fires
                                      the driver's Phase-B org probe
                                      (probeAndReportOrg) — the client-driven
                                      convergence that resolves the report.
     phase onboarding + needs_org /
       error_recoverable            → /onboarding (the client-driven flow)
     phase advanced + projectContext
       no_projects                  → /onboarding (the driver auto-creates the
                                      default project from there)
     anything else                  → the chrome, exactly as before

   There is NO rejected branch — the closed-union crash-class model (ADR-049 §4)
   retired phase==='rejected'. /onboarding never redirects an authenticated user
   back here, and the gate never targets /login when a session exists — no loops. */

const ONBOARDING_ACTIVE_STATES = new Set(["needs_org", "error_recoverable"]);

function OnboardingGate({ client }: { client: OnboardingClient }) {
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

  const driver = useMemo(
    () =>
      createOnboardingDriver({
        client,
        report: (event) => proxy.postEvent(event),
        log: createLogger("onboarding-driver"),
      }),
    [client, proxy],
  );

  useEffect(() => {
    void ensureBootstrap();
  }, [ensureBootstrap]);

  // Phase-B probe: when the document shows onboarding awaiting_org_report, the
  // client converges the flow by probing the org SSOT and reporting the
  // definitive outcome (org_found / org_not_found). Re-fires while the state
  // persists awaiting — the driver only POSTs on a definitive HTTP answer.
  const awaitingOrgReport = onboardingState === "awaiting_org_report";
  useEffect(() => {
    if (awaitingOrgReport) void driver.probeAndReportOrg();
  }, [awaitingOrgReport, driver]);

  if (onboardingState === "verifying" || awaitingOrgReport) {
    return <LoadingSurface message="Checking your session…" />;
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

export default function AppShell({
  client = defaultClient,
}: {
  /** Test seam: inject the Phase-B probe's HTTP port; defaults to the backend. */
  client?: OnboardingClient;
}) {
  if (!hasSession()) return <Navigate to="/login" replace />;
  return <OnboardingGate client={client} />;
}
