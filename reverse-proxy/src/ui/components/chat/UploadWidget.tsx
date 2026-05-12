import { useCallback, useRef, useState } from "react";

import { withAuth } from "@/auth";
import { createDataCatalog, type Dataset } from "@/dataCatalog";

import { useChatContext } from "../../context/ChatContext";
import styles from "./chat.module.css";

const catalog = createDataCatalog(withAuth(fetch));

type UploadState = "browse" | "selected" | "uploading" | "uploaded" | "error";

interface UploadWidgetProps {
  projectId: string;
}

export function UploadWidget({ projectId }: UploadWidgetProps) {
  const { onDatasetCreated } = useChatContext();
  const [state, setState] = useState<UploadState>("browse");
  const [file, setFile] = useState<File | null>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null!);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setState("selected");
    }
  }, []);

  const handleUpload = useCallback(async () => {
    if (!file) return;
    setState("uploading");
    setErrorMsg("");
    try {
      const result = await catalog.uploadFile<Dataset>("/api/uploads", file, {
        project_id: projectId,
      });
      setDataset(result);
      setState("uploaded");
      onDatasetCreated(result);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
      setState("error");
    }
  }, [file, projectId, onDatasetCreated]);

  const handleRetry = useCallback(() => {
    setState(file ? "selected" : "browse");
    setErrorMsg("");
  }, [file]);

  const handleRemove = useCallback(() => {
    setFile(null);
    setState("browse");
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  return (
    <div className={styles.uploadWidget}>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.tsv,.xlsx,.xls,.parquet"
        onChange={handleFileChange}
        className={styles.uploadHiddenInput}
        data-testid="upload-file-input"
      />

      {state === "browse" && (
        <button
          className={styles.uploadBrowseButton}
          onClick={() => inputRef.current?.click()}
          data-testid="upload-widget-browse"
        >
          Choose a file to upload
        </button>
      )}

      {state === "selected" && file && (
        <div className={styles.uploadSelected} data-testid="upload-widget-selected">
          <span className={styles.uploadFileName}>{file.name}</span>
          <span className={styles.uploadFileSize}>
            ({(file.size / 1024).toFixed(1)} KB)
          </span>
          <div className={styles.uploadActions}>
            <button className={styles.uploadSendButton} onClick={handleUpload}>
              Send
            </button>
            <button className={styles.uploadRemoveButton} onClick={handleRemove}>
              Remove
            </button>
          </div>
        </div>
      )}

      {state === "uploading" && (
        <div className={styles.uploadUploading} data-testid="upload-widget-uploading">
          <span className={styles.uploadSpinner} />
          Uploading {file?.name}...
        </div>
      )}

      {state === "uploaded" && dataset && (
        <div className={styles.uploadUploaded} data-testid="upload-widget-uploaded">
          Created dataset <strong>{dataset.name}</strong>
        </div>
      )}

      {state === "error" && (
        <div className={styles.uploadError} data-testid="upload-widget-error">
          <span>{errorMsg}</span>
          <button className={styles.uploadRetryButton} onClick={handleRetry}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
