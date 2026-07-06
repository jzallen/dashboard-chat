// @vitest-environment happy-dom
import type {
  ChatAppStateDocument,
  SourceUploadPhase,
} from "@dashboard-chat/ui-state-wire";
import { anonymousStateDocument } from "@dashboard-chat/ui-state-wire";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { StateProxy } from "../../lib/state-proxy";
import { StateProxyProvider } from "../../lib/StateProxyProvider";
import { useInFlightSourceNode } from "./useInFlightSourceNode";

function proxyWith(
  phase: SourceUploadPhase,
  region: Partial<ChatAppStateDocument["regions"]["sourceUpload"]>,
): StateProxy {
  const doc: ChatAppStateDocument = anonymousStateDocument();
  doc.regions.sourceUpload = {
    phase,
    temp_node_id: null,
    source_id: null,
    dataset_id: null,
    error: null,
    ...region,
  };
  return {
    id: "test",
    sessionId: "test",
    getSnapshot: () => doc,
    subscribe: () => ({ unsubscribe: vi.fn() }),
    send: vi.fn(),
    postEvent: vi.fn(async () => doc),
  } as unknown as StateProxy;
}

function render(proxy: StateProxy) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StateProxyProvider proxy={proxy}>{children}</StateProxyProvider>
  );
  return renderHook(() => useInFlightSourceNode(), { wrapper });
}

describe("useInFlightSourceNode", () => {
  it("targets the optimistic temp node while creating, with its phase label", () => {
    const { result } = render(
      proxyWith("uploading", { temp_node_id: "tmp.1" }),
    );
    expect(result.current).toEqual({
      inFlightNodeId: "tmp.1",
      inFlightLabel: "Uploading…",
    });
  });

  it("prefers the real source id once created", () => {
    const { result } = render(
      proxyWith("processing", { temp_node_id: "tmp.1", source_id: "src.9" }),
    );
    expect(result.current).toEqual({
      inFlightNodeId: "src.9",
      inFlightLabel: "Processing…",
    });
  });

  it("has no in-flight node at idle", () => {
    const { result } = render(proxyWith("idle", {}));
    expect(result.current.inFlightNodeId).toBeNull();
    expect(result.current.inFlightLabel).toBeNull();
  });

  it("has no in-flight node once linked (saga settled)", () => {
    const { result } = render(
      proxyWith("linked", { temp_node_id: "tmp.1", source_id: "src.9" }),
    );
    expect(result.current.inFlightNodeId).toBeNull();
  });
});
