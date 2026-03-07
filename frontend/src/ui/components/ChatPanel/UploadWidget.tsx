import { useEffect, useRef, useState } from "react";

import { withAuth } from "@/auth";
import { createDataCatalog, type Dataset } from "@/dataCatalog";
import type { FormatInfo } from "@/dataCatalog/client";

const catalog = createDataCatalog(withAuth(fetch));

import styles from "./ChatPanel.module.css";

type UploadState =
  | "browse"
  | "selected"
  | "uploading"
  | "uploaded"
  | "awaiting_input"
  | "error";

interface PluginChoice {
  key: string;
  label: string;
  options: string[];
}

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
  const [formats, setFormats] = useState<FormatInfo[]>([]);
  const [choices, setChoices] = useState<PluginChoice[]>([]);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null!);
  const hasAutoOpened = useRef(false);

  useEffect(() => {
    catalog.getFormats().then(setFormats).catch(() => {});
  }, []);

  useEffect(() => {
    if (autoOpen && !hasAutoOpened.current) {
      hasAutoOpened.current = true;
      inputRef.current?.click();
    }
  }, [autoOpen]);

  const acceptExtensions = formats.length
    ? formats.flatMap((f) => f.extensions).join(",")
    : ".csv";

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
    setChoices([]);
    setUploadId(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleUpload = async () => {
    if (!file) return;
    setState("uploading");
    try {
      const result = await catalog.uploadFile<
        Dataset & { status?: string; choices?: PluginChoice[]; id?: string }
      >("/api/uploads", file, {
        project_id: projectId,
      });

      if (result.status === "awaiting_input" && result.choices) {
        setState("awaiting_input");
        setChoices(result.choices);
        setUploadId(result.id ?? null);
      } else {
        setState("uploaded");
        onUploadComplete(result);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setState("error");
      setError(message);
      onUploadError?.(message);
    }
  };

  const handleChoiceSelect = async (key: string, value: string) => {
    if (!uploadId) return;
    setState("uploading");
    try {
      const dataset = await catalog.processUploadWithChoices<Dataset>(
        uploadId,
        { [key]: value },
      );
      setState("uploaded");
      onUploadComplete(dataset);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Processing failed";
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
        accept={acceptExtensions}
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
          <button
            onClick={handleUpload}
            className={styles.uploadButton}
            type="button"
          >
            Send
          </button>
        </div>
      )}
      {state === "uploading" && (
        <span className={styles.uploadUploading}>Uploading...</span>
      )}
      {state === "awaiting_input" && (
        <div className={styles.uploadSelected}>
          {choices.map((choice) => (
            <div key={choice.key}>
              <p>{choice.label}</p>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {choice.options.map((option) => (
                  <button
                    key={option}
                    onClick={() => handleChoiceSelect(choice.key, option)}
                    className={styles.uploadButton}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
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
