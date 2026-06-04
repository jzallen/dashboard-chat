/* Source actions: the data-workspace overlays (upload, export, cold storage,
   archive-confirm) and the catalog mutations behind them. justAdded briefly
   flags a freshly created node so the canvas can pop it. */
import { useCallback, useState } from "react";

import type { Edge, FieldDef, LineageNode } from "../../lib/catalog";
import { catalog } from "../fixtureSource";

/** The payload the upload modal emits when a brand-new source is created. */
export type NewSource = {
  name: string;
  schema: FieldDef[] | null;
  files: { name: string; rows: number; when: string }[];
};

export function useSourceActions() {
  const [upload, setUpload] = useState<{
    open: boolean;
    source: LineageNode | null;
  }>({ open: false, source: null });
  const [exportOpen, setExportOpen] = useState(false);
  const [coldOpen, setColdOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<LineageNode | null>(
    null,
  );
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const flashAdded = useCallback((id: string) => {
    setJustAdded(id);
    setTimeout(() => setJustAdded(null), 1600);
  }, []);
  const openUpload = useCallback(
    (source: LineageNode | null) => setUpload({ open: true, source }),
    [],
  );
  const closeUpload = useCallback(
    () => setUpload({ open: false, source: null }),
    [],
  );
  const openExport = useCallback(() => setExportOpen(true), []);
  const closeExport = useCallback(() => setExportOpen(false), []);
  const openCold = useCallback(() => setColdOpen(true), []);
  const closeCold = useCallback(() => setColdOpen(false), []);
  const requestArchive = useCallback(
    (src: LineageNode) => setConfirmArchive(src),
    [],
  );
  const cancelArchive = useCallback(() => setConfirmArchive(null), []);

  const createSource = useCallback(
    (src: NewSource) => {
      const id =
        "src." +
        (src.name || "source")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, "") +
        "_" +
        Math.random().toString(36).slice(2, 5);
      const node: LineageNode = {
        id,
        label: src.name,
        sub: "source",
        layer: "source",
        schema: src.schema ?? undefined,
        files: src.files,
      };
      catalog.addSource(node);
      flashAdded(id);
    },
    [flashAdded],
  );
  const createModel = useCallback(
    (node: LineageNode, edge: Edge) => {
      catalog.addModel(node, edge);
      flashAdded(node.id);
    },
    [flashAdded],
  );
  const renameSource = useCallback(
    (id: string, name: string) => catalog.renameSource(id, name),
    [],
  );
  const archiveSource = useCallback(
    (src: LineageNode) => {
      catalog.archiveSource(src);
      setConfirmArchive(null);
      closeUpload();
    },
    [closeUpload],
  );
  const restoreSource = useCallback(
    (id: string) => catalog.restoreSource(id),
    [],
  );

  return {
    upload,
    openUpload,
    closeUpload,
    exportOpen,
    openExport,
    closeExport,
    coldOpen,
    openCold,
    closeCold,
    confirmArchive,
    requestArchive,
    cancelArchive,
    archiveSource,
    createSource,
    createModel,
    renameSource,
    restoreSource,
    justAdded,
  };
}
export type SourceApi = ReturnType<typeof useSourceActions>;
