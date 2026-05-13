// MR-0 route shim — CreateOrg's index.tsx already wraps its default export with
// <RequireAuth /> (DWD-6 preservation of App.tsx's `/org/create` guard).
import CreateOrgGuarded from "../../src/ui/components/CreateOrg";

export default CreateOrgGuarded;
