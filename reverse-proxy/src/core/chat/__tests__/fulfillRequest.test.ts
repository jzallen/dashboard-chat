import { describe, expect, it, vi } from "vitest";

import { fulfillAgentRequest } from "../services/fulfillRequest";

function mockFetch(data: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

describe("fulfillAgentRequest", () => {
  describe("resolve_dataset", () => {
    it("returns exact match dataset", async () => {
      const fetchFn = mockFetch({ data: [
        { id: "ds-1", name: "patients" },
        { id: "ds-2", name: "orders" },
      ] });

      const result = await fulfillAgentRequest(
        { type: "resolve_dataset", params: { name: "patients" } },
        "proj-1",
        fetchFn,
      );

      expect(result.success).toBe(true);
      expect(result.dataset).toEqual({ id: "ds-1", name: "patients" });
    });

    it("matches case-insensitively", async () => {
      const fetchFn = mockFetch({ data: [
        { id: "ds-1", name: "Patients" },
      ] });

      const result = await fulfillAgentRequest(
        { type: "resolve_dataset", params: { name: "patients" } },
        "proj-1",
        fetchFn,
      );

      expect(result.success).toBe(true);
      expect(result.dataset?.id).toBe("ds-1");
    });

    it("returns single partial match", async () => {
      const fetchFn = mockFetch({ data: [
        { id: "ds-1", name: "patient_records" },
      ] });

      const result = await fulfillAgentRequest(
        { type: "resolve_dataset", params: { name: "patient" } },
        "proj-1",
        fetchFn,
      );

      expect(result.success).toBe(true);
      expect(result.dataset?.id).toBe("ds-1");
    });

    it("returns error for multiple matches", async () => {
      const fetchFn = mockFetch({ data: [
        { id: "ds-1", name: "patient_records" },
        { id: "ds-2", name: "patient_visits" },
      ] });

      const result = await fulfillAgentRequest(
        { type: "resolve_dataset", params: { name: "patient" } },
        "proj-1",
        fetchFn,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Multiple datasets match");
      expect(result.error).toContain("patient_records");
      expect(result.error).toContain("patient_visits");
    });

    it("returns error for no match", async () => {
      const fetchFn = mockFetch({ data: [] });

      const result = await fulfillAgentRequest(
        { type: "resolve_dataset", params: { name: "patients" } },
        "proj-1",
        fetchFn,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("No dataset found");
    });

    it("returns error when no project selected", async () => {
      const fetchFn = mockFetch({ data: [] });

      const result = await fulfillAgentRequest(
        { type: "resolve_dataset", params: { name: "patients" } },
        null,
        fetchFn,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("No project selected");
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("returns error when name parameter is missing", async () => {
      const fetchFn = mockFetch({ data: [] });

      const result = await fulfillAgentRequest(
        { type: "resolve_dataset", params: {} },
        "proj-1",
        fetchFn,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("requires a name parameter");
    });

    it("handles HTTP errors", async () => {
      const fetchFn = mockFetch(null, 500);

      const result = await fulfillAgentRequest(
        { type: "resolve_dataset", params: { name: "patients" } },
        "proj-1",
        fetchFn,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("HTTP 500");
    });

    it("handles network errors", async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error("Network failure"));

      const result = await fulfillAgentRequest(
        { type: "resolve_dataset", params: { name: "patients" } },
        "proj-1",
        fetchFn,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network failure");
    });

    it("handles timeout via AbortError", async () => {
      const abortError = new DOMException("The operation was aborted.", "AbortError");
      const fetchFn = vi.fn().mockRejectedValue(abortError);

      const result = await fulfillAgentRequest(
        { type: "resolve_dataset", params: { name: "patients" } },
        "proj-1",
        fetchFn,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
    });
  });

  describe("unknown request type", () => {
    it("returns error for unknown type", async () => {
      const result = await fulfillAgentRequest(
        { type: "unknown_type", params: {} },
        "proj-1",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown request type");
    });
  });
});
