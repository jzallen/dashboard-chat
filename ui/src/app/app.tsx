/* Mounts the app shell under the providers into #root.
   The shell and its parts live in ./AppShell; every view in its own package.

   Exported as mount() (rather than rendering on import) so the entry in
   src/main.js can gate it behind the dev-login flow: the logged-in path calls
   mount() with the exact provider tree below, unchanged. */
import { createRoot } from "react-dom/client";

import { AppShell, ThemeProvider } from "./AppShell";
import { FlashedNodeProvider } from "./FlashedNodeProvider";

export function mount(): void {
  const rootEl = document.getElementById("root");
  if (rootEl)
    createRoot(rootEl).render(
      <ThemeProvider>
        <FlashedNodeProvider>
          <AppShell />
        </FlashedNodeProvider>
      </ThemeProvider>,
    );
}
