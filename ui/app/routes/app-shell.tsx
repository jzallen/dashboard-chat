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
import {
  type LoaderFunctionArgs,
  Navigate,
  Outlet,
  redirect,
  useLoaderData,
  useLocation,
} from "react-router";

import { hasSession } from "../auth/tokenStorage";
import type {
  Edge,
  LineageNode,
  OrgSettings,
  ProjectSummary,
} from "../catalog";
import { apiGet, apiPost } from "../catalog/dataSources/backendClient";
import {
  type BackendOrg,
  type BackendProject,
  toOrgSettings,
  toProjectSummary,
  unwrapList,
  unwrapSingle,
} from "../catalog/dataSources/metadataMappers";
import { Overlays } from "../components/AppShell/Overlays";
import { useTheme } from "../components/AppShell/ThemeProvider";
import { Topbar } from "../components/AppShell/Topbar";
import { useColdStorage } from "../components/ColdStorage";
import { useExport } from "../components/Export";
import { useFlashedNode } from "../components/FlashedNodeProvider";
import { LoadingSurface } from "../components/LoadingSurface/LoadingSurface";
import { useUpload } from "../components/Upload";
import { catalog, seedOrgGlobal, useCatalog } from "../components/useCatalog";
import {
  apiFetch,
  ApiUnauthenticatedError,
  assertAuthenticated,
} from "../lib/api-client";
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

/** The org-global payload the server loader returns for the initial document. */
export interface OrgGlobalData {
  projects: ProjectSummary[];
  org: OrgSettings;
}

/**
 * Fetch the org-global payloads — the project list and org settings — server-side
 * so the chrome renders with real projects/org in the initial document rather
 * than fetching them after hydration. The component seeds the catalog from this
 * via `useLoaderData()`.
 *
 * Reaches the backend through the server `/api` client (the cookie→Bearer hop),
 * which returns the raw upstream Response — so each body is read and unwrapped
 * from its JSON:API envelope here, then mapped to the catalog DTOs. An
 * unauthenticated (401) response becomes a redirect to /login rather than a
 * client-surfaced error.
 */
export async function loader({
  request,
}: LoaderFunctionArgs): Promise<OrgGlobalData> {
  let projectsRes: Response;
  let orgRes: Response;
  try {
    [projectsRes, orgRes] = await Promise.all([
      apiFetch(request, "/projects").then(assertAuthenticated),
      apiFetch(request, "/orgs/me").then(assertAuthenticated),
    ]);
  } catch (err) {
    if (err instanceof ApiUnauthenticatedError) throw redirect("/login");
    throw err;
  }

  const projects = unwrapList<BackendProject>(await projectsRes.json()).map(
    toProjectSummary,
  );
  const org = toOrgSettings(unwrapSingle<BackendOrg>(await orgRes.json()));
  return { projects, org };
}

/**
 * Org-global data (projects, org settings) does not change with in-app
 * navigation, so the loader runs once per document load and is never
 * revalidated — re-fetching it on every navigation would be redundant.
 */
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

/* ─── the onboarding gate (CDO-S5; ADR-050 §e.4/§f) ───────────────────────────

   Engaged only when a session exists. Reads the StateProxy document (the one
   app-wide proxy from StateProxyProvider) and dispatches:

     onboarding awaiting_org_report → waiting surface (transient; ALSO the
                                      anonymous pre-first-frame zero state — never
                                      a redirect). On this state the gate fires
                                      the driver's Phase-B org probe
                                      (probeOrg) — the client-driven
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
    if (awaitingOrgReport) void driver.probeOrg();
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
  // Seed the catalog from the loader's org-global payload so child routes (the
  // home redirect, the project layout) read real projects/org rather than the
  // fixture seed. Undefined when the route carries no loader — then it's a no-op.
  const data = useLoaderData() as OrgGlobalData | undefined;
  useEffect(() => {
    if (data) seedOrgGlobal(data.projects, data.org);
  }, [data]);

  if (!hasSession()) return <Navigate to="/login" replace />;
  return <OnboardingGate client={client} />;
}
