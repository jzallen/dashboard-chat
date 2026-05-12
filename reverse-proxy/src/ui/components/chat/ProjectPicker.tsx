import { useEffect, useState } from "react";

import { withAuth } from "@/auth";
import { createDataCatalog, type Project } from "@/dataCatalog";

import styles from "./chat.module.css";

const catalog = createDataCatalog(withAuth(fetch));

interface ProjectPickerProps {
  onSelect: (projectId: string) => void;
}

/** Inline project selector for upload flow. Auto-selects if only one project. */
export function ProjectPicker({ onSelect }: ProjectPickerProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchProjects() {
      try {
        const result = await catalog.listProjects();
        setProjects(result);
        // Auto-select if only one project
        if (result.length === 1) {
          onSelect(result[0].id);
        }
      } catch (err) {
        console.error("Failed to fetch projects:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchProjects();
  }, [onSelect]);

  if (loading) {
    return <div className={styles.pickerLoading}>Loading projects...</div>;
  }

  if (projects.length === 0) {
    return <div className={styles.pickerEmpty}>No projects found.</div>;
  }

  // If auto-selected (1 project), don't render the picker
  if (projects.length === 1) return null;

  return (
    <div className={styles.pickerContainer} data-testid="project-picker">
      <p className={styles.pickerLabel}>Select a project:</p>
      <div className={styles.pickerList}>
        {projects.map((p) => (
          <button
            key={p.id}
            className={styles.pickerItem}
            onClick={() => onSelect(p.id)}
            data-testid={`picker-project-${p.id}`}
          >
            <span className={styles.pickerItemName}>{p.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
