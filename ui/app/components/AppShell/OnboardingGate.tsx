/* The onboarding gate (CDO-S5; ADR-050 §e.4/§f).

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
import {
  ONBOARDING_ACTIVE_STATES,
  OnboardingState,
  ProjectContextState,
} from "@dashboard-chat/ui-state-wire";
import { useSelector } from "@xstate/react";
import { useEffect, useMemo } from "react";
import { Navigate } from "react-router";

import { ChatProvider } from "../../lib/chatContext";
import { createLogger } from "../../lib/log";
import {
  createOnboardingDriver,
  type OnboardingClient,
} from "../../lib/onboarding-driver";
import { useStateProxy } from "../../lib/StateProxyProvider";
import { LoadingSurface } from "../LoadingSurface/LoadingSurface";
import { Chrome } from "./Chrome";

export function OnboardingGate({ client }: { client: OnboardingClient }) {
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
  const awaitingOrgReport =
    onboardingState === OnboardingState.AwaitingOrgReport;
  useEffect(() => {
    if (awaitingOrgReport) void driver.probeOrg();
  }, [awaitingOrgReport, driver]);

  if (onboardingState === OnboardingState.Verifying || awaitingOrgReport) {
    return <LoadingSurface message="Checking your session…" />;
  }
  if (phase === "onboarding" && ONBOARDING_ACTIVE_STATES.has(onboardingState)) {
    return <Navigate to="/onboarding" replace />;
  }
  if (
    phase !== "onboarding" &&
    projectContextState === ProjectContextState.NoProjects
  ) {
    return <Navigate to="/onboarding" replace />;
  }
  return (
    <ChatProvider>
      <Chrome />
    </ChatProvider>
  );
}
