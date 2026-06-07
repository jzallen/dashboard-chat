/* Upload-flow state: the upload modal, the archive-confirm dialog it can open,
   and the catalog mutations behind creating / renaming / archiving a source. */
import { useCallback, useState } from "react";

import type { LineageNode } from "../../catalog";
import { catalog } from "../useCatalog";

/** The payload the upload modal emits when a brand-new dataset is created. */
export type NewSource = {
  file: File | null;
  name: string;
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
    async (src: NewSource) => {
      if (!src.file) return;
      // Real upload: the file lands in the lake (minio) and the backend creates
      // the dataset; the catalog then re-fetches the scope so it appears. A
      // user-typed name becomes the dataset's display name.
      const id = await catalog.createDataset(src.file);
      if (id && src.name.trim()) await catalog.renameSource(id, src.name.trim());
      if (id) flash(id);
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
