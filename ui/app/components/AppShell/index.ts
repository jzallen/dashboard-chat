/* Public surface of the app shell. The shell itself is the RRv7 layout route
   (app/routes/app-shell.tsx); this barrel exposes the chrome pieces and the
   theme provider that root.tsx renders the route tree under. */
export { Chrome } from "./Chrome";
export { OnboardingGate } from "./OnboardingGate";
export { Overlays } from "./Overlays";
export { ThemeProvider, useTheme } from "./ThemeProvider";
export { Topbar } from "./Topbar";
export { useOpenNode } from "./useOpenNode";
