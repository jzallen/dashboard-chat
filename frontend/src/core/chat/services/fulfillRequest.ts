/**
 * Agent Request Fulfillment
 *
 * Handles `r:` requests from the agent SSE stream. When the agent emits a
 * request (e.g. resolve_dataset), this module fulfills it by calling the
 * appropriate backend endpoint and returning the resolved context.
 */

import { DATA_CATALOG_BASE_URL } from "@/http/config";

import type { AgentRequest } from "./chatStream";

export interface ResolvedDataset {
  id: string;
  name: string;
}

export interface FulfillmentResult {
  success: boolean;
  /** Resolved dataset info when type is "resolve_dataset". */
  dataset?: ResolvedDataset;
  /** Error message when fulfillment fails. */
  error?: string;
}

/**
 * Fulfill an agent request by type.
 *
 * @param request  The parsed `r:` payload from the agent stream.
 * @param projectId  The current project ID (required for dataset search).
 * @param fetchFn  Fetch function (allows injection of auth headers).
 */
export async function fulfillAgentRequest(
  request: AgentRequest,
  projectId: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<FulfillmentResult> {
  if (request.type === "resolve_dataset") {
    return resolveDataset(request.params, projectId, fetchFn);
  }

  return { success: false, error: `Unknown request type: ${request.type}` };
}

const FULFILLMENT_TIMEOUT_MS = 10_000;

async function resolveDataset(
  params: Record<string, unknown>,
  projectId: string | null,
  fetchFn: typeof fetch,
): Promise<FulfillmentResult> {
  const name = params.name as string | undefined;
  if (!name) {
    return { success: false, error: "resolve_dataset requires a name parameter" };
  }

  if (!projectId) {
    return { success: false, error: "No project selected — cannot search for datasets" };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FULFILLMENT_TIMEOUT_MS);

    const url = `${DATA_CATALOG_BASE_URL}/api/projects/${projectId}/datasets/search?q=${encodeURIComponent(name)}`;
    const response = await fetchFn(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return { success: false, error: `Dataset search failed: HTTP ${response.status}` };
    }

    const body = (await response.json()) as { data: Array<{ id: string; name: string }> };
    const datasets = body.data;

    // Try exact match first (case-insensitive), then use all results
    const lowerName = name.toLowerCase();
    const exactMatch = datasets.find((d) => d.name.toLowerCase() === lowerName);
    if (exactMatch) {
      return { success: true, dataset: { id: exactMatch.id, name: exactMatch.name } };
    }

    if (datasets.length === 1) {
      return {
        success: true,
        dataset: { id: datasets[0].id, name: datasets[0].name },
      };
    }

    if (datasets.length > 1) {
      const names = datasets.map((d) => d.name).join(", ");
      return {
        success: false,
        error: `Multiple datasets match "${name}": ${names}. Please be more specific.`,
      };
    }

    return {
      success: false,
      error: `No dataset found matching "${name}".`,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { success: false, error: "Dataset search timed out" };
    }
    return {
      success: false,
      error: `Dataset search error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
