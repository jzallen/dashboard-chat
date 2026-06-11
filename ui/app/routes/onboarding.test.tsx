// @vitest-environment happy-dom
//
// /onboarding route behaviors (CDO-S5; ADR-050 §c DISPLAY RULE + §d/§e.4/§f).
//
// The surface is now a THIN consumer of the 05-04 onboarding-driver: it owns the
// in-flight UI (LOCAL useState — DR-1, never a document state), drives the REAL
// POST through the injected driver/client, and reports the past-tense outcome via
// proxy.postEvent. The driven ports here:
//   - the StateProxy transport (scripted via scriptedStateProxy — posted[] is the
//     event-contract assertion target: org_created / org_create_failed{cause});
//   - the injected OnboardingClient (the driver's HTTP port — scripted per test);
//   - the useCatalog module seam (refreshOrgGlobal — the (f) handoff).
//
// BINDING DISPLAY RULE (ratification amendment 2): the UI NEVER renders a raw
// cause tag. Re-edit causes (org_name_taken / org_name_invalid) → FRIENDLY inline
// helper copy the client owns. The retry class (org_create_failed /
// project_create_failed) → a distinct "something went wrong on our end" surface
// with a retry control. No `Cause: <tag>` string anywhere a failure shows.
import {
  anonymousStateDocument,
  type ChatAppStateDocument,
  type ReducedContext,
} from "@dashboard-chat/ui-state-wire";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../catalog/dataSources/backendClient";
import type { OnboardingClient } from "../lib/onboarding-driver";
import { refreshOrgGlobal } from "../components/useCatalog";
import {
  dropSessionFlag,
  giveSessionFlag,
  scriptedStateProxy as scriptedProxy,
} from "../lib/_stateProxyTestKit";
import { type StateProxy } from "../lib/state-proxy";
import { StateProxyProvider } from "../lib/StateProxyProvider";
import OnboardingRoute from "./onboarding";

vi.mock("../components/useCatalog", () => ({
  refreshOrgGlobal: vi.fn(() => Promise.resolve()),
}));

// ── scripted documents ───────────────────────────────────────────────────────

const IDENTITY = {
  email: "dev@example.com",
  display_name: "Dev User",
  first_name: "Dev",
};

/** A settled document whose onboarding region is in `state` with the principal
 *  identity present, plus optional reduced-context overrides. */
function onboardingDocument(
  state: string,
  contextOverrides: Partial<ReducedContext> = {},
): ChatAppStateDocument {
  const doc = anonymousStateDocument();
  return {
    ...doc,
    sequence_id: doc.sequence_id + 1,
    regions: {
      ...doc.regions,
      onboarding: {
        state,
        context: {
          ...doc.regions.onboarding.context,
          user: { ...IDENTITY },
          ...contextOverrides,
        },
      },
    },
  };
}

/** A settled document whose phase has ADVANCED past onboarding with
 *  projectContext in `state`. */
function projectPhaseDocument(
  projectContextState: string,
  contextOverrides: Partial<ReducedContext> = {},
): ChatAppStateDocument {
  const doc = anonymousStateDocument();
  return {
    ...doc,
    phase: "project_context",
    sequence_id: doc.sequence_id + 1,
    regions: {
      ...doc.regions,
      onboarding: {
        state: "ready",
        context: { ...doc.regions.onboarding.context, user: { ...IDENTITY } },
      },
      projectContext: {
        state: projectContextState,
        context: {
          ...doc.regions.projectContext.context,
          ...contextOverrides,
        },
      },
    },
  };
}

// ── injectable client doubles (the driver's HTTP port) ───────────────────────

const apiError = (status: number, body: unknown = null) =>
  new ApiError(status, body, `failed with status ${status}`);

/** A client whose get/post are programmable; defaults resolve empty. */
function makeClient(overrides: Partial<OnboardingClient> = {}): OnboardingClient {
  return {
    get: overrides.get ?? vi.fn(async () => ({})),
    post: overrides.post ?? vi.fn(async () => ({})),
  };
}

// ── render through the real route tree shape (top-level, outside the shell) ──

function renderOnboarding(proxy: StateProxy, client: OnboardingClient) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <div>APP</div> },
      { path: "/onboarding", element: <OnboardingRoute client={client} /> },
      { path: "/login", element: <div>LOGIN</div> },
    ],
    { initialEntries: ["/onboarding"] },
  );
  const utils = render(
    <StateProxyProvider proxy={proxy}>
      <RouterProvider router={router} />
    </StateProxyProvider>,
  );
  return { router, ...utils };
}

afterEach(dropSessionFlag);

beforeEach(() => {
  vi.mocked(refreshOrgGlobal).mockReset();
  vi.mocked(refreshOrgGlobal).mockResolvedValue(undefined);
});

// ── behaviors ────────────────────────────────────────────────────────────────

describe("OnboardingRoute", () => {
  it("unauthenticated: navigates to /login only — no form, no events posted", () => {
    const { proxy, posted } = scriptedProxy(anonymousStateDocument(), () =>
      anonymousStateDocument(),
    );

    renderOnboarding(proxy, makeClient());

    expect(screen.getByText("LOGIN")).toBeTruthy();
    expect(screen.queryByLabelText(/organization name/i)).toBeNull();
    expect(posted).toHaveLength(0);
  });

  it("needs_org: renders the org-name form with the principal identity from the region context", async () => {
    giveSessionFlag();
    const needsOrg = onboardingDocument("needs_org");
    const { proxy } = scriptedProxy(needsOrg, () => needsOrg);

    renderOnboarding(proxy, makeClient());

    expect(await screen.findByLabelText(/organization name/i)).toBeTruthy();
    expect(screen.getByText(/dev@example\.com/)).toBeTruthy();
    expect(screen.getByText(/Dev User/)).toBeTruthy();
  });

  it("submitting the form drives a POST /api/orgs and reports org_created on 201", async () => {
    giveSessionFlag();
    const needsOrg = onboardingDocument("needs_org");
    const post = vi.fn(async () => ({ id: "org-7", name: "Acme Rockets" }));
    const client = makeClient({ post });
    // The scripted server: on the past-tense org_created report it advances the
    // onboarding region to ready (the document leaves needs_org).
    const { proxy, posted } = scriptedProxy(needsOrg, (event) =>
      event.type === "org_created" ? onboardingDocument("ready") : needsOrg,
    );

    renderOnboarding(proxy, client);

    fireEvent.change(await screen.findByLabelText(/organization name/i), {
      target: { value: "Acme Rockets" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /create organization/i }),
    );

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/orgs", { name: "Acme Rockets" }),
    );
    await waitFor(() =>
      expect(posted.map((e) => e.type)).toContain("org_created"),
    );
    expect(posted.filter((e) => e.type === "org_created")).toEqual([
      {
        type: "org_created",
        payload: { org: { id: "org-7", name: "Acme Rockets" } },
      },
    ]);
  });

  it.each([
    [409, "org_name_taken"],
    [400, "org_name_invalid"],
    [422, "org_name_invalid"],
  ])(
    "a %s org-create reports org_create_failed{cause} — no raw cause tag rendered",
    async (status, cause) => {
      giveSessionFlag();
      const needsOrg = onboardingDocument("needs_org");
      const post = vi.fn(async () => {
        throw apiError(status);
      });
      const client = makeClient({ post });
      const { proxy, posted } = scriptedProxy(needsOrg, () => needsOrg);

      renderOnboarding(proxy, client);

      fireEvent.change(await screen.findByLabelText(/organization name/i), {
        target: { value: "Acme Rockets" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: /create organization/i }),
      );

      await waitFor(() =>
        expect(posted.map((e) => e.type)).toContain("org_create_failed"),
      );
      expect(posted.filter((e) => e.type === "org_create_failed")).toEqual([
        {
          type: "org_create_failed",
          payload: { cause, org_name: "Acme Rockets" },
        },
      ]);
      // DISPLAY RULE: the raw cause tag NEVER appears in the DOM.
      expect(screen.queryByText(new RegExp(cause))).toBeNull();
    },
  );

  it("a re-edit cause (org_name_taken) renders FRIENDLY inline helper copy — never the raw tag", async () => {
    giveSessionFlag();
    const rejected = onboardingDocument("needs_org", {
      org_validation_error: {
        kind: "org_name_taken",
        message: "That organization name is already in use — try another",
      },
    });
    const { proxy } = scriptedProxy(rejected, () => rejected);

    renderOnboarding(proxy, makeClient());

    // Friendly copy renders inline on the org form…
    expect(
      await screen.findByText(/already in use/i),
    ).toBeTruthy();
    // …and the user stays on the form to re-edit.
    expect(screen.getByLabelText(/organization name/i)).toBeTruthy();
    // The raw machine tag is NOWHERE in the document.
    expect(screen.queryByText("org_name_taken")).toBeNull();
  });

  it("the retry class (error_recoverable) renders the generic surface + a retry control — no raw cause tag", async () => {
    giveSessionFlag();
    const doc = onboardingDocument("error_recoverable", {
      underlying_cause_tag: "org_create_failed",
    });
    // Probe-first retry (earned trust): re-probe GET /api/orgs/me; a 404 re-arms
    // the form via org_not_found.
    const get = vi.fn(async () => {
      throw apiError(404);
    });
    const client = makeClient({ get });
    const { proxy } = scriptedProxy(doc, () => doc);

    renderOnboarding(proxy, client);

    // The generic "our end" surface — NOT a state-name/cause dump.
    expect(
      await screen.findByText(/something went wrong on our end/i),
    ).toBeTruthy();
    // The raw cause tag is absent.
    expect(screen.queryByText("org_create_failed")).toBeNull();
    expect(screen.queryByText(/Cause:/)).toBeNull();

    // The retry control re-drives the org probe through the driver.
    fireEvent.click(screen.getByRole("button", { name: /try again|retry/i }));
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/orgs/me"));
  });

  it.each([
    ["verifying", /checking your session/i],
    ["awaiting_org_report", /checking your session/i],
  ])("renders a waiting surface for the %s state", async (state, expected) => {
    giveSessionFlag();
    const doc = onboardingDocument(state);
    const { proxy } = scriptedProxy(doc, () => doc);

    renderOnboarding(proxy, makeClient());

    expect(await screen.findByText(expected)).toBeTruthy();
  });
});

// ── Phase D: AUTOMATIC default-project creation (ProjectNameForm GONE) ────────

describe("OnboardingRoute — default-project step (phase advanced)", () => {
  it("no project-name form exists anywhere — Phase D is automatic", async () => {
    giveSessionFlag();
    const awaiting = projectPhaseDocument("awaiting_scope_report");
    const post = vi.fn(async () => ({ id: "proj-1", name: "My First Project" }));
    const client = makeClient({ post });
    const { proxy } = scriptedProxy(awaiting, (event) =>
      event.type === "project_created"
        ? projectPhaseDocument("project_selected")
        : awaiting,
    );

    renderOnboarding(proxy, client);

    // Wait for the automatic create to fire; the form is never present.
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(screen.queryByLabelText(/project name/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /create project/i }),
    ).toBeNull();
  });

  it("entering the project phase auto-creates the default project ONCE and reports project_created", async () => {
    giveSessionFlag();
    const awaiting = projectPhaseDocument("awaiting_scope_report");
    const post = vi.fn(async () => ({ id: "proj-1", name: "My First Project" }));
    const client = makeClient({ post });
    const { proxy, posted } = scriptedProxy(awaiting, () => awaiting);

    renderOnboarding(proxy, client);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/projects", {
      name: "My First Project",
    });
    await waitFor(() =>
      expect(posted.map((e) => e.type)).toContain("project_created"),
    );
    expect(posted.filter((e) => e.type === "project_created")).toEqual([
      {
        type: "project_created",
        payload: { project: { id: "proj-1", name: "My First Project" } },
      },
    ]);
  });

  it("project_selected: awaits refreshOrgGlobal BEFORE navigating — the org-global catalog is stale at the handoff", async () => {
    giveSessionFlag();
    let resolveRefresh!: () => void;
    vi.mocked(refreshOrgGlobal).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const selected = projectPhaseDocument("project_selected");
    const { proxy } = scriptedProxy(selected, () => selected);

    const { router } = renderOnboarding(proxy, makeClient());

    // Refresh in flight — still on /onboarding, refresh requested exactly once.
    expect(await screen.findByText(/entering the app/i)).toBeTruthy();
    expect(refreshOrgGlobal).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe("/onboarding");

    resolveRefresh();

    // Only AFTER the refresh settles does navigation occur.
    expect(await screen.findByText("APP")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/");
  });

  it("project_selected: a rejected refreshOrgGlobal still navigates into the app — never traps the user", async () => {
    giveSessionFlag();
    vi.mocked(refreshOrgGlobal).mockRejectedValue(
      new Error("catalog refresh failed"),
    );
    const selected = projectPhaseDocument("project_selected");
    const { proxy } = scriptedProxy(selected, () => selected);

    const { router } = renderOnboarding(proxy, makeClient());

    expect(await screen.findByText("APP")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/");
    expect(refreshOrgGlobal).toHaveBeenCalledTimes(1);
  });

  it("project_create_failed (retry class): renders the generic surface + retry, never a raw cause tag", async () => {
    giveSessionFlag();
    const doc = projectPhaseDocument("error_recoverable", {
      underlying_cause_tag: "project_create_failed",
    });
    const post = vi.fn(async () => ({ id: "proj-2", name: "My First Project" }));
    const get = vi.fn(async () => []);
    const client = makeClient({ post, get });
    const { proxy } = scriptedProxy(doc, () => doc);

    renderOnboarding(proxy, client);

    expect(
      await screen.findByText(/something went wrong on our end/i),
    ).toBeTruthy();
    expect(screen.queryByText("project_create_failed")).toBeNull();
    expect(screen.queryByText(/Cause:/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /try again|retry/i }));
    await waitFor(() => expect(get).toHaveBeenCalled());
  });
});
