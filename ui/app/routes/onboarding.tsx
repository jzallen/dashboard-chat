/* /onboarding — the org-onboarding surface (D6). A TOP-LEVEL route OUTSIDE the
   app-shell layout: no Topbar, no overlays — just the onboarding region.

   Flow (ADR-046): unauthenticated → /login and nowhere else. Authenticated →
   ensureBootstrap() (the ORD-4 once-latch; session_begin cold-starts the server
   actor) and render reactively from regions.onboarding via useSelector:

     verifying          → waiting surface
     needs_org          → org-name form (principal identity + inline
                          org_validation_error — the SERVER decides validity)
     creating_org       → progress surface
     error_recoverable /
     session_rejected   → honest error surface (state name + cause, no fallback)
     anything else      → neutral "continuing…" placeholder

   S4 completion (02-05): once the phase has ADVANCED past onboarding
   (project_context | chat) this surface dispatches on regions.projectContext:

     no_projects            → default-project name form (+ inline
                              project_validation_error — the SERVER decides)
     creating_project       → progress surface
     project_selected       → navigate("/", {replace:true}) — the home redirect
                              + 02-04 shell gate take over
     error_recoverable      → honest error surface (state name + cause)
     anything else          → waiting surface until the region settles
                              (covers resolving_initial_scope)

   While onboarding is the active phase the server accepts ONLY
   org_form_submitted (Decision 3 closed vocabulary) — posting
   create_project_submitted then would 400 against the ADR-046 ACL, so the
   project form renders only after the phase has advanced. */
import { useSelector } from "@xstate/react";
import { type FormEvent, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router";

import { hasSession } from "../auth/tokenStorage";
import { createLogger } from "../lib/log";
import { type StateProxy } from "../lib/state-proxy";
import { useStateProxy } from "../lib/StateProxyProvider";

const log = createLogger("onboarding");

export default function OnboardingRoute() {
  const authenticated = hasSession();
  const navigate = useNavigate();
  const { proxy, ensureBootstrap } = useStateProxy();
  const phase = useSelector(proxy, (doc) => doc.phase);
  const onboarding = useSelector(proxy, (doc) => doc.regions.onboarding);
  const projectContext = useSelector(
    proxy,
    (doc) => doc.regions.projectContext,
  );

  useEffect(() => {
    if (authenticated) void ensureBootstrap();
  }, [authenticated, ensureBootstrap]);

  // Onboarding complete — enter the app. Also covers landing on /onboarding
  // ALREADY project_selected: navigate away immediately.
  const projectSelected = projectContext.state === "project_selected";
  useEffect(() => {
    if (authenticated && projectSelected) {
      log.info("onboarding.project_selected.entering_app", {});
      navigate("/", { replace: true });
    }
  }, [authenticated, projectSelected, navigate]);

  if (!authenticated) return <Navigate to="/login" replace />;

  // Phase advanced past onboarding — the default-project step (02-05).
  if (phase === "project_context" || phase === "chat") {
    return <ProjectPhaseSurface proxy={proxy} region={projectContext} />;
  }

  switch (onboarding.state) {
    case "verifying":
      return <Surface title="Checking your session…" />;
    case "needs_org":
      return <OrgNameForm proxy={proxy} context={onboarding.context} />;
    case "creating_org":
      return <Surface title="Creating your organization…" />;
    case "error_recoverable":
    case "session_rejected":
      return (
        <ErrorSurface
          state={onboarding.state}
          cause={onboarding.context.underlying_cause_tag}
        />
      );
    default:
      // The region settled (e.g. ready) but the phase has not advanced yet —
      // stay minimal and honest until the document catches up.
      return <Surface title="Continuing…" />;
  }
}

function ProjectPhaseSurface({
  proxy,
  region,
}: {
  proxy: StateProxy;
  region: {
    state: string;
    context: {
      underlying_cause_tag: string | null;
      project_validation_error: { kind: string; message: string } | null;
    };
  };
}) {
  switch (region.state) {
    case "no_projects":
      return (
        <ProjectNameForm
          proxy={proxy}
          validationError={region.context.project_validation_error}
        />
      );
    case "creating_project":
      return <Surface title="Creating your project…" />;
    case "project_selected":
      // The navigation effect is taking us into the app.
      return <Surface title="Entering the app…" />;
    case "error_recoverable":
      return (
        <ErrorSurface
          state={region.state}
          cause={region.context.underlying_cause_tag}
        />
      );
    default:
      // resolving_initial_scope (and other transients) — wait until it settles.
      return <Surface title="Setting up your workspace…" />;
  }
}

function ProjectNameForm({
  proxy,
  validationError,
}: {
  proxy: StateProxy;
  validationError: { kind: string; message: string } | null;
}) {
  const [projectName, setProjectName] = useState("");

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    log.info("onboarding.create_project_submitted", {
      project_name: projectName,
    });
    // UI-1 quirk: the wire field is `org_name` but it carries the PROJECT
    // name — historical machine-side misnomer; project-context's
    // capturePendingProjectName + projectNameValid guard read event.org_name
    // (docs/feature/org-onboarding/distill/upstream-issues.md, UI-1).
    proxy
      .postEvent({
        type: "create_project_submitted",
        payload: { org_name: projectName },
      })
      .catch((error: unknown) => {
        log.error("onboarding.create_project_submit.failed", {
          error: String(error),
        });
      });
  };

  return (
    <main style={surfaceStyle}>
      <h1>Name your first project</h1>
      <form onSubmit={onSubmit}>
        <label htmlFor="project-name">Project name</label>{" "}
        <input
          id="project-name"
          name="project-name"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
        />{" "}
        <button type="submit">Create project</button>
        {validationError ? (
          <p role="alert">{validationError.message}</p>
        ) : null}
      </form>
    </main>
  );
}

function OrgNameForm({
  proxy,
  context,
}: {
  proxy: StateProxy;
  context: { user: { email: string | null; display_name: string | null };
    org_validation_error: { kind: string; message: string } | null };
}) {
  const [orgName, setOrgName] = useState("");
  const { user, org_validation_error: validationError } = context;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    log.info("onboarding.org_form_submitted", { org_name: orgName });
    proxy
      .postEvent({ type: "org_form_submitted", payload: { org_name: orgName } })
      .catch((error: unknown) => {
        log.error("onboarding.org_form_submit.failed", {
          error: String(error),
        });
      });
  };

  return (
    <main style={surfaceStyle}>
      <h1>Create your organization</h1>
      <p>
        Signed in as {user.display_name ?? user.email}
        {user.display_name && user.email ? ` (${user.email})` : null}
      </p>
      <form onSubmit={onSubmit}>
        <label htmlFor="org-name">Organization name</label>{" "}
        <input
          id="org-name"
          name="org-name"
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
        />{" "}
        <button type="submit">Create organization</button>
        {validationError ? (
          <p role="alert">{validationError.message}</p>
        ) : null}
      </form>
    </main>
  );
}

function Surface({ title }: { title: string }) {
  return (
    <main style={surfaceStyle}>
      <p>{title}</p>
    </main>
  );
}

function ErrorSurface({ state, cause }: { state: string; cause: string | null }) {
  return (
    <main style={surfaceStyle}>
      <h1>Onboarding hit a problem</h1>
      <p>State: {state}</p>
      <p>Cause: {cause ?? "unknown"}</p>
    </main>
  );
}

const surfaceStyle = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  font: "16px/1.5 system-ui,sans-serif",
} as const;
