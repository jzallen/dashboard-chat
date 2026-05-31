// Assistant — shell-level FAB + glass overlay (light) / docked TUI terminal (dark).
//
// Mounts in AppShell as a sibling of <Outlet/> (path-forward §4.4) so it floats over
// every view. A bottom-right FAB toggles the assistant open/closed; when open the
// render branch is `dark ? <TerminalAssistant/> : <GlassOverlay/>` off the reactive
// dark flag (useIsDark) — both render the SAME chat feed from the EXISTING
// ChatProvider/StreamProvider context (the ui-state wire is untouched). The FAB hides
// while the org settings sheet is open (?org=1) so it does not overlap the sheet
// (path-forward §4.1).
import { useState } from "react";
import { useSearchParams } from "react-router";

import type { Project } from "@/dataCatalog";

import styles from "./Assistant.module.css";
import { GlassOverlay } from "./GlassOverlay";
import { TerminalAssistant } from "./TerminalAssistant";
import { useIsDark } from "./useIsDark";

export interface AssistantProps {
  projects: Project[] | null;
}

export function Assistant({ projects }: AssistantProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const dark = useIsDark();

  // Hide the FAB (and any open surface) while the org sheet is open so it never
  // overlaps the sheet (path-forward §4.1).
  if (searchParams.get("org") === "1") return null;

  const close = () => setOpen(false);

  return (
    <>
      <button
        type="button"
        data-testid="assistant-fab"
        className={styles.fab}
        aria-label={open ? "Close assistant" : "Open assistant"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "×" : "✦"}
      </button>
      {open &&
        (dark ? (
          <TerminalAssistant projects={projects} onClose={close} />
        ) : (
          <GlassOverlay projects={projects} onClose={close} />
        ))}
    </>
  );
}

export default Assistant;
