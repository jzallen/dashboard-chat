import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDataCatalog } from "../client";

describe("exportDbtProject", () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  const mockCreateObjectURL = vi.fn().mockReturnValue("blob:mock-url");
  const mockRevokeObjectURL = vi.fn();

  const mockClick = vi.fn();
  let mockAnchor: { href: string; download: string; click: typeof mockClick };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;

    mockAnchor = { href: "", download: "", click: mockClick };
    vi.spyOn(document, "createElement").mockReturnValue(
      mockAnchor as unknown as HTMLElement,
    );
    vi.spyOn(document.body, "appendChild").mockImplementation(
      () => mockAnchor as unknown as HTMLElement,
    );
    vi.spyOn(document.body, "removeChild").mockImplementation(
      () => mockAnchor as unknown as HTMLElement,
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("downloads file with filename from Content-Disposition header", async () => {
    const mockBlob = new Blob(["zip-content"], { type: "application/zip" });
    mockFetch.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
      headers: new Headers({
        "Content-Disposition": 'attachment; filename="my_project.zip"',
      }),
    });

    const catalog = createDataCatalog(mockFetch);
    await catalog.exportDbtProject("proj-123");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/projects/proj-123/export/dbt"),
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(mockCreateObjectURL).toHaveBeenCalledWith(mockBlob);
    expect(mockAnchor.href).toBe("blob:mock-url");
    expect(mockAnchor.download).toBe("my_project.zip");
    expect(mockClick).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("falls back to 'export.zip' when no Content-Disposition header", async () => {
    const mockBlob = new Blob(["zip-content"], { type: "application/zip" });
    mockFetch.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
      headers: new Headers(),
    });

    const catalog = createDataCatalog(mockFetch);
    await catalog.exportDbtProject("proj-456");

    expect(mockAnchor.download).toBe("export.zip");
    expect(mockClick).toHaveBeenCalled();
  });

  it("throws an error when the response is not ok", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not Found"),
    });

    const catalog = createDataCatalog(mockFetch);
    await expect(catalog.exportDbtProject("proj-789")).rejects.toThrow(
      "Export failed: 404 Not Found",
    );
    expect(mockCreateObjectURL).not.toHaveBeenCalled();
  });
});
