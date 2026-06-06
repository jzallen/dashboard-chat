/* Overlay layer: assistant dock + the data-workspace modals. The dock's open
   state comes from useChat() (the transient context the old useNavigation held);
   the chat context node is the resolved deep-linked model (off the pathname),
   and nav requests go through useNavIntents(). */
import { useLocation, useParams } from "react-router";

import { useChat } from "../../../app/lib/chatContext";
import { useNavIntents } from "../../../app/lib/nav";
import type { Edge, LineageNode } from "../../catalog";
import { AssistantOverlay, TerminalAssistant } from "../Chat";
import chat from "../Chat/Chat.module.css";
import type { ColdStorageApi } from "../ColdStorage";
import { ColdStorageModal } from "../ColdStorage";
import type { ExportApi } from "../Export";
import { ExportDrawer } from "../Export";
import { Icon } from "../primitives";
import type { UploadApi } from "../Upload";
import { ConfirmArchive, UploadModal } from "../Upload";
import { catalog } from "../useCatalog";
import { useTheme } from "./ThemeProvider";

/** The resolved deep-linked model for the chat context, or null off a resource route. */
function chatContextNode(
  pathname: string,
  params: Record<string, string | undefined>,
): LineageNode | null {
  let id: string | undefined;
  if (pathname.startsWith("/table/")) id = params.datasetId;
  else if (pathname.startsWith("/view/")) id = params.viewId;
  else if (pathname.startsWith("/report/")) id = params.reportId;
  if (!id) return null;
  return catalog.getNode(id) ?? null;
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
  const { dark } = useTheme();
  const { chatOpen, openChat, closeChat } = useChat();
  const intents = useNavIntents();
  const location = useLocation();
  const params = useParams();
  const onOrg = location.pathname === "/org";
  const chatContext = chatContextNode(location.pathname, params);
  return (
    <>
      {!chatOpen && !onOrg && (
        <button
          className={chat.assistantFab}
          onClick={openChat}
          aria-label="Assistant"
        >
          <Icon name="sparkle" size={23} />
        </button>
      )}
      {chatOpen && <div className={chat.aoScrim} onClick={closeChat} />}
      {chatOpen &&
        (dark ? (
          <TerminalAssistant
            context={chatContext}
            onCreate={createModel}
            onClose={closeChat}
            onOpenNode={onOpenNode}
            go={intents.go}
          />
        ) : (
          <AssistantOverlay
            context={chatContext}
            onCreate={createModel}
            onClose={closeChat}
            onOpenNode={onOpenNode}
            go={intents.go}
          />
        ))}
      {exporter.open && <ExportDrawer onClose={exporter.closeExport} />}
      {upload.modal.open && (
        <UploadModal
          key={upload.modal.source ? upload.modal.source.id : "new-upload"}
          source={upload.modal.source}
          onClose={upload.closeUpload}
          onCreateSource={upload.createSource}
          onRename={upload.renameSource}
          onArchive={upload.requestArchive}
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
