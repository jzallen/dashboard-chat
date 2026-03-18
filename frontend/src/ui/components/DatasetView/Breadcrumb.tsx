import { useEffect,useRef, useState } from "react";

import styles from "./DatasetView.module.css";

const DEFAULT_NAME = "New Dataset";

interface BreadcrumbProps {
  projectName: string;
  datasetName?: string;
  onProjectClick?: () => void;
  onDatasetRename?: (name: string) => void;
  focusDatasetName?: boolean;
}

export function Breadcrumb({
  projectName,
  datasetName,
  onProjectClick,
  onDatasetRename,
  focusDatasetName,
}: BreadcrumbProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null!);

  const isDefault = datasetName === DEFAULT_NAME;
  const editable = Boolean(onDatasetRename);

  // Auto-enter edit mode when focusDatasetName is true
  useEffect(() => {
    if (focusDatasetName && editable && datasetName) {
      setEditing(true);
      setEditValue(isDefault ? "" : datasetName);
    }
  }, [focusDatasetName, editable, datasetName, isDefault]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const handleClick = () => {
    if (!editable) return;
    setEditing(true);
    setEditValue(isDefault ? "" : (datasetName ?? ""));
  };

  const handleSubmit = () => {
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== datasetName) {
      onDatasetRename?.(trimmed);
    }
  };

  const handleCancel = () => {
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

  return (
    <nav className={styles.breadcrumb}>
      <span className={styles.breadcrumbSeparator}>/</span>
      {onProjectClick ? (
        <button
          className={styles.breadcrumbButton}
          onClick={onProjectClick}
        >
          {projectName}
        </button>
      ) : (
        <span className={styles.breadcrumbItemCurrent}>
          {projectName}
        </span>
      )}
      {datasetName && (
        <>
          <span className={styles.breadcrumbSeparator}>/</span>
          {editing ? (
            <input
              ref={inputRef}
              className={styles.breadcrumbInput}
              data-testid="breadcrumb-edit-input"
              value={editValue}
              placeholder={isDefault ? DEFAULT_NAME : undefined}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSubmit}
              onKeyDown={handleKeyDown}
            />
          ) : (
            <span
              className={`${styles.breadcrumbItemCurrent} ${editable ? styles.breadcrumbEditable : ""}`}
              onClick={handleClick}
            >
              {datasetName}
            </span>
          )}
        </>
      )}
    </nav>
  );
}
