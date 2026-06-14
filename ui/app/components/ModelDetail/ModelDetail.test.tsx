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

describe("ModelDetail subheader — editable dbt machine name (Slice C)", () => {
  /** The subheader element (the `detFriendly` text node under the header). */
  function subheader(): HTMLElement {
    return screen
      .getAllByText("stg_customers")
      .find((el) => el.className.includes("detFriendly"))!;
  }

  it("renders the dataset's modelName as the subheader", async () => {
    await installScoped({});

    render(<ModelDetail node={d1Node()} onOpen={vi.fn()} />);
    await waitFor(() => expect(subheader()).toBeTruthy());

    expect(subheader().textContent).toBe("stg_customers");
  });

  it("opens a draft editor on click, then a blocking confirm dialog on commit", async () => {
    await installScoped({});

    render(<ModelDetail node={d1Node()} onOpen={vi.fn()} />);
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
  });

  it("calls setModelName only after confirming the dialog", async () => {
    await installScoped({});
    const spy = vi.spyOn(catalog, "setModelName").mockResolvedValue();

    render(<ModelDetail node={d1Node()} onOpen={vi.fn()} />);
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

    // Not written before confirmation.
    expect(spy).not.toHaveBeenCalled();

    await act(async () => {
      screen.getByRole("button", { name: /change machine name/i }).click();
    });

    expect(spy).toHaveBeenCalledWith("d1", "warm_leads");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("cancelling the dialog reverts the draft and writes nothing", async () => {
    await installScoped({});
    const spy = vi.spyOn(catalog, "setModelName").mockResolvedValue();

    render(<ModelDetail node={d1Node()} onOpen={vi.fn()} />);
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

    expect(spy).not.toHaveBeenCalled();
    // Draft reverted: the original machine name is shown, no dialog remains.
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(subheader().textContent).toBe("stg_customers"));
  });

  it("Escape in the editor reverts the draft without opening the dialog", async () => {
    await installScoped({});
    const spy = vi.spyOn(catalog, "setModelName").mockResolvedValue();

    render(<ModelDetail node={d1Node()} onOpen={vi.fn()} />);
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
    expect(spy).not.toHaveBeenCalled();
    await waitFor(() => expect(subheader().textContent).toBe("stg_customers"));
  });

  it("never calls renameSource (display name) from the machine-name editor", async () => {
    await installScoped({});
    const renameSpy = vi.spyOn(catalog, "renameSource").mockResolvedValue();
    vi.spyOn(catalog, "setModelName").mockResolvedValue();

    render(<ModelDetail node={d1Node()} onOpen={vi.fn()} />);
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

    // Decoupling contract: the subline edits the machine name only.
    expect(renameSpy).not.toHaveBeenCalled();
  });

  it("does not open the dialog for an empty or unchanged draft", async () => {
    await installScoped({});
    const spy = vi.spyOn(catalog, "setModelName").mockResolvedValue();

    render(<ModelDetail node={d1Node()} onOpen={vi.fn()} />);
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
