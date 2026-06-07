// Client hydration entry. <HydratedRouter/> wires up the route tree and hydrates
// the document that root.tsx's Layout generated at build time.
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

hydrateRoot(
  document,
  <StrictMode>
    <HydratedRouter />
  </StrictMode>,
);
