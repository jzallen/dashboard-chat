/* Overlay layer: assistant dock + the data-workspace modals. */
import type { Edge, LineageNode } from "../../lib/catalog";
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
import type { NavApi } from "./useNavigation";

export function Overlays({
  nav,
  upload,
  exporter,
  cold,
  createModel,
}: {
  nav: NavApi;
  upload: UploadApi;
  exporter: ExportApi;
  cold: ColdStorageApi;
  createModel: (node: LineageNode, edge: Edge) => void;
}) {
  const { route } = nav;
  const { dark } = useTheme();
  const chatContext = route.name === "model" ? (route.node ?? null) : null;
  return (
    <>
      {!nav.chatOpen && route.name !== "org" && (
        <button
          className={chat.assistantFab}
          onClick={nav.openChat}
          aria-label="Assistant"
        >
          <Icon name="sparkle" size={23} />
        </button>
      )}
      {nav.chatOpen && <div className={chat.aoScrim} onClick={nav.closeChat} />}
      {nav.chatOpen &&
        (dark ? (
          <TerminalAssistant
            context={chatContext}
            onCreate={createModel}
            onClose={nav.closeChat}
            onOpenNode={nav.openModel}
            go={nav.go}
          />
        ) : (
          <AssistantOverlay
            context={chatContext}
            onCreate={createModel}
            onClose={nav.closeChat}
            onOpenNode={nav.openModel}
            go={nav.go}
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
