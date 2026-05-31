// Searchable model picker popover — RED scaffold (created by DISTILL, MR-3).
//
// Opened from the breadcrumb's `Model ▾` crumb on a model-detail route. Renders a
// search box that filters across three groups — Datasets / Views / Reports — and
// navigates to the chosen model's detail route (dataset → table/:id, view →
// view/:id, report → report/:id). Data comes from the existing per-project list
// hooks (NOT ui-state). path-forward §4.1.
import type { DatasetSparse, Report, View } from "@/dataCatalog";

import type { ModelKind } from "./breadcrumbContext";

export const __SCAFFOLD__ = true;

export interface ModelPickerProps {
  datasets: DatasetSparse[];
  views: View[];
  reports: Report[];
  onSelect: (modelKind: ModelKind, modelId: string) => void;
}

export function ModelPicker(_props: ModelPickerProps): JSX.Element {
  throw new Error("Not yet implemented — RED scaffold (breadcrumb MR-3)");
}

export default ModelPicker;
