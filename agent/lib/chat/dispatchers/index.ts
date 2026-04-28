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
    registry.applyCleaningTransform = makeApplyCleaningTransformDispatcher(ctx.emit, ctx);
    registry.trimWhitespace = makeTrimWhitespaceDispatcher(ctx.emit, ctx);
    registry.standardizeCase = makeStandardizeCaseDispatcher(ctx.emit, ctx);
    registry.fillNulls = makeFillNullsDispatcher(ctx.emit, ctx);
    registry.mapValues = makeMapValuesDispatcher(ctx.emit, ctx);
  }
  return registry;
}
