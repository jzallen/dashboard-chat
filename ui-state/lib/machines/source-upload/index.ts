// Barrel for the source-upload XState machine directory.
//
// The public surface is intentionally MINIMAL (the only things consumed outside
// this directory):
//   - createSourceUploadMachine — the statechart factory (the chat-app
//     composition root swaps it over its placeholder child slot).
//   - SourceUploadContext / SourceUploadState — the context + state vocabulary
//     the projection (chat-app/projection/derive-state-document.ts) reads to
//     derive the `sourceUpload` region.
//
// Everything else (the events, the actions) is an implementation detail and is
// deliberately NOT re-exported here.

export { createSourceUploadMachine } from "./machine.ts";
export type {
  SourceUploadContext,
  SourceUploadState,
} from "./setup/types.ts";
