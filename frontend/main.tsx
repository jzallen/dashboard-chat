// RRv7 framework-mode client hydration entry (DWD-6).
// <HydratedRouter /> from react-router/dom wires the route tree declared in
// frontend/app/routes.ts and reconciles the SSR'd state from frontend/app/root.tsx.
// hydrateRoot(document, ...) — the SSR'd HTML is the entire document.
import "./index.css";

import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

hydrateRoot(
  document,
  <StrictMode>
    <HydratedRouter />
  </StrictMode>,
);
