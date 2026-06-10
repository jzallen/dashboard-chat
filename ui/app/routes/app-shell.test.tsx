// @vitest-environment happy-dom
//
// App-shell behaviors:
//   - clientLoader: org-global fetch gated on the session flag (ui-cookie-session C4).
//   - Onboarding gate (step 02-04, D6): redirect matrix over the StateProxy
//     document — (a) no session → /login; (b) verifying → waiting state, NO
//     redirect; (c) phase onboarding + {needs_org, creating_org,
//     error_recoverable} → /onboarding; (d) phase advanced + projectContext
//     no_projects → /onboarding; (rejected) phase rejected → /onboarding (the
//     02-03 surface renders the honest error — one consistent surface, no loop);
//     (e) settled (ready + project_selected) → the shell chrome renders.
//
// Driving port: the route tree (memory router rendering the shell layout) under
// the same providers root.tsx supplies. Driven port boundary: the proxy's
// injected fetchImpl + eventSourceFactory (the onboarding.test.tsx pattern) —
// the only test doubles besides the session-flag mock. No network, no EventSource.
import {
  anonymousStateDocument,
  type ChatAppPhase,
  type ChatAppStateDocument,
} from "@dashboard-chat/ui-state-wire";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hasSession } from "../auth/tokenStorage";
import { ThemeProvider } from "../components/AppShell/ThemeProvider";
import { FlashedNodeProvider } from "../components/FlashedNodeProvider";
import {
  installCatalogForTest,
  refreshOrgGlobal,
} from "../components/useCatalog";
import { scriptedStateProxy } from "../lib/_stateProxyTestKit";
import { type StateProxy } from "../lib/state-proxy";
import { StateProxyProvider } from "../lib/StateProxyProvider";
import { fixtureFallback, NO_PRIMARY } from "./_fixtureCatalog";
import AppShell, { clientLoader } from "./app-shell";

vi.mock("../auth/tokenStorage", () => ({ hasSession: vi.fn() }));
// Keep the REAL catalog machinery (the chrome reads the live `catalog` binding)
// but stub the org-global refresh — the loader tests assert its gating.
vi.mock("../components/useCatalog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../components/useCatalog")>();
  return {
    ...actual,
    get catalog() {
      return actual.catalog;
    },
    refreshOrgGlobal: vi.fn(async () => {}),
  };
});

afterEach(() => vi.clearAllMocks());

describe("app-shell clientLoader — org-global fetch gated on the session", () => {
  it("fetches org-global data when hasSession() is true", async () => {
    vi.mocked(hasSession).mockReturnValue(true);
    await clientLoader();
    expect(refreshOrgGlobal).toHaveBeenCalledTimes(1);
  });

  it("does NOT fetch when hasSession() is false (no 401s on the login round-trip)", async () => {
    vi.mocked(hasSession).mockReturnValue(false);
    await clientLoader();
    expect(refreshOrgGlobal).not.toHaveBeenCalled();
  });
});

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

// ── onboarding gate (02-04) ──────────────────────────────────────────────────

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

/** The shared scripted proxy, pinned to one document: every POST returns
 *  `doc` — the document never advances, so each gate branch stays observable. */
function scriptedProxy(doc: ChatAppStateDocument) {
  return scriptedStateProxy(doc, () => doc);
}

/** Render the shell layout at "/" under the providers root.tsx supplies, with
 *  stub targets for the two redirect destinations. */
function renderShell(proxy: StateProxy) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <AppShell />,
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

  it("verifying: renders the waiting state, posts session_begin, and does NOT redirect", async () => {
    // The anonymous document — every region verifying; the scripted server keeps
    // it verifying so the transient state is observable.
    const { proxy, posted } = scriptedProxy(anonymousStateDocument());

    const { router } = renderShell(proxy);

    expect(await screen.findByText(/checking your session/i)).toBeTruthy();
    // ensureBootstrap fired exactly one session_begin at the transport port.
    await waitFor(() =>
      expect(posted.map((e) => e.type)).toContain("session_begin"),
    );
    // No redirect: still on "/", neither destination rendered, no chrome.
    expect(router.state.location.pathname).toBe("/");
    expect(screen.queryByText("ONBOARDING")).toBeNull();
    expect(screen.queryByText("LOGIN")).toBeNull();
    expect(screen.queryByTitle("Upload a source")).toBeNull();
  });

  it.each(["needs_org", "creating_org", "error_recoverable"])(
    "phase onboarding + %s: redirects to /onboarding",
    async (onboardingState) => {
      const doc = stateDocument("onboarding", onboardingState, "verifying");
      const { proxy } = scriptedProxy(doc);

      const { router } = renderShell(proxy);

      expect(await screen.findByText("ONBOARDING")).toBeTruthy();
      expect(router.state.location.pathname).toBe("/onboarding");
    },
  );

  it("phase advanced + projectContext no_projects: redirects to /onboarding (default-project step)", async () => {
    const doc = stateDocument("project_context", "ready", "no_projects");
    const { proxy } = scriptedProxy(doc);

    const { router } = renderShell(proxy);

    expect(await screen.findByText("ONBOARDING")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/onboarding");
  });

  it("phase rejected: redirects to /onboarding (the 02-03 honest error surface — one surface, no loop)", async () => {
    const doc = stateDocument("rejected", "session_rejected", "verifying");
    const { proxy } = scriptedProxy(doc);

    const { router } = renderShell(proxy);

    expect(await screen.findByText("ONBOARDING")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/onboarding");
    // No bounce: the shell route is gone, /onboarding stays put.
    expect(screen.queryByText("LOGIN")).toBeNull();
  });

  it("settled (ready + project_selected): renders the shell chrome — Topbar present, no redirect", async () => {
    const doc = stateDocument("chat", "ready", "project_selected");
    const { proxy } = scriptedProxy(doc);

    const { router } = renderShell(proxy);

    // Topbar's upload action is unique to the chrome.
    expect(await screen.findByTitle("Upload a source")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/");
    expect(screen.queryByText("ONBOARDING")).toBeNull();
    expect(screen.queryByText("LOGIN")).toBeNull();
  });
});
