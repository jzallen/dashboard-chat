import { useEffect, useState } from "react";

import { withAuth } from "@/auth";
import { createDataCatalog, type DatasetSparse } from "@/dataCatalog";

import styles from "./chat.module.css";

const catalog = createDataCatalog(withAuth(fetch));

interface DatasetPickerProps {
  projectId?: string;
  onSelect: (datasetId: string) => void;
}

/** Inline dataset selector rendered as a chat message widget. */
export function DatasetPicker({ projectId, onSelect }: DatasetPickerProps) {
  const [datasets, setDatasets] = useState<DatasetSparse[]>([]);
  const [projectNames, setProjectNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDatasets() {
      try {
        if (projectId) {
          const result = await catalog.listDatasets(projectId);
          setDatasets(result);
        } else {
          // Fetch all projects and their datasets
          const projects = await catalog.listProjects();
          const allDatasets: DatasetSparse[] = [];
          const namesMap = new Map<string, string>();
          for (const p of projects) {
            namesMap.set(p.id, p.name);
            const ds = await catalog.listDatasets(p.id);
            allDatasets.push(...ds.map((d) => ({ ...d, project_id: p.id })));
          }
          setProjectNames(namesMap);
          setDatasets(allDatasets);
        }
      } catch (err) {
        console.error("Failed to fetch datasets:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchDatasets();
  }, [projectId]);

  if (loading) {
    return <div className={styles.pickerLoading}>Loading datasets...</div>;
  }

  if (datasets.length === 0) {
    return <div className={styles.pickerEmpty}>No datasets found. Upload a CSV first.</div>;
  }

  return (
    <div className={styles.pickerContainer} data-testid="dataset-picker">
      <p className={styles.pickerLabel}>Select a dataset to work with:</p>
      <div className={styles.pickerList}>
        {datasets.map((ds) => (
          <button
            key={ds.id}
            className={styles.pickerItem}
            onClick={() => onSelect(ds.id)}
            data-testid={`picker-dataset-${ds.id}`}
          >
            <span className={styles.pickerItemName}>{ds.name}</span>
            {ds.project_id && projectNames.get(ds.project_id) && (
              <span className={styles.pickerItemProject}>{projectNames.get(ds.project_id)}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
