// AssistantChangesPanel — model-detail "Assistant changes" audit panel (MR-5).
//
// Presentational: renders the assistant tool-call audit entries for the current
// model (derived from the live chat session via deriveAssistantChanges) or an
// explicit empty-state. Pure over its props. Consumes MR-1 tokens via
// ModelDetail.module.css. RED scaffold (created by DISTILL).
import type { AssistantChange } from "../../../core/chat/assistantChanges";

export const __SCAFFOLD__ = true;

export interface AssistantChangesPanelProps {
  changes: AssistantChange[];
}

export function AssistantChangesPanel(
  _props: AssistantChangesPanelProps,
): JSX.Element {
  throw new Error(
    "Not yet implemented — RED scaffold (MR-5 AssistantChangesPanel)",
  );
}
