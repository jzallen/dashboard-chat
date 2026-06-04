/* Entry: mount the app shell under the providers into #root.
   The shell and its parts live in ./AppShell; every view in its own package. */
import { createRoot } from "react-dom/client";

import { AppShell, ThemeProvider } from "./AppShell";
import { JustAddedProvider } from "./JustAddedProvider";

const rootEl = document.getElementById("root");
if (rootEl)
  createRoot(rootEl).render(
    <ThemeProvider>
      <JustAddedProvider>
        <AppShell />
      </JustAddedProvider>
    </ThemeProvider>,
  );
