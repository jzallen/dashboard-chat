import type { Project } from "@/api";
import { ProjectHeader } from "./ProjectHeader";
import { DatasetCard } from "./DatasetCard";
import styles from "./ProjectView.module.css";

interface ProjectViewProps {
  project: Project;
  onSelectDataset: (datasetId: string) => void;
}

export function ProjectView({ project, onSelectDataset }: ProjectViewProps) {
  return (
    <div className={styles.container}>
      <ProjectHeader projectName={project.name} />

      {project.datasets.length === 0 ? (
        <div className={styles.emptyState}>No datasets in this project</div>
      ) : (
        <div className={styles.datasetList}>
          {project.datasets.map((dataset) => (
            <DatasetCard
              key={dataset.id}
              dataset={dataset}
              onSelect={onSelectDataset}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default ProjectView;
