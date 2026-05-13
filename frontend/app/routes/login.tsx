// MR-0 route shim: re-exports LoginPage as default so RRv7 framework mode can
// resolve the route module. Once per-route migrations begin, this file may grow
// into a full loader-bearing route module.
import { LoginPage } from "../../src/ui/components/LoginPage";

export default LoginPage;
