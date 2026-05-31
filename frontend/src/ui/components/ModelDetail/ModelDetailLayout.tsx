// ModelDetailLayout — consistent single-page model-detail shell (MR-5).
//
// Presentational: the shared chrome that gives dataset / view / report detail
// pages one consistent layout — a scrolling content column (title + badges +
// description + the section children) plus the existing chat affordances
// (activity log overlay + input bar) as siblings. Consumes MR-1 tokens via
// ModelDetail.module.css. RED scaffold (created by DISTILL).
import type { ReactNode } from "react";

export const __SCAFFOLD__ = true;

export interface ModelDetailLayoutProps {
  title: string;
  badges?: ReactNode;
  description?: string | null;
  children: ReactNode;
  activityLog?: ReactNode;
  inputBar?: ReactNode;
}

export function ModelDetailLayout(_props: ModelDetailLayoutProps): JSX.Element {
  throw new Error("Not yet implemented — RED scaffold (MR-5 ModelDetailLayout)");
}
