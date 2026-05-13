// MR-0 layout shim — AppShell wraps its render with
// <RequireAuth><RequireOrg>…</RequireOrg></RequireAuth> (DWD-6) and the inner
// <QueryProvider /> (DWD-7, removed in first per-route migration).
import { AppShell } from "../../src/ui/components/AppShell";

export default AppShell;
