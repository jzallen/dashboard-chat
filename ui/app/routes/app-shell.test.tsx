// @vitest-environment happy-dom
//
// App-shell behaviors (CDO-S5; ADR-050 §e.4/§f):
//   - clientLoader: org-global fetch gated on the session flag (ui-cookie-session C4).
//   - Onboarding gate (the D6 redirect matrix over the StateProxy document):
//       (a) no session                                   → /login
//       (b) awaiting_org_report                          → waiting state, NO
//           redirect, AND the driver's Phase-B org probe fires
//       (c) phase onboarding + {needs_org, error_recoverable} → /onboarding
//       (d) phase advanced + projectContext no_projects  → /onboarding
//           (the driver auto-creates from there)
//       (e) settled (ready + project_selected)           → the shell chrome
//     There is NO rejected branch (the closed-union model retired it).
//
// Driving port: the route tree under the providers root.tsx supplies. Driven
// ports: the proxy's transport (scriptedStateProxy) + the injected
// OnboardingClient (the probe's HTTP port) + the session-flag mock.
import {
  anonymousStateDocument,
  type ChatAppPhase,
  type ChatAppStateDocument,
} from "@dashboard-chat/ui-state-wire";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hasSession } from "../auth/tokenStorage";
import { ApiError } from "../catalog/dataSources/backendClient";
import { ThemeProvider } from "../components/AppShell/ThemeProvider";
import { FlashedNodeProvider } from "../components/FlashedNodeProvider";
import { installCatalogForTest } from "../components/useCatalog";
import { scriptedStateProxy } from "../lib/_stateProxyTestKit";
import type { OnboardingClient } from "../lib/onboarding-driver";
import { type StateProxy } from "../lib/state-proxy";
import { StateProxyProvider } from "../lib/StateProxyProvider";
import { fixtureFallback, NO_PRIMARY } from "./_fixtureCatalog";
import AppShell from "./app-shell";

vi.mock("../auth/tokenStorage", () => ({ hasSession: vi.fn() }));

afterEach(() => vi.clearAllMocks());

const apiError = (status: number) =>
  new ApiError(status, null, `failed with status ${status}`);

/** A client whose get/post default to empty resolves; programmable per test. */
function makeClient(overrides: Partial<OnboardingClient> = {}): OnboardingClient {
  return {
    get: overrides.get ?? vi.fn(async () => ({})),
    post: overrides.post ?? vi.fn(async () => ({})),
  };
}

describe("AppShell gate", () => {
  it("redirects to /login when there is no session", () => {
    vi.mocked(hasSession).mockReturnValue(false);
    const router = createMemoryRouter(
      [
        { path: "/", element: <AppShell /> },
        { path: "/login", element: <div>LOGIN</div> },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByText("LOGIN")).toBeTruthy();
    expect(hasSession).toHaveBeenCalled();
  });
});

// ── onboarding gate (CDO-S5 redirect matrix) ─────────────────────────────────

/** A document whose phase + region states are scripted; everything else is the
 *  anonymous zero-state. */
function stateDocument(
  phase: ChatAppPhase,
  onboarding: string,
  projectContext: string,
): ChatAppStateDocument {
  const doc = anonymousStateDocument();
  return {
    ...doc,
    phase,
    sequence_id: doc.sequence_id + 1,
    regions: {
      ...doc.regions,
      onboarding: { ...doc.regions.onboarding, state: onboarding },
      projectContext: { ...doc.regions.projectContext, state: projectContext },
    },
  };
}

/** The shared scripted proxy, pinned to one document: every POST returns `doc`. */
function scriptedProxy(doc: ChatAppStateDocument) {
  return scriptedStateProxy(doc, () => doc);
}

/** Render the shell layout at "/" under the providers root.tsx supplies. */
function renderShell(proxy: StateProxy, client: OnboardingClient) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <AppShell client={client} />,
        children: [{ index: true, element: <div>CONTENT</div> }],
      },
      { path: "/onboarding", element: <div>ONBOARDING</div> },
      { path: "/login", element: <div>LOGIN</div> },
    ],
    { initialEntries: ["/"] },
  );
  const utils = render(
    <ThemeProvider>
      <FlashedNodeProvider>
        <StateProxyProvider proxy={proxy}>
          <RouterProvider router={router} />
        </StateProxyProvider>
      </FlashedNodeProvider>
    </ThemeProvider>,
  );
  return { router, ...utils };
}

describe("AppShell onboarding gate (D6 redirect matrix)", () => {
  beforeEach(async () => {
    vi.mocked(hasSession).mockReturnValue(true);
    await installCatalogForTest(NO_PRIMARY, fixtureFallback());
  });

  it("awaiting_org_report: renders the waiting state, posts session_begin, fires the Phase-B probe, and does NOT redirect", async () => {
    // The zero state: onboarding awaiting_org_report; the scripted server keeps
    // it there so the transient state — and the Phase-B probe — is observable.
    const awaiting = stateDocument(
      "onboarding",
      "awaiting_org_report",
      "awaiting_scope_report",
    );
    const { proxy, posted } = scriptedProxy(awaiting);
    // A 404 probe → org_not_found reported (the definitive Phase-B answer).
    const get = vi.fn(async () => {
      throw apiError(404);
    });
    const client = makeClient({ get });

    const { router } = renderShell(proxy, client);

    expect(await screen.findByText(/checking your session/i)).toBeTruthy();
    // ensureBootstrap fired exactly one session_begin at the transport port.
    await waitFor(() =>
      expect(posted.map((e) => e.type)).toContain("session_begin"),
    );
    // The Phase-B probe fired against GET /api/orgs/me.
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/orgs/me"));
    await waitFor(() =>
      expect(posted.map((e) => e.type)).toContain("org_not_found"),
    );
    // No redirect: still on "/", neither destination rendered, no chrome.
    expect(router.state.location.pathname).toBe("/");
    expect(screen.queryByText("ONBOARDING")).toBeNull();
    expect(screen.queryByText("LOGIN")).toBeNull();
  });

  it("D5: the Phase-B probe fires EXACTLY ONCE and does NOT re-fire after the document leaves awaiting_org_report", async () => {
    // The scripted server STARTS in awaiting_org_report; on the org_not_found
    // report it advances the onboarding region to needs_org (leaving the
    // awaiting state). The probe is de-bounced on the awaiting_org_report
    // condition, so it must not re-fire after the state moves on.
    const awaiting = stateDocument(
      "onboarding",
      "awaiting_org_report",
      "awaiting_scope_report",
    );
    const advanced = stateDocument(
      "onboarding",
      "needs_org",
      "awaiting_scope_report",
    );
    const get = vi.fn(async () => {
      throw apiError(404);
    });
    const client = makeClient({ get });
    // First the org_not_found report leaves awaiting; thereafter the document
    // stays in needs_org no matter what.
    const { proxy } = scriptedStateProxy(awaiting, (event) =>
      event.type === "org_not_found" ? advanced : advanced,
    );

    renderShell(proxy, client);

    // The probe fired against GET /api/orgs/me…
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/orgs/me"));
    // …and after the document transitions to /onboarding (needs_org), give the
    // effect time to (not) re-fire. The de-bounce dep array means exactly one.
    await screen.findByText("ONBOARDING");
    await new Promise((r) => setTimeout(r, 20));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it.each(["needs_org", "error_recoverable"])(
    "phase onboarding + %s: redirects to /onboarding",
    async (onboardingState) => {
      const doc = stateDocument("onboarding", onboardingState, "verifying");
      const { proxy } = scriptedProxy(doc);

      const { router } = renderShell(proxy, makeClient());

      expect(await screen.findByText("ONBOARDING")).toBeTruthy();
      expect(router.state.location.pathname).toBe("/onboarding");
    },
  );

  it("phase advanced + projectContext no_projects: redirects to /onboarding (the driver auto-creates from there)", async () => {
    const doc = stateDocument("project_context", "ready", "no_projects");
    const { proxy } = scriptedProxy(doc);

    const { router } = renderShell(proxy, makeClient());

    expect(await screen.findByText("ONBOARDING")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/onboarding");
  });

  it("settled (ready + project_selected): renders the shell chrome — Topbar present, no redirect", async () => {
    const doc = stateDocument("chat", "ready", "project_selected");
    const { proxy } = scriptedProxy(doc);

    const { router } = renderShell(proxy, makeClient());

    // Topbar's upload action is unique to the chrome.
    expect(await screen.findByTitle("Upload a source")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/");
    expect(screen.queryByText("ONBOARDING")).toBeNull();
    expect(screen.queryByText("LOGIN")).toBeNull();
  });
});
