import type { Tool } from "ai";

import type { BackendClient } from "../backend-client";
import type { ChatEvent } from "../events";

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

export function dispatcherRegistry(_ctx: DispatchContext): DispatcherRegistry {
  return {};
}
