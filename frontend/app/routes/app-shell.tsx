// Layout shim — AppShell wraps its render with
// <RequireAuth><RequireOrg>…</RequireOrg></RequireAuth> (DWD-6). The inner
// <QueryProvider /> was removed in Phase 02 (DWD-7); the root-level
// <QueryClientProvider> in frontend/app/root.tsx is the sole client identity.
import { AppShell } from "../../src/ui/components/AppShell";

export default AppShell;
