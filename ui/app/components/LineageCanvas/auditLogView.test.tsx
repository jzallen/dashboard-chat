// @vitest-environment happy-dom
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fixtureFallback } from "../../../app/routes/_fixtureCatalog";
import type { AuditEntry } from "../../catalog";
import { catalog, installCatalogForTest, selectProject } from "../useCatalog";
import { AuditLogView } from "./auditLogView";
import { OpenNodeProvider } from "./openNodeContext";

afterEach(() => vi.restoreAllMocks());

/** Install a scoped catalog whose d1 staging node carries one disabled
 *  transform entry, so the audit log renders the disabled treatment. */
async function installWithDisabledEntry(): Promise<void> {
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
}

describe("AuditLogView — disabled transform treatment", () => {
  it("shows a disabled entry in the trail with a 'disabled' chip", async () => {
    await installWithDisabledEntry();

    render(
      <OpenNodeProvider onOpen={vi.fn()}>
        <AuditLogView catalog={catalog} sel={null} flashedNodeId={null} />
      </OpenNodeProvider>,
    );

    // The entry stays visible in the audit trail...
    await waitFor(() =>
      expect(screen.getByText("Trimmed whitespace on email")).toBeTruthy(),
    );
    // ...but is marked as disabled.
    expect(screen.getByText("disabled")).toBeTruthy();
  });
});
