/* Entry: mount the app shell under the theme provider into #root.
   The shell and its parts live in ./AppShell; every view in its own package. */
import { createRoot } from "react-dom/client";

import { AppShell, ThemeProvider } from "./AppShell";

const rootEl = document.getElementById("root");
if (rootEl)
  createRoot(rootEl).render(
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>,
  );
