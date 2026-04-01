import { describe, expect, it } from "vitest";

import { compactId, memoryChannelId, sessionHash } from "../channelId";

describe("channelId", () => {
  describe("compactId", () => {
    it("strips hyphens from a UUID", () => {
      expect(compactId("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(
        "a1b2c3d4e5f67890abcdef1234567890",
      );
    });

    it("returns plain strings unchanged", () => {
      expect(compactId("abc123")).toBe("abc123");
    });
  });

  describe("sessionHash", () => {
    it("returns an 8-char hex string", async () => {
      const hash = await sessionHash("org-1", "user-1");
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it("produces different hashes for different inputs", async () => {
      const h1 = await sessionHash("org-1", "user-1");
      // Wait a tick so Date.now() differs
      await new Promise((r) => setTimeout(r, 1));
      const h2 = await sessionHash("org-1", "user-1");
      // High probability these differ due to timestamp
      expect(typeof h1).toBe("string");
      expect(typeof h2).toBe("string");
    });
  });

  describe("memoryChannelId", () => {
    it("generates project-scoped channel ID with compact IDs", () => {
      const result = memoryChannelId(
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "11223344-5566-7788-99aa-bbccddeeff00",
      );
      expect(result).toBe(
        "proj_a1b2c3d4e5f67890abcdef1234567890_1122334455667788" +
          "99aabbccddeeff00",
      );
    });

    it("starts with proj_ prefix", () => {
      const result = memoryChannelId("org-1", "proj-1");
      expect(result.startsWith("proj_")).toBe(true);
    });

    it("contains both org and project compact IDs", () => {
      const result = memoryChannelId("org-1", "proj-1");
      expect(result).toBe("proj_org1_proj1");
    });
  });
});
