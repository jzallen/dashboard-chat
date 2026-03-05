import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

import { exportDbtProject } from "../projects";

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
    vi.spyOn(document, "createElement").mockReturnValue(mockAnchor as unknown as HTMLElement);
    vi.spyOn(document.body, "appendChild").mockImplementation(() => mockAnchor as unknown as HTMLElement);
    vi.spyOn(document.body, "removeChild").mockImplementation(() => mockAnchor as unknown as HTMLElement);
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue("test-token");
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

    await exportDbtProject("proj-123");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/projects/proj-123/export/dbt"),
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer test-token" },
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

    await exportDbtProject("proj-456");

    expect(mockAnchor.download).toBe("export.zip");
    expect(mockClick).toHaveBeenCalled();
  });

  it("throws an error when the response is not ok", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not Found"),
    });

    await expect(exportDbtProject("proj-789")).rejects.toThrow(
      "Export failed: 404 Not Found",
    );
    expect(mockCreateObjectURL).not.toHaveBeenCalled();
  });

  it("retries with refreshed token on 401", async () => {
    // First call returns 401
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
      })
      // Refresh token call
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "new-token",
            refresh_token: "new-refresh",
            expires_in: 3600,
          }),
      })
      // Retry with new token succeeds
      .mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob(["zip-content"], { type: "application/zip" })),
        headers: new Headers({
          "Content-Disposition": 'attachment; filename="project.zip"',
        }),
      });

    // Override getItem to provide both token and refresh token
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((key: string) => {
      if (key === "auth_token") return "expired-token";
      if (key === "auth_refresh_token") return "valid-refresh-token";
      return null;
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});

    await exportDbtProject("proj-401");

    // Should have made 3 fetch calls: initial + refresh + retry
    expect(mockFetch).toHaveBeenCalledTimes(3);
    // The retry call should use the new token
    expect(mockFetch).toHaveBeenLastCalledWith(
      expect.stringContaining("/api/projects/proj-401/export/dbt"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer new-token",
        }),
      }),
    );
  });
});
