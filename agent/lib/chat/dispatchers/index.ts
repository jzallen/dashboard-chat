import type { Tool } from "ai";

import type { BackendClient } from "../backend-client";
import type { ChatEvent } from "../events";
import {
  makeApplyCleaningTransformDispatcher,
  makeFillNullsDispatcher,
  makeMapValuesDispatcher,
  makeStandardizeCaseDispatcher,
  makeTrimWhitespaceDispatcher,
} from "./cleaning";
import {
  makeAddRowDispatcher,
  makeDeleteRowDispatcher,
  makeReEnableCleaningTransformDispatcher,
  makeRenameColumnDispatcher,
  makeUndoCleaningTransformDispatcher,
} from "./mutations";

export type DispatchContext = {
  jwt: string;
  datasetId?: string;
  projectId?: string;
  contextType: "dataset" | "project" | "report";
  backend: BackendClient;
  emit: (event: ChatEvent) => void;
};

export type DispatcherFamily = "cleaning" | "mutations" | "ui";

export type DispatcherRegistry = Record<string, Tool>;

export function dispatcherRegistry(ctx: DispatchContext): DispatcherRegistry {
  const registry: DispatcherRegistry = {};
  if (ctx.contextType === "dataset" && ctx.datasetId) {
    // Cleaning (PR 1)
    registry.applyCleaningTransform = makeApplyCleaningTransformDispatcher(ctx.emit, ctx);
    registry.trimWhitespace = makeTrimWhitespaceDispatcher(ctx.emit, ctx);
    registry.standardizeCase = makeStandardizeCaseDispatcher(ctx.emit, ctx);
    registry.fillNulls = makeFillNullsDispatcher(ctx.emit, ctx);
    registry.mapValues = makeMapValuesDispatcher(ctx.emit, ctx);
    // Mutations (PR 2)
    registry.addRow = makeAddRowDispatcher(ctx.emit, ctx);
    registry.deleteRow = makeDeleteRowDispatcher(ctx.emit, ctx);
    registry.renameColumn = makeRenameColumnDispatcher(ctx.emit, ctx);
    registry.undoCleaningTransform = makeUndoCleaningTransformDispatcher(ctx.emit, ctx);
    registry.reEnableCleaningTransform = makeReEnableCleaningTransformDispatcher(ctx.emit, ctx);
  }
  return registry;
}
