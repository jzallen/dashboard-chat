/* Overlay layer: assistant dock + the data-workspace modals. */
import { AssistantOverlay, TerminalAssistant } from "../Chat";
import { ColdStorageModal } from "../ColdStorage";
import { ExportDrawer } from "../Export";
import { catalog } from "../fixtureSource";
import { Icon } from "../primitives";
import { ConfirmArchive, UploadModal } from "../Upload";
import { useTheme } from "./ThemeProvider";
import type { NavApi } from "./useNavigation";
import type { SourceApi } from "./useSourceActions";

export function Overlays({
  nav,
  sources,
}: {
  nav: NavApi;
  sources: SourceApi;
}) {
  const { route } = nav;
  const { dark } = useTheme();
  const chatContext = route.name === "model" ? (route.node ?? null) : null;
  return (
    <>
      {!nav.chatOpen && route.name !== "org" && (
        <button
          className="assistant-fab"
          onClick={nav.openChat}
          aria-label="Assistant"
        >
          <Icon name="sparkle" size={23} />
        </button>
      )}
      {nav.chatOpen && <div className="ao-scrim" onClick={nav.closeChat} />}
      {nav.chatOpen &&
        (dark ? (
          <TerminalAssistant
            context={chatContext}
            onCreate={sources.createModel}
            onClose={nav.closeChat}
            onOpenNode={nav.openModel}
            go={nav.go}
          />
        ) : (
          <AssistantOverlay
            context={chatContext}
            onCreate={sources.createModel}
            onClose={nav.closeChat}
            onOpenNode={nav.openModel}
            go={nav.go}
          />
        ))}
      {sources.exportOpen && <ExportDrawer onClose={sources.closeExport} />}
      {sources.upload.open && (
        <UploadModal
          key={sources.upload.source ? sources.upload.source.id : "new-upload"}
          source={sources.upload.source}
          onClose={sources.closeUpload}
          onCreateSource={sources.createSource}
          onRename={sources.renameSource}
          onArchive={sources.requestArchive}
        />
      )}
      {sources.confirmArchive && (
        <ConfirmArchive
          source={sources.confirmArchive}
          onCancel={sources.cancelArchive}
          onConfirm={sources.archiveSource}
        />
      )}
      {sources.coldOpen && (
        <ColdStorageModal
          items={catalog.listColdStorage()}
          onRestore={sources.restoreSource}
          onClose={sources.closeCold}
        />
      )}
    </>
  );
}
