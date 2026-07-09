/* Overlay layer: assistant dock + the data-workspace modals. The dock's open
   state comes from useChat() (the transient assistant-dock context); the chat
   context node is the resolved deep-linked model (off the pathname), and nav
   requests go through useNavIntents(). */
import { useLocation, useParams } from "react-router";

import { useChat } from "../../../app/lib/chatContext";
import type { DataCatalog, Edge, LineageNode } from "../../catalog";
import { ChatOverlay } from "../Chat";
import chat from "../Chat/Chat.module.css";
import type { ColdStorageApi } from "../ColdStorage";
import { ColdStorageModal } from "../ColdStorage";
import type { ExportApi } from "../Export";
import { ExportDrawer } from "../Export";
import { Icon } from "../primitives";
import type { UploadApi } from "../Upload";
import { ConfirmArchive, UploadModal } from "../Upload";
import { catalog, useCatalogFromContext } from "../useCatalog";

/**
 * The resolved deep-linked model for the chat context, or null off a model route.
 *
 * Keys off the project-scoped route params (`dataset/:datasetId`,
 * `view/:viewId`, `report/:reportId` under `/project/:projectId`), which RRv7
 * surfaces here from the descendant match — NOT off the path shape, which moved
 * under `/project/...` and no longer has top-level `/table|/view|/report` prefixes.
 */
export function chatContextNode(
  params: Record<string, string | undefined>,
  source: DataCatalog = catalog,
): LineageNode | null {
  const id = params.datasetId ?? params.viewId ?? params.reportId;
  if (!id) return null;
  return source.getNode(id) ?? null;
}

export function Overlays({
  upload,
  exporter,
  cold,
  createModel,
  onOpenNode,
}: {
  upload: UploadApi;
  exporter: ExportApi;
  cold: ColdStorageApi;
  createModel: (node: LineageNode, edge: Edge) => void;
  onOpenNode: (node: LineageNode) => void;
}) {
  const { chatOpen, openChat, closeChat } = useChat();
  const location = useLocation();
  const params = useParams();
  const catalog = useCatalogFromContext();
  const onOrg = location.pathname === "/org";
  const chatContext = chatContextNode(params, catalog);
  return (
    <>
      {!chatOpen && !onOrg && (
        <button
          className={chat.launcher}
          onClick={openChat}
          aria-label="Assistant"
        >
          <Icon name="sparkle" size={23} />
        </button>
      )}
      {chatOpen && <div className={chat.scrim} onClick={closeChat} />}
      {chatOpen && (
        <ChatOverlay
          context={chatContext}
          onCreate={createModel}
          onClose={closeChat}
          onOpenNode={onOpenNode}
        />
      )}
      {exporter.open && <ExportDrawer onClose={exporter.closeExport} />}
      {upload.modal.open && (
        <UploadModal
          key={upload.modal.source ? upload.modal.source.id : "new-upload"}
          source={upload.modal.source}
          onClose={upload.closeUpload}
          onCreateSource={upload.createSource}
          onRename={upload.renameSource}
          onArchive={upload.requestArchive}
          mismatch={upload.mismatch}
          onRetry={upload.clearMismatch}
        />
      )}
      {upload.confirmArchive && (
        <ConfirmArchive
          source={upload.confirmArchive}
          onCancel={upload.cancelArchive}
          onConfirm={upload.archiveSource}
        />
      )}
      {cold.open && (
        <ColdStorageModal
          items={catalog.listColdStorage()}
          onRestore={cold.restore}
          onClose={cold.closeCold}
        />
      )}
    </>
  );
}
