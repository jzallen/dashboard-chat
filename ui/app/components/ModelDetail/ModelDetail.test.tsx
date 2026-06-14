// @vitest-environment happy-dom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

/** The clickable header name (a div whose only text is the dataset label). */
function headerName(): HTMLElement {
  return screen
    .getAllByText("stg_customers")
    .find((el) => el.className.includes("detName"))!;
}

async function installScoped(primary: PartialCatalogSource): Promise<void> {
  await installCatalogForTest(primary, fallbackWithAudit());
  await act(async () => {
    await selectProject("proj-1");
  });
}

describe("ModelDetail AuditPanel — transform toggle control", () => {
  it("renders a toggle for transform-type entries and none for log-only entries", async () => {
    await installScoped({});

    render(<ModelDetail node={d1Node()} onOpen={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText("Trimmed whitespace on email")).toBeTruthy(),
    );

    // Exactly one toggle — the transform-type entry has one, the log-only does not.
    const toggles = screen.getAllByRole("switch");
    expect(toggles).toHaveLength(1);
    expect((toggles[0] as HTMLInputElement).checked).toBe(true);
  });

  it("calls toggleAudit with the negated enabled state on click", async () => {
    await installScoped({});
    const spy = vi.spyOn(catalog, "toggleAudit").mockResolvedValue();

    render(<ModelDetail node={d1Node()} onOpen={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText("Trimmed whitespace on email")).toBeTruthy(),
    );

    await act(async () => {
      screen.getByRole("switch").click();
    });

    expect(spy).toHaveBeenCalledWith("d1", "ae-tx", false);
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

    render(<ModelDetail node={d1Node()} onOpen={vi.fn()} />);
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

describe("ModelDetail subheader — read-only dbt machine name", () => {
  /** The subheader element (the non-`detName` text node under the header). */
  function subheader(): HTMLElement {
    return screen
      .getAllByText("stg_customers")
      .find((el) => el.className.includes("detFriendly"))!;
  }

  it("renders the dataset's modelName as the read-only stg_ subheader", async () => {
    await installScoped({});

    render(<ModelDetail node={d1Node()} onOpen={vi.fn()} />);
    await waitFor(() => expect(subheader()).toBeTruthy());

    expect(subheader().textContent).toBe("stg_customers");
  });

  it("does not wire renameSource for the subheader (it is read-only, not editable)", async () => {
    await installScoped({});
    const spy = vi.spyOn(catalog, "renameSource").mockResolvedValue();

    render(<ModelDetail node={d1Node()} onOpen={vi.fn()} />);
    await waitFor(() => expect(subheader()).toBeTruthy());

    const sub = subheader();
    // The subheader is a plain element, never an <input> — it carries no edit
    // affordance (contrast the DetName header tests above).
    expect(sub.tagName).not.toBe("INPUT");
    expect(sub.querySelector("input")).toBeNull();

    // Clicking it never opens an editor or calls renameSource.
    await act(async () => {
      sub.click();
    });
    expect(screen.queryByLabelText("Edit dataset name")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("ModelDetail header — inline dataset rename", () => {
  it("commits the edited name via renameSource and updates the label optimistically", async () => {
    await installScoped({});
    const spy = vi.spyOn(catalog, "renameSource").mockResolvedValue();

    render(<ModelDetail node={d1Node()} onOpen={vi.fn()} />);
    await waitFor(() => expect(headerName()).toBeTruthy());

    await act(async () => {
      headerName().click();
    });
    const input = screen.getByLabelText(
      "Edit dataset name",
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Customers" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(spy).toHaveBeenCalledWith("d1", "Customers");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape without calling renameSource", async () => {
    await installScoped({});
    const spy = vi.spyOn(catalog, "renameSource").mockResolvedValue();

    render(<ModelDetail node={d1Node()} onOpen={vi.fn()} />);
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

    expect(spy).not.toHaveBeenCalled();
    expect(headerName()).toBeTruthy();
  });

  it("does not write an empty or unchanged name", async () => {
    await installScoped({});
    const spy = vi.spyOn(catalog, "renameSource").mockResolvedValue();

    render(<ModelDetail node={d1Node()} onOpen={vi.fn()} />);
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

    expect(spy).not.toHaveBeenCalled();
  });
});
