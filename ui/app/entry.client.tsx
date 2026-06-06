// RRv7 framework-mode client hydration entry (SPA) — mirrors frontend/main.tsx.
// <HydratedRouter/> from react-router/dom wires the route tree from app/routes.ts.
// In SPA mode the document is generated from root.tsx's Layout at build time and
// hydrated here.
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

hydrateRoot(
  document,
  <StrictMode>
    <HydratedRouter />
  </StrictMode>,
);
