/**
 * sourceUploadPhase — the canvas's read-side view of the ui-state `sourceUpload`
 * region. A pure phase→label map plus a thin {@link useSourceUpload}
 * hook that slices the region off the StateProxy via `useSelector`, so the
 * lineage canvas can render the optimistic source node advancing through the
 * Source-creation saga (creating_source → uploading → processing → linked, plus
 * error_recoverable).
 */
import type { SourceUploadPhase } from "@dashboard-chat/ui-state-wire";
import { useSelector } from "@xstate/react";

import { useStateProxy } from "../../lib/StateProxyProvider";

/** A human-readable badge for an in-flight phase; `null` at idle (no badge). */
export function sourceUploadPhaseLabel(
  phase: SourceUploadPhase,
): string | null {
  switch (phase) {
    case "creating_source":
      return "Creating…";
    case "uploading":
      return "Uploading…";
    case "processing":
      return "Processing…";
    case "linked":
      return "Linked";
    case "error_recoverable":
      return "Failed";
    case "idle":
      return null;
  }
}

/** True while the saga is advancing or has errored (a badge should show). */
export function isInFlightPhase(phase: SourceUploadPhase): boolean {
  return phase !== "idle" && phase !== "linked";
}

/** The current `sourceUpload` region, sliced off the shared StateProxy. */
export function useSourceUpload() {
  const { proxy } = useStateProxy();
  return useSelector(proxy, (doc) => doc.regions.sourceUpload);
}
