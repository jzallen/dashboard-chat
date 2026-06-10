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
     anything else      → neutral "continuing…" placeholder (02-05 replaces it)

   While onboarding is the active phase the server accepts ONLY
   org_form_submitted (Decision 3 closed vocabulary) — this surface posts
   nothing else. */
import { useSelector } from "@xstate/react";
import { type FormEvent, useEffect, useState } from "react";
import { Navigate } from "react-router";

import { hasSession } from "../auth/tokenStorage";
import { createLogger } from "../lib/log";
import { type StateProxy } from "../lib/state-proxy";
import { useStateProxy } from "../lib/StateProxyProvider";

const log = createLogger("onboarding");

export default function OnboardingRoute() {
  const authenticated = hasSession();
  const { proxy, ensureBootstrap } = useStateProxy();
  const onboarding = useSelector(proxy, (doc) => doc.regions.onboarding);

  useEffect(() => {
    if (authenticated) void ensureBootstrap();
  }, [authenticated, ensureBootstrap]);

  if (!authenticated) return <Navigate to="/login" replace />;

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
      // The region moved past onboarding (e.g. ready) — 02-05 owns what comes
      // next; stay minimal and honest.
      return <Surface title="Continuing…" />;
  }
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
