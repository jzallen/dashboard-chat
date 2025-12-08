import { describe, it, expect, vi } from "vitest";
import { handleFetch, ChatHandlerFactory } from "../../index";

// Feature: Cloudflare Worker Backend API
// As a frontend application
// I want to communicate with a Cloudflare Worker backend
// So that chat messages are processed by the AI and streamed back

const mockEnv = { GROQ_API_KEY: "test-key" };

describe("Feature: Cloudflare Worker Backend API", () => {
  describe("Scenario: Backend handles CORS", () => {
    it("should handle preflight OPTIONS requests", async () => {
      const request = new Request("http://localhost/chat", {
        method: "OPTIONS",
      });

      const response = await handleFetch(request, mockEnv);

      expect({
        status: response.status,
        headers: Object.fromEntries(response.headers),
      }).toEqual({
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    });
  });

  describe("Scenario: Health check endpoint", () => {
    it("should return success response for GET /health", async () => {
      const request = new Request("http://localhost/health", {
        method: "GET",
      });

      const response = await handleFetch(request, mockEnv);

      expect(response.status).toBe(200);
    });

    it("should indicate the service is running", async () => {
      const request = new Request("http://localhost/health", {
        method: "GET",
      });

      const response = await handleFetch(request, mockEnv);
      const body = await response.json();

      expect(body).toEqual({ status: "ok" });
    });
  });

  describe("Scenario: Unknown routes", () => {
    it("should return 404 for unknown paths", async () => {
      const request = new Request("http://localhost/unknown", {
        method: "GET",
      });

      const response = await handleFetch(request, mockEnv);

      expect(response.status).toBe(404);
    });
  });

  describe("Scenario: Chat endpoint routing", () => {
    it("should route POST /chat to chat handler factory", async () => {
      const mockHandler = vi.fn().mockResolvedValue(
        new Response("mock response", { status: 200 })
      );
      const mockFactory: ChatHandlerFactory = vi.fn().mockReturnValue(mockHandler);

      const request = new Request("http://localhost/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [] }),
      });

      const response = await handleFetch(request, mockEnv, {
        chatHandlerFactory: mockFactory,
      });

      expect(mockFactory).toHaveBeenCalledWith(mockEnv);
      expect(mockHandler).toHaveBeenCalledWith(request);
      expect(response.status).toBe(200);
    });

    it("should not route GET /chat to chat handler", async () => {
      const mockFactory: ChatHandlerFactory = vi.fn();

      const request = new Request("http://localhost/chat", {
        method: "GET",
      });

      const response = await handleFetch(request, mockEnv, {
        chatHandlerFactory: mockFactory,
      });

      expect(mockFactory).not.toHaveBeenCalled();
      expect(response.status).toBe(404);
    });
  });
});
