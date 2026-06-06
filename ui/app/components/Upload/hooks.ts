/* Upload-flow state: the upload modal, the archive-confirm dialog it can open,
   and the catalog mutations behind creating / renaming / archiving a source. */
import { useCallback, useState } from "react";

import type { FieldDef, LineageNode } from "../../catalog";
import { catalog } from "../useCatalog";

/** The payload the upload modal emits when a brand-new source is created. */
export type NewSource = {
  name: string;
  schema: FieldDef[] | null;
  files: { name: string; rows: number; when: string }[];
};

/** @param flash - mark a freshly created node so the canvas can pop it. */
export function useUpload(flash: (id: string) => void) {
  const [modal, setModal] = useState<{
    open: boolean;
    source: LineageNode | null;
  }>({ open: false, source: null });
  const [confirmArchive, setConfirmArchive] = useState<LineageNode | null>(
    null,
  );

  const openUpload = useCallback(
    (source: LineageNode | null) => setModal({ open: true, source }),
    [],
  );
  const closeUpload = useCallback(
    () => setModal({ open: false, source: null }),
    [],
  );
  const requestArchive = useCallback(
    (src: LineageNode) => setConfirmArchive(src),
    [],
  );
  const cancelArchive = useCallback(() => setConfirmArchive(null), []);
  const archiveSource = useCallback(
    (src: LineageNode) => {
      catalog.archiveSource(src);
      setConfirmArchive(null);
      closeUpload();
    },
    [closeUpload],
  );
  const renameSource = useCallback(
    (id: string, name: string) => catalog.renameSource(id, name),
    [],
  );
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
      flash(id);
    },
    [flash],
  );

  return {
    modal,
    openUpload,
    closeUpload,
    confirmArchive,
    requestArchive,
    cancelArchive,
    archiveSource,
    createSource,
    renameSource,
  };
}
export type UploadApi = ReturnType<typeof useUpload>;
