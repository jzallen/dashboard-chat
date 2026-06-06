// @vitest-environment happy-dom
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fixtureFallback } from "../../../app/routes/_fixtureCatalog";
import type { AuditEntry, LineageNode, PartialCatalogSource } from "../../lib/catalog";
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
    await installCatalogForTest({}, { ...base, getAudit: () => Promise.resolve(audit) });
    await act(async () => {
      await selectProject("proj-1");
    });

    render(<ModelDetail node={d1Node()} onOpen={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText("Trimmed whitespace on email")).toBeTruthy(),
    );

    // The entry stays in the trail but is marked disabled and the toggle is off.
    expect(screen.getByText("disabled")).toBeTruthy();
    expect((screen.getByRole("switch") as HTMLInputElement).checked).toBe(false);
  });
});
