// @vitest-environment happy-dom
import type {
  ChatAppStateDocument,
  SourceUploadPhase,
} from "@dashboard-chat/ui-state-wire";
import { anonymousStateDocument } from "@dashboard-chat/ui-state-wire";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CatalogSource } from "../../catalog";
import type { StateProxy } from "../../lib/state-proxy";
import { StateProxyProvider } from "../../lib/StateProxyProvider";
import { catalog, installCatalogForTest, selectProject } from "../useCatalog";
import { DagView } from "./dagView";
import { OpenNodeProvider } from "./openNodeContext";

afterEach(() => vi.restoreAllMocks());

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A fallback catalog carrying a single optimistic source node, id `tmp.1`. */
function catalogWithOptimisticNode(): CatalogSource {
  const empty = [] as unknown;
  return {
    getProjects: () => Promise.resolve(empty as never),
    getCurrentProject: () =>
      Promise.resolve({ id: "p1", name: "P1", description: "" }),
    getOrg: () => Promise.resolve({} as never),
    getRecents: () => Promise.resolve(empty as never),
    getAllChats: () => Promise.resolve(empty as never),
    getNodes: () =>
      Promise.resolve({
        "tmp.1": {
          id: "tmp.1",
          label: "orders_csv",
          sub: "source",
          layer: "source",
          schema: [],
          files: [],
        },
      }),
    getEdges: () => Promise.resolve([]),
    getAudit: () => Promise.resolve({}),
    getChatScript: () => Promise.resolve({} as never),
    getDbtFiles: () => Promise.resolve(empty as never),
  };
}

/** A StateProxy whose snapshot pins the sourceUpload region at `phase`. */
function proxyWithPhase(
  phase: SourceUploadPhase,
  tempNodeId: string,
): StateProxy {
  const doc: ChatAppStateDocument = anonymousStateDocument();
  doc.regions.sourceUpload = {
    phase,
    temp_node_id: tempNodeId,
    source_id: null,
    dataset_id: null,
    error: null,
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

function wrapper(proxy: StateProxy) {
  return ({ children }: { children: ReactNode }) => (
    <StateProxyProvider proxy={proxy}>
      <OpenNodeProvider onOpen={vi.fn()}>{children}</OpenNodeProvider>
    </StateProxyProvider>
  );
}

describe("DagView — optimistic source-upload phase badge", () => {
  it("renders the in-flight phase label on the optimistic node", async () => {
    await installCatalogForTest({}, catalogWithOptimisticNode());
    await selectProject("p1");
    await flush();

    const proxy = proxyWithPhase("uploading", "tmp.1");
    render(
      <DagView catalog={catalog} version={1} sel={null} flashedNodeId={null} />,
      { wrapper: wrapper(proxy) },
    );

    expect(screen.getByText("Uploading…")).toBeTruthy();
  });

  it("renders no phase badge at idle", async () => {
    await installCatalogForTest({}, catalogWithOptimisticNode());
    await selectProject("p1");
    await flush();

    const proxy = proxyWithPhase("idle", null as unknown as string);
    render(
      <DagView catalog={catalog} version={1} sel={null} flashedNodeId={null} />,
      { wrapper: wrapper(proxy) },
    );

    expect(screen.queryByText("Uploading…")).toBeNull();
    expect(screen.queryByText("Processing…")).toBeNull();
  });
});
