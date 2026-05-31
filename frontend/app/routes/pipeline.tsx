// Framework-mode route shim — `/projects/:projectId/pipeline` (MR-2).
//
// The lineage Pipeline is the landing surface for a selected project
// (path-forward.md §4.2). Library-mode (no `loader`): the graph is derived
// client-side from the dataCatalog REST hooks inside PipelineLanding — it does
// NOT touch the ui-state wire, so no server loader is wired here (an SSR loader
// would require server-side dataCatalog fetching; deferred — see
// distill/wave-decisions-mr2.md DWD-M2-2). The full `/`-index swap to Pipeline +
// chat-as-overlay is MR-4.
import { PipelineLanding } from "../../src/ui/components/Pipeline";

export default PipelineLanding;
