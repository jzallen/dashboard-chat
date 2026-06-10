// @vitest-environment happy-dom
//
// /onboarding route behaviors (step 02-03, D6 + ORD-4):
//   (a) submitting the org-name form posts org_form_submitted carrying the
//       typed name under payload.org_name (the ONLY event this surface posts);
//   (b) a server-declared invalid name renders the inline
//       regions.onboarding.context.org_validation_error and the user stays on
//       the form (the SERVER decides validity);
//   (c) the principal identity (email / display_name) renders from
//       regions.onboarding.context.user;
//   (d) unauthenticated → navigates to /login and NOWHERE else;
//   (e) the non-form region states render honest surfaces (waiting / progress /
//       state-name-plus-cause errors / neutral continuing placeholder).
//
// Driving port: the route component rendered via a memory router under
// StateProxyProvider (the same provider tree root.tsx supplies). Driven port
// boundary: the proxy's injected fetchImpl + eventSourceFactory — the only test
// doubles, scripted at the transport port. No network, no EventSource.
import {
  anonymousStateDocument,
  type ChatAppStateDocument,
  type ChatAppWireEvent,
  type ReducedContext,
} from "@dashboard-chat/ui-state-wire";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { createStateProxy, type StateProxy } from "../lib/state-proxy";
import { StateProxyProvider } from "../lib/StateProxyProvider";
import OnboardingRoute from "./onboarding";

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

// ── test doubles (at the proxy's transport port only) ────────────────────────

/** Records every posted wire event and resolves the document `respond` scripts
 *  for it — the fake server. */
function scriptedTransport(
  respond: (event: ChatAppWireEvent) => ChatAppStateDocument,
) {
  const posted: ChatAppWireEvent[] = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const event = JSON.parse(String(init?.body)) as ChatAppWireEvent;
    posted.push(event);
    const doc = respond(event);
    return { ok: true, status: 200, json: async () => doc } as Response;
  }) as typeof fetch;
  return { fetchImpl, posted };
}

/** happy-dom has no EventSource — a silent fake stream satisfies subscribe. */
const fakeEventSourceFactory = () => ({
  addEventListener() {},
  close() {},
  onerror: null as ((ev: unknown) => void) | null,
});

function scriptedProxy(
  seed: ChatAppStateDocument,
  respond: (event: ChatAppWireEvent) => ChatAppStateDocument,
) {
  const { fetchImpl, posted } = scriptedTransport(respond);
  const proxy = createStateProxy({
    seed,
    fetchImpl,
    eventSourceFactory: fakeEventSourceFactory,
  });
  return { proxy, posted };
}

// ── render through the real route tree shape (top-level, outside the shell) ──

function renderOnboarding(proxy: StateProxy) {
  const router = createMemoryRouter(
    [
      { path: "/onboarding", element: <OnboardingRoute /> },
      { path: "/login", element: <div>LOGIN</div> },
    ],
    { initialEntries: ["/onboarding"] },
  );
  return render(
    <StateProxyProvider proxy={proxy}>
      <RouterProvider router={router} />
    </StateProxyProvider>,
  );
}

// ── session flag cookie helpers (happy-dom) ──────────────────────────────────

function giveSessionFlag() {
  document.cookie = "session=1";
}

function dropSessionFlag() {
  document.cookie = "session=1; expires=Thu, 01 Jan 1970 00:00:00 GMT";
}

afterEach(dropSessionFlag);

// ── behaviors ────────────────────────────────────────────────────────────────

describe("OnboardingRoute", () => {
  it("unauthenticated: navigates to /login only — no form, no events posted", () => {
    const { proxy, posted } = scriptedProxy(anonymousStateDocument(), () =>
      anonymousStateDocument(),
    );

    renderOnboarding(proxy);

    expect(screen.getByText("LOGIN")).toBeTruthy();
    expect(screen.queryByLabelText(/organization name/i)).toBeNull();
    expect(posted).toHaveLength(0);
  });

  it("needs_org: renders the org-name form with the principal identity from the region context", async () => {
    giveSessionFlag();
    const needsOrg = onboardingDocument("needs_org");
    const { proxy } = scriptedProxy(needsOrg, () => needsOrg);

    renderOnboarding(proxy);

    expect(await screen.findByLabelText(/organization name/i)).toBeTruthy();
    expect(screen.getByText(/dev@example\.com/)).toBeTruthy();
    expect(screen.getByText(/Dev User/)).toBeTruthy();
  });

  it("submitting the form posts org_form_submitted carrying the typed name under payload.org_name", async () => {
    giveSessionFlag();
    const needsOrg = onboardingDocument("needs_org");
    const { proxy, posted } = scriptedProxy(needsOrg, (event) =>
      event.type === "org_form_submitted"
        ? onboardingDocument("creating_org")
        : needsOrg,
    );

    renderOnboarding(proxy);

    fireEvent.change(await screen.findByLabelText(/organization name/i), {
      target: { value: "Acme Rockets" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /create organization/i }),
    );

    // The scripted server advances to creating_org → the progress surface.
    expect(await screen.findByText(/creating/i)).toBeTruthy();
    const orgEvents = posted.filter((e) => e.type === "org_form_submitted");
    expect(orgEvents).toEqual([
      { type: "org_form_submitted", payload: { org_name: "Acme Rockets" } },
    ]);
  });

  it("a server-rejected name renders the inline org_validation_error and the user stays on the form", async () => {
    giveSessionFlag();
    const needsOrg = onboardingDocument("needs_org");
    const rejected = onboardingDocument("needs_org", {
      org_validation_error: {
        kind: "invalid_org_name",
        message: "Organization name must not be blank",
      },
    });
    const { proxy } = scriptedProxy(needsOrg, (event) =>
      event.type === "org_form_submitted" ? rejected : needsOrg,
    );

    renderOnboarding(proxy);

    fireEvent.click(
      await screen.findByRole("button", { name: /create organization/i }),
    );

    expect(
      await screen.findByText("Organization name must not be blank"),
    ).toBeTruthy();
    // Still on the form — state stayed needs_org.
    expect(screen.getByLabelText(/organization name/i)).toBeTruthy();
  });

  it.each([
    ["verifying", /checking your session/i],
    ["creating_org", /creating/i],
    ["ready", /continuing/i],
  ])("renders an honest surface for the %s state", async (state, expected) => {
    giveSessionFlag();
    const doc = onboardingDocument(state);
    const { proxy } = scriptedProxy(doc, () => doc);

    renderOnboarding(proxy);

    expect(await screen.findByText(expected)).toBeTruthy();
  });

  it.each(["error_recoverable", "session_rejected"])(
    "renders the state name AND the cause for the %s error surface — no silent fallback",
    async (state) => {
      giveSessionFlag();
      const doc = onboardingDocument(state, {
        underlying_cause_tag: "org_create_failed",
      });
      const { proxy } = scriptedProxy(doc, () => doc);

      renderOnboarding(proxy);

      expect(await screen.findByText(new RegExp(state))).toBeTruthy();
      expect(screen.getByText(/org_create_failed/)).toBeTruthy();
    },
  );
});
