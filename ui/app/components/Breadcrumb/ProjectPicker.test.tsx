// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrgSettings, ProjectSummary } from "../../catalog";
import { NO_PRIMARY } from "../../routes/_fixtureCatalog";
import { catalog, installCatalogForTest, seedOrgGlobal } from "../useCatalog";
import { ProjectPicker } from "./ProjectPicker";

afterEach(() => vi.restoreAllMocks());

const org: OrgSettings = { name: "Acme" } as OrgSettings;

function projectsWith(name: string): ProjectSummary[] {
  return [{ id: "p1", name, desc: "", datasets: 0, models: 0 }];
}

async function installProjects(name: string): Promise<void> {
  await installCatalogForTest(NO_PRIMARY, {
    getProjects: () => Promise.resolve(projectsWith(name)),
    getCurrentProject: () =>
      Promise.resolve({ id: "p1", name, description: "" }),
    getOrg: () => Promise.resolve(org),
    getRecents: () => Promise.resolve([]),
    getAllChats: () => Promise.resolve([]),
    getNodes: () => Promise.resolve({}),
    getEdges: () => Promise.resolve([]),
    getAudit: () => Promise.resolve({}),
    getChatScript: () => Promise.resolve({} as never),
    getDbtFiles: () => Promise.resolve([]),
  });
}

describe("ProjectPicker — catalog subscription", () => {
  beforeEach(async () => {
    await installProjects("Original Project");
  });

  it("reflects a catalog project mutation without an external re-render", async () => {
    render(<ProjectPicker projectId="p1" onSelect={vi.fn()} />);

    // The current project name renders on the trigger button.
    expect(screen.getByText("Original Project")).toBeTruthy();

    // A catalog mutation (a project rename landing from the backend) must be
    // reflected because the picker subscribes to the catalog itself — nothing
    // else re-renders it.
    act(() => {
      seedOrgGlobal(projectsWith("Renamed Project"), catalog.getOrg());
    });

    expect(screen.getByText("Renamed Project")).toBeTruthy();

    // And the mutated name is present in the open dropdown list too.
    fireEvent.click(screen.getByText("Renamed Project"));
    expect(screen.getByPlaceholderText("Search projects…")).toBeTruthy();
  });
});
