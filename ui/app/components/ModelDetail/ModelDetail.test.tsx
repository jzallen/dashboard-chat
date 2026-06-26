// @vitest-environment happy-dom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createMemoryRouter,
  type RouteObject,
  RouterProvider,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fixtureFallback } from "../../../app/routes/_fixtureCatalog";
import type {
  AuditEntry,
  LineageNode,
  PartialCatalogSource,
} from "../../catalog";
import { catalog, installCatalogForTest, selectProject } from "../useCatalog";
import { ModelDetail } from "./ModelDetail";

afterEach(() => vi.restoreAllMocks());

/** A fallback whose d1 dataset carries a mix of audit entries:
 *  - ae-tx  : transform-type (transformId set) → toggleable
 *  - ae-log : log-only (no transformId)        → no control
 */
function fallbackWithAudit(): ReturnType<typeof fixtureFallback> {
  const base = fixtureFallback();
  const audit: Record<string, AuditEntry[]> = {
    d1: [
      {
        tool: "trimWhitespace",
        say: "Trimmed whitespace on email",
        tag: "clean",
        auditEntryId: "ae-tx",
        transformId: "t1",
        enabled: true,
      },
      {
        tool: "createView",
        say: "Logged a structural change",
        tag: "create",
        auditEntryId: "ae-log",
        transformId: null,
      },
    ],
  };
  return { ...base, getAudit: () => Promise.resolve(audit) };
}

const d1Node = (): LineageNode => catalog.getNode("d1")!;

type Captured = {
  method: string;
  params: Record<string, string | undefined>;
  body: unknown;
};

/** Render <ModelDetail> inside a memory data router carrying the four /ui-server
 *  action routes as capturing spies. The component needs a data-router for its
 *  `useFetcher` submissions; an untouched action stays `undefined` (the proof a
 *  given mutation did NOT submit — used by the cancel/escape/no-op specs). The
 *  positive submission contract lives in ModelDetail.wiring.test.tsx. */
function renderDetail(node: LineageNode): { captured: Record<string, Captured | undefined> } {
  const captured: Record<string, Captured | undefined> = {};
  const spyAction =
    (key: string) =>
    async ({
      request,
      params,
    }: {
      request: Request;
      params: Record<string, string | undefined>;
    }) => {
      captured[key] = {
        method: request.method,
        params,
        body: await request.json().catch(() => undefined),
      };
      return Response.json({});
    };
  const routes: RouteObject[] = [
    { path: "/host", element: <ModelDetail node={node} onOpen={vi.fn()} /> },
    { path: "/ui-server/datasets/:datasetId", action: spyAction("dataset") },
    {
      path: "/ui-server/projects/:projectId/views/:viewId",
      action: spyAction("view"),
    },
    {
      path: "/ui-server/projects/:projectId/reports/:reportId",
      action: spyAction("report"),
    },
    {
      path: "/ui-server/projects/:projectId/audit/:auditEntryId",
      action: spyAction("audit"),
    },
  ];
  const router = createMemoryRouter(routes, { initialEntries: ["/host"] });
  render(<RouterProvider router={router} />);
  return { captured };
}

async function installScoped(primary: PartialCatalogSource): Promise<void> {
  await installCatalogForTest(primary, fallbackWithAudit());
  await act(async () => {
    await selectProject("proj-1");
  });
}

/** The clickable header name (a div whose only text is the dataset label). */
function headerName(): HTMLElement {
  return screen
    .getAllByText("stg_customers")
    .find((el) => el.className.includes("detName"))!;
}

describe("ModelDetail AuditPanel — transform toggle control", () => {
  it("renders a toggle for transform-type entries and none for log-only entries", async () => {
    await installScoped({});

    renderDetail(d1Node());

    await waitFor(() =>
      expect(screen.getByText("Trimmed whitespace on email")).toBeTruthy(),
    );

    // Exactly one toggle — the transform-type entry has one, the log-only does not.
    const toggles = screen.getAllByRole("switch");
    expect(toggles).toHaveLength(1);
    expect((toggles[0] as HTMLInputElement).checked).toBe(true);
  });

  it("shows a 'disabled' chip for a transform entry that is toggled off", async () => {
    const base = fixtureFallback();
    const audit: Record<string, AuditEntry[]> = {
      d1: [
        {
          tool: "trimWhitespace",
          say: "Trimmed whitespace on email",
          tag: "clean",
          auditEntryId: "ae-tx",
          transformId: "t1",
          enabled: false,
        },
      ],
    };
    await installCatalogForTest(
      {},
      { ...base, getAudit: () => Promise.resolve(audit) },
    );
    await act(async () => {
      await selectProject("proj-1");
    });

    renderDetail(d1Node());
    await waitFor(() =>
      expect(screen.getByText("Trimmed whitespace on email")).toBeTruthy(),
    );

    // The entry stays in the trail but is marked disabled and the toggle is off.
    expect(screen.getByText("disabled")).toBeTruthy();
    expect((screen.getByRole("switch") as HTMLInputElement).checked).toBe(
      false,
    );
  });
});

describe("ModelDetail subheader — editable dbt machine name (Slice C)", () => {
  /** The subheader element (the `detFriendly` text node under the header). */
  function subheader(): HTMLElement {
    return screen
      .getAllByText("stg_customers")
      .find((el) => el.className.includes("detFriendly"))!;
  }

  it("renders the dataset's modelName as the subheader", async () => {
    await installScoped({});

    renderDetail(d1Node());
    await waitFor(() => expect(subheader()).toBeTruthy());

    expect(subheader().textContent).toBe("stg_customers");
  });

  it("opens a draft editor on click, then a blocking confirm dialog on commit — without submitting yet", async () => {
    await installScoped({});

    const { captured } = renderDetail(d1Node());
    await waitFor(() => expect(subheader()).toBeTruthy());

    await act(async () => {
      subheader().click();
    });
    const input = screen.getByLabelText(
      "Edit dataset machine name",
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "warm_leads" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // Commit does NOT write yet — it opens a blocking confirm dialog first.
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain("stg_customers");
    expect(dialog.textContent).toContain("warm_leads");
    expect(captured.dataset).toBeUndefined();
  });

  it("submits only the machine name (never the display name) after confirming", async () => {
    await installScoped({});

    const { captured } = renderDetail(d1Node());
    await waitFor(() => expect(subheader()).toBeTruthy());

    await act(async () => {
      subheader().click();
    });
    const input = screen.getByLabelText(
      "Edit dataset machine name",
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "warm_leads" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await act(async () => {
      screen.getByRole("button", { name: /change machine name/i }).click();
    });

    await waitFor(() => expect(captured.dataset).toBeDefined());
    expect(captured.dataset?.body).toEqual({ model_name: "warm_leads" });
  });

  it("cancelling the dialog reverts the draft and submits nothing", async () => {
    await installScoped({});

    const { captured } = renderDetail(d1Node());
    await waitFor(() => expect(subheader()).toBeTruthy());

    await act(async () => {
      subheader().click();
    });
    const input = screen.getByLabelText(
      "Edit dataset machine name",
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "warm_leads" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await act(async () => {
      screen.getByRole("button", { name: /cancel/i }).click();
    });

    expect(captured.dataset).toBeUndefined();
    // Draft reverted: the original machine name is shown, no dialog remains.
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(subheader().textContent).toBe("stg_customers"));
  });

  it("Escape in the editor reverts the draft without opening the dialog", async () => {
    await installScoped({});

    const { captured } = renderDetail(d1Node());
    await waitFor(() => expect(subheader()).toBeTruthy());

    await act(async () => {
      subheader().click();
    });
    const input = screen.getByLabelText(
      "Edit dataset machine name",
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "throwaway" } });
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(captured.dataset).toBeUndefined();
    await waitFor(() => expect(subheader().textContent).toBe("stg_customers"));
  });

  it("does not open the dialog (or submit) for an empty or unchanged draft", async () => {
    await installScoped({});

    const { captured } = renderDetail(d1Node());
    await waitFor(() => expect(subheader()).toBeTruthy());

    await act(async () => {
      subheader().click();
    });
    const input = screen.getByLabelText(
      "Edit dataset machine name",
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(captured.dataset).toBeUndefined();
  });
});

describe("ModelDetail header — inline dataset rename", () => {
  it("cancels on Escape without submitting", async () => {
    await installScoped({});

    const { captured } = renderDetail(d1Node());
    await waitFor(() => expect(headerName()).toBeTruthy());

    await act(async () => {
      headerName().click();
    });
    const input = screen.getByLabelText(
      "Edit dataset name",
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Throwaway" } });
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(captured.dataset).toBeUndefined();
    expect(headerName()).toBeTruthy();
  });

  it("does not submit an empty or unchanged name", async () => {
    await installScoped({});

    const { captured } = renderDetail(d1Node());
    await waitFor(() => expect(headerName()).toBeTruthy());

    await act(async () => {
      headerName().click();
    });
    const input = screen.getByLabelText(
      "Edit dataset name",
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(captured.dataset).toBeUndefined();
  });
});
