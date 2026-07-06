/* The open-node domain bridge — the one place two domains cross-wire when a
   lineage node is opened from the canvas or the assistant. */
import { useCallback } from "react";

import type { LineageNode } from "../../catalog";

/** The upload-domain seam: opening a source's upload window. */
interface UploadPort {
  openUpload: (node: LineageNode) => void;
}

/** The navigation-domain seam: routing to a model's detail view. */
interface OpenNodePort {
  openNode: (node: LineageNode) => void;
}

/**
 * Resolve a node-open to the domain that owns it: a source-layer node has no
 * model detail route, so it opens its upload window; every other layer routes
 * to its model detail view. Naming this bridge keeps the two-domain wiring
 * explicit and testable rather than an inline closure in the chrome.
 */
export function useOpenNode(
  upload: UploadPort,
  intents: OpenNodePort,
): (node: LineageNode) => void {
  return useCallback(
    (node: LineageNode) => {
      if (node.layer === "source") upload.openUpload(node);
      else intents.openNode(node);
    },
    [upload, intents],
  );
}
