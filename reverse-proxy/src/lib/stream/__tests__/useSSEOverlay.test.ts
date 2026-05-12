import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useSSEOverlay } from "../useSSEOverlay";

describe("useSSEOverlay", () => {
  it("starts with isStreaming false and empty content", () => {
    const { result } = renderHook(() => useSSEOverlay());

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingContent).toBe("");
  });

  it("startStreaming sets isStreaming to true", () => {
    const { result } = renderHook(() => useSSEOverlay());

    act(() => {
      result.current.startStreaming();
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.streamingContent).toBe("");
  });

  it("updateContent updates streaming content", () => {
    const { result } = renderHook(() => useSSEOverlay());

    act(() => {
      result.current.startStreaming();
    });

    act(() => {
      result.current.updateContent("Hello world");
    });

    expect(result.current.streamingContent).toBe("Hello world");
  });

  it("stopStreaming clears state", () => {
    const { result } = renderHook(() => useSSEOverlay());

    act(() => {
      result.current.startStreaming();
      result.current.updateContent("Some content");
    });

    act(() => {
      result.current.stopStreaming();
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingContent).toBe("");
  });
});
