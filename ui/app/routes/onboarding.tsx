/* /onboarding — the client-driven org-onboarding surface (CDO-S5; ADR-050
   §c/§d/§e.4/§f). A TOP-LEVEL route OUTSIDE the app-shell layout: no Topbar, no
   overlays — just the onboarding region.

   This surface is a THIN consumer of the 05-04 onboarding-driver (the flow
   POLICY): it drives the REAL POST /api/orgs through the driver, then the driver
   posts the past-tense outcome report via proxy.postEvent. The in-flight UI is
   the surface's LOCAL concern (DR-1: the document NEVER shows an in-flight org
   state). Phase D (the default project) is AUTOMATIC — on entering the project
   phase the surface triggers the driver's createDefaultProject ONCE.

   BINDING DISPLAY RULE (ratification amendment 2): the UI NEVER renders a raw
   cause tag. Re-edit causes (org_name_taken / org_name_invalid) → friendly inline
   helper copy the client owns, from regions.onboarding.context.org_validation_error.
   The retry class (org_create_failed / project_create_failed → error_recoverable)
   → a distinct "something went wrong on our end" surface with a retry control.
   Raw tags belong in the driver's console-log audit trail ONLY.

   Flow (ADR-046/050): unauthenticated → /login and nowhere else. Authenticated →
   ensureBootstrap() (the ORD-4 once-latch) and render reactively from
   regions.onboarding via useSelector:

     verifying / awaiting_org_report → waiting surface
     needs_org                       → org-name form (drives the POST + friendly
                                       inline org_validation_error)
     error_recoverable               → the generic retry surface

   Phase advanced past onboarding (project_context | chat) dispatches on
   regions.projectContext:

     awaiting_scope_report / resolving_initial_scope / creating_project
                              → progress surface (Phase D auto-creates)
     project_selected         → navigate("/", {replace:true}) — the (f) home
                                redirect after an RRv7 revalidation re-runs the
                                app-shell server loader (re-seeding real projects)
     error_recoverable        → the generic retry surface */
import {
  type ReducedContext,
  type RegionView,
} from "@dashboard-chat/ui-state-wire";
import { useSelector } from "@xstate/react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useRevalidator } from "react-router";

import { hasSession } from "../auth/tokenStorage";
import { useTheme } from "../components/AppShell";
import { LoadingSurface } from "../components/LoadingSurface/LoadingSurface";
import { createLogger } from "../lib/log";
import { onboardingClient } from "../lib/onboarding-client";
import {
  createOnboardingDriver,
  type OnboardingClient,
  type OnboardingDriver,
} from "../lib/onboarding-driver";
import { useStateProxy } from "../lib/StateProxyProvider";
import styles from "./onboarding.module.css";

const log = createLogger("onboarding");

/** The server-declared inline validation shape (the wire SSOT's
 *  org_validation_error field). */
type ValidationError = ReducedContext["org_validation_error"];

/** The default HTTP port the driver consumes — the gateway adapter that routes
 *  the driver's backend-shaped legs through the same-origin `/ui-server/*`
 *  brokers (preserving the backendClient contract: ApiError on non-2xx). */
const defaultClient: OnboardingClient = onboardingClient;

export default function OnboardingRoute({
  client = defaultClient,
}: {
  /** Test seam: inject the driver's HTTP port; defaults to the real backend. */
  client?: OnboardingClient;
}) {
  const authenticated = hasSession();
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();
  const { rootClassName } = useTheme();
  const { proxy, ensureBootstrap } = useStateProxy();
  const phase = useSelector(proxy, (doc) => doc.phase);
  const onboarding = useSelector(proxy, (doc) => doc.regions.onboarding);
  const projectContext = useSelector(
    proxy,
    (doc) => doc.regions.projectContext,
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
    if (authenticated) void ensureBootstrap();
  }, [authenticated, ensureBootstrap]);

  // Phase D is AUTOMATIC: on entering the project phase awaiting a scope report,
  // create the default project ONCE through the driver. The ref latches so a
  // re-render (or a transient settle) never double-POSTs.
  const projectAutoStarted = useRef(false);
  const projectAwaiting =
    (phase === "project_context" || phase === "chat") &&
    projectContext.state === "awaiting_scope_report";
  useEffect(() => {
    if (authenticated && projectAwaiting && !projectAutoStarted.current) {
      projectAutoStarted.current = true;
      log.info("onboarding.project.auto_create.start", {});
      void driver.createDefaultProject();
    }
  }, [authenticated, projectAwaiting, driver]);

  // Onboarding complete — enter the app (the (f) contract, byte-preserved). Also
  // covers landing on /onboarding ALREADY project_selected: navigate away. The
  // org-global catalog is seeded server-side by the app-shell loader; that org/
  // project did not exist when it last ran, so REVALIDATE first — the framework
  // re-runs the app-shell server loader, which re-seeds real projects/org into the
  // catalog (the ADR-034 convergence: no browser read of the backend). Otherwise
  // the user lands on a stale "No projects yet" shell. A failed revalidation must
  // not trap the user here: log it and navigate anyway (a reload recovers).
  const projectSelected = projectContext.state === "project_selected";
  useEffect(() => {
    if (authenticated && projectSelected) {
      log.info("onboarding.project_selected.entering_app", {});
      void (async () => {
        try {
          await revalidate();
        } catch (error: unknown) {
          log.error("onboarding.revalidate.failed", {
            error: String(error),
          });
        }
        navigate("/", { replace: true });
      })();
    }
  }, [authenticated, projectSelected, navigate, revalidate]);

  if (!authenticated) return <Navigate to="/login" replace />;

  return (
    <div className={`${rootClassName} ${styles.themeFrame}`}>
      {renderSurface()}
    </div>
  );

  // This route renders OUTSIDE the app-shell layout, so the neobrutalist theme
  // class (which scopes every design token under `.app.theme-neobrutalist`) has
  // no ancestor here. Wrap the surface in the SAME `rootClassName` app-shell
  // applies (ThemeProvider is the shared source of truth — same dark state) so
  // the onboarding cards inherit the ink borders, hard offset shadows, Archivo
  // headings and dark-mode overrides instead of the soft base-theme fallback.
  function renderSurface() {
    // Phase advanced past onboarding — the default-project step (auto).
    if (phase === "project_context" || phase === "chat") {
      return <ProjectPhaseSurface driver={driver} region={projectContext} />;
    }

    switch (onboarding.state) {
      case "needs_org":
        return (
          <OrgNameForm driver={driver} context={onboarding.context} />
        );
      case "error_recoverable":
        return <RetrySurface onRetry={() => driver.probeOrg()} />;
      default:
        // verifying / awaiting_org_report (and any transient) — wait honestly.
        return <LoadingSurface message="Checking your session…" />;
    }
  }
}

function ProjectPhaseSurface({
  driver,
  region,
}: {
  driver: OnboardingDriver;
  region: RegionView;
}) {
  switch (region.state) {
    case "project_selected":
      // The navigation effect is taking us into the app.
      return <LoadingSurface message="Entering the app…" />;
    case "error_recoverable":
      return <RetrySurface onRetry={() => driver.retryProject()} />;
    default:
      // awaiting_scope_report (Phase D auto-creating), creating_project,
      // resolving_initial_scope and other transients — a single progress view.
      return <LoadingSurface message="Setting up your workspace…" />;
  }
}

function OrgNameForm({
  driver,
  context,
}: {
  driver: OnboardingDriver;
  context: ReducedContext;
}) {
  const [orgName, setOrgName] = useState("");
  const [busy, setBusy] = useState(false);
  const { user, org_validation_error: validationError } = context;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    log.info("onboarding.org_create.submit", { org_name: orgName });
    setBusy(true);
    void (async () => {
      try {
        await driver.reportOrgCreateResult(orgName);
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <main className={styles.surface}>
      <div className={styles.card}>
        <h1 className={styles.title}>Create your organization</h1>
        <p className={styles.signedIn}>
          Signed in as <b>{user.display_name ?? user.email}</b>
          {user.display_name && user.email ? ` (${user.email})` : null}
        </p>
        <form className={styles.form} onSubmit={onSubmit}>
          <label className={styles.label} htmlFor="org-name">
            Organization name
          </label>
          <input
            id="org-name"
            name="org-name"
            className={styles.input}
            placeholder="Acme Inc."
            autoFocus
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
          />
          {/* DISPLAY RULE: friendly, server-owned inline copy for the re-edit
              causes (org_name_taken / org_name_invalid) — never a raw cause tag. */}
          <FriendlyValidation error={validationError} />
          <button
            type="submit"
            className={`btn primary ${styles.submit}`}
            disabled={busy}
          >
            {busy ? "Creating…" : "Create organization"}
          </button>
        </form>
      </div>
    </main>
  );
}

/** Renders the server-owned friendly message for a re-edit validation error.
 *  Never a raw machine tag — the message text is the client-owned copy. */
function FriendlyValidation({ error }: { error: ValidationError }) {
  if (!error) return null;
  return (
    <p className={styles.error} role="alert">
      {error.message}
    </p>
  );
}

/** The retry class generic surface (DISPLAY RULE): a distinct "our end" message
 *  with a retry control. NO raw cause tag — the machine cause stays in the audit
 *  log, never on screen. */
function RetrySurface({ onRetry }: { onRetry: () => void }) {
  const [busy, setBusy] = useState(false);
  const retry = () => {
    setBusy(true);
    void Promise.resolve(onRetry()).finally(() => setBusy(false));
  };
  return (
    <main className={styles.surface}>
      <div className={styles.card}>
        <h1 className={styles.title}>Something went wrong on our end</h1>
        <p className={styles.body}>
          We couldn’t finish setting things up. Please try again.
        </p>
        <button
          type="button"
          className={`btn primary ${styles.submit}`}
          onClick={retry}
          disabled={busy}
        >
          {busy ? "Retrying…" : "Try again"}
        </button>
      </div>
    </main>
  );
}
