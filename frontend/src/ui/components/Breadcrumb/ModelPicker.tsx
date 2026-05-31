// Searchable model picker popover (MR-3, path-forward §4.1).
//
// Opened from the breadcrumb's `Model ▾` crumb on a model-detail route. Renders a
// search box that filters across three groups — Datasets / Views / Reports — and
// navigates to the chosen model's detail route (dataset → table/:id, view →
// view/:id, report → report/:id). Data comes from the existing per-project list
// hooks (NOT ui-state).
import { useState } from "react";

import type { DatasetSparse, Report, View } from "@/dataCatalog";

import styles from "./Breadcrumb.module.css";
import type { ModelKind } from "./breadcrumbContext";

export interface ModelPickerProps {
  datasets: DatasetSparse[];
  views: View[];
  reports: Report[];
  onSelect: (modelKind: ModelKind, modelId: string) => void;
}

interface ModelOption {
  id: string;
  name: string;
  kind: ModelKind;
}

function matches(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.toLowerCase());
}

export function ModelPicker({
  datasets,
  views,
  reports,
  onSelect,
}: ModelPickerProps): JSX.Element {
  const [query, setQuery] = useState("");

  const renderGroup = (
    testId: string,
    heading: string,
    options: ModelOption[],
  ) => (
    <div data-testid={testId}>
      <div className={styles.group}>{heading}</div>
      {options
        .filter((option) => matches(option.name, query))
        .map((option) => (
          <button
            key={option.id}
            type="button"
            data-testid={`model-option-${option.id}`}
            className={styles.option}
            onClick={() => onSelect(option.kind, option.id)}
          >
            {option.name}
          </button>
        ))}
    </div>
  );

  return (
    <div className={styles.picker} role="dialog">
      <input
        data-testid="model-picker-search"
        className={styles.search}
        placeholder="Search models…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {renderGroup(
        "model-group-datasets",
        "Datasets",
        datasets.map((dataset) => ({
          id: dataset.id,
          name: dataset.name,
          kind: "dataset" as const,
        })),
      )}
      {renderGroup(
        "model-group-views",
        "Views",
        views.map((view) => ({
          id: view.id,
          name: view.name,
          kind: "view" as const,
        })),
      )}
      {renderGroup(
        "model-group-reports",
        "Reports",
        reports.map((report) => ({
          id: report.id,
          name: report.name,
          kind: "report" as const,
        })),
      )}
    </div>
  );
}

export default ModelPicker;
