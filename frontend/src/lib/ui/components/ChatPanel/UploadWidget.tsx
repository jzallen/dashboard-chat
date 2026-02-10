import { useState, useRef, useEffect } from "react";
import { uploadFile } from "@/api";
import type { Dataset } from "@/api";
import styles from "./ChatPanel.module.css";

type UploadState = "browse" | "selected" | "uploading" | "uploaded" | "error";

interface UploadWidgetProps {
  projectId: string;
  onUploadComplete: (dataset: Dataset) => void;
  onUploadError?: (error: string) => void;
  autoOpen?: boolean;
}

export function UploadWidget({
  projectId,
  onUploadComplete,
  onUploadError,
  autoOpen = true,
}: UploadWidgetProps) {
  const [state, setState] = useState<UploadState>("browse");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null!);

  useEffect(() => {
    if (autoOpen) {
      inputRef.current?.click();
    }
  }, [autoOpen]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setState("selected");
      setError(null);
    }
  };

  const handleRemove = () => {
    setFile(null);
    setState("browse");
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleUpload = async () => {
    if (!file) return;
    setState("uploading");
    try {
      const dataset = await uploadFile<Dataset>("/api/uploads", file, {
        project_id: projectId,
      });
      setState("uploaded");
      onUploadComplete(dataset);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setState("error");
      setError(message);
      onUploadError?.(message);
    }
  };

  return (
    <div className={styles.uploadWidget}>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        onChange={handleFileChange}
        className={styles.uploadInput}
        data-testid="upload-file-input"
      />
      {state === "browse" && (
        <button
          onClick={() => inputRef.current?.click()}
          className={styles.uploadButton}
          type="button"
        >
          Browse
        </button>
      )}
      {state === "selected" && file && (
        <div className={styles.uploadSelected}>
          <span className={styles.uploadFilename}>{file.name}</span>
          <button
            onClick={handleRemove}
            className={styles.uploadRemove}
            aria-label="Remove file"
            type="button"
          >
            &times;
          </button>
          <button onClick={handleUpload} className={styles.uploadButton} type="button">
            Send
          </button>
        </div>
      )}
      {state === "uploading" && (
        <span className={styles.uploadUploading}>Uploading...</span>
      )}
      {state === "uploaded" && (
        <button disabled className={styles.uploadButtonDone} type="button">
          Uploaded
        </button>
      )}
      {state === "error" && (
        <div className={styles.uploadErrorContainer}>
          <span className={styles.uploadError}>{error}</span>
          <button
            onClick={handleRemove}
            className={styles.uploadButton}
            type="button"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
