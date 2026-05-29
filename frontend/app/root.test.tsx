// Tests for the composition-root loader + welcome-panel decision (ADR-046 MR-4).
//
// The root loader fetches the ONE `/state` document once (the SSR seed) instead of
// reading two per-machine projections; `Root` seeds `createStateProxy({ seed })` and
// reads region slices via `useSelector`. The walking-skeleton first paint observes
// `regions.projectContext.state === "no_projects"` to render the welcome panel — the
// same dispatch the old loader did off `project_flow_state`, now off the document.
import { anonymousStateDocument } from "@dashboard-chat/ui-state-wire";
import { cleanup,render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Root, { loader } from "./root";

// ─────────────────────────── port-boundary doubles ───────────────────────────

const mockFetch = vi.fn();

/** jsdom has no EventSource; `useSelector` opens one on subscribe. Stub the
 *  minimal surface the proxy consumes so the seeded read works without network. */
class FakeEventSource {
  onerror: ((ev: unknown) => void) | null = null;
  constructor(public url: string) {}
  addEventListener(): void {}
  close(): void {}
}

function makeRequest(authHeader = "") {
  return new Request("http://localhost/", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ─────────────────────────────── loader ───────────────────────────────

describe("root loader — single /state document seed", () => {
  it("fetches the document ONCE and returns it as the SSR seed", async () => {
    const doc = anonymousStateDocument();
    doc.regions.projectContext.state = "no_projects";
    doc.regions.onboarding.context.user.first_name = "Maya";
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => doc });

    const result = await loader({
      request: makeRequest("Bearer t"),
      params: {},
      context: {},
    } as never);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.document.regions.projectContext.state).toBe("no_projects");
    expect(result.document.regions.onboarding.context.user.first_name).toBe("Maya");
  });

  it("re-throws a 504 so the ErrorBoundary renders the timeout fallback", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 504, json: async () => ({}) });
    await expect(
      loader({ request: makeRequest(), params: {}, context: {} } as never),
    ).rejects.toMatchObject({ status: 504 });
  });

  it("falls back to the anonymous document on a non-504 read failure (no live actor)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    const result = await loader({
      request: makeRequest(),
      params: {},
      context: {},
    } as never);
    // Walking skeleton: a no-flow read folds to the anonymous document so first
    // paint still resolves a sensible phase + project region.
    expect(result.document.phase).toBe("onboarding");
    expect(result.document.regions.projectContext.state).toBe("verifying");
  });
});

// ─────────────────────── Root welcome-panel decision (useSelector) ───────────────────────

function renderRootWith(doc: ReturnType<typeof anonymousStateDocument>) {
  // No HydrateFallback here: it shares the welcome-panel testid and renders
  // transiently (with no loader data) before the loader resolves, which would
  // race the assertion. The Root-decision tests target Root's settled render.
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: Root,
      loader: () => ({ document: doc }),
      children: [
        {
          index: true,
          Component: () => <div data-testid="outlet-child">route content</div>,
        },
      ],
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("Root — first-paint dispatch off the document's regions (walking skeleton)", () => {
  it("renders the no-projects welcome panel when regions.projectContext.state is no_projects", async () => {
    const doc = anonymousStateDocument();
    doc.regions.projectContext.state = "no_projects";
    doc.regions.onboarding.context.user.first_name = "Maya";

    renderRootWith(doc);

    const panel = await screen.findByTestId("no-projects-welcome-panel");
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain("Maya");
    expect(screen.queryByTestId("outlet-child")).toBeNull();
  });

  it("defers to the route Outlet when the project region is not in no_projects", async () => {
    const doc = anonymousStateDocument();
    doc.regions.projectContext.state = "project_selected";

    renderRootWith(doc);

    expect(await screen.findByTestId("outlet-child")).toBeTruthy();
    expect(screen.queryByTestId("no-projects-welcome-panel")).toBeNull();
  });
});
