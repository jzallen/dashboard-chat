import { BackendClientError } from "../backend-client";
import type { ChatEvent } from "../events";
import type { AuditTag } from "../toolCallTags";
import type { DispatchContext } from "./index";

export type Emit = (event: ChatEvent) => void;

export type DispatcherSuccess<T = Record<string, unknown>> = T & { ok: true };
export type DispatcherFailure = { ok: false; error: string };
export type DispatcherResult<T = Record<string, unknown>> =
  | DispatcherSuccess<T>
  | DispatcherFailure;

export function isRetryable(err: unknown): boolean {
  if (err instanceof BackendClientError) {
    return err.status === 0 || err.status >= 500;
  }
  return false;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Wraps a backend call so the dispatcher's `execute` callback never throws past
 * its boundary (DESIGN §1 invariant). On failure, emits an error_occurred event
 * with the supplied phase + failedTool, and returns a structured failure.
 */
export async function runWithEmit<T extends Record<string, unknown>>(
  emit: Emit,
  failedTool: string,
  body: () => Promise<DispatcherSuccess<T>>,
  phase: "auth" | "authz" | "backend_dispatch" | "validation" | "groq" | "unknown" = "backend_dispatch",
): Promise<DispatcherResult<T>> {
  try {
    return await body();
  } catch (err) {
    const message = errorMessage(err);
    emit({
      type: "error_occurred",
      phase,
      message,
      failed_tool: failedTool,
      retryable: isRetryable(err),
    });
    return { ok: false, error: message };
  }
}

let _idCounter = 0;
function nextSyntheticId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${Date.now()}-${_idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Reads `body.id` (or common nested variants) from a backend response. Falls
 * back to a synthetic id when the backend returns only `{ok: true}` — the FE
 * uses the id as a stable handle for invalidation, so a synthetic id is safer
 * than an empty string.
 */
export function readBackendId(raw: unknown, syntheticPrefix: string): string {
  if (raw && typeof raw === "object") {
    const body = raw as {
      id?: unknown;
      data?: { id?: unknown };
      row_id?: unknown;
      transform_id?: unknown;
    };
    if (typeof body.id === "string") return body.id;
    if (typeof body.row_id === "string") return body.row_id;
    if (typeof body.transform_id === "string") return body.transform_id;
    if (body.data && typeof body.data === "object" && typeof body.data.id === "string") {
      return body.data.id;
    }
  }
  return nextSyntheticId(syntheticPrefix);
}

/** The assistant tool-call the agent records as an audit entry (§2.7). */
export interface AssistantToolCall {
  tool: string;
  say: string;
  tag: AuditTag;
}

/**
 * Persist an assistant tool-call BEFORE the transform write (rich-catalog §2.7
 * Option A): POST /api/projects/{projectId}/audit and return the created audit
 * entry's id so the caller can thread it back as `assistant_audit_entry_id` on
 * the transform create/patch (the reversed FK).
 *
 * Provenance is best-effort: a failed POST (or a missing projectId) must NEVER
 * abort the user's transform. On failure we log and return `undefined` so the
 * transform proceeds unlinked — design §2.7 accepts a missed log over a failed
 * mutation. No user-facing error_occurred is emitted.
 */
export async function persistToolCall(
  ctx: DispatchContext,
  args: AssistantToolCall,
): Promise<string | undefined> {
  if (!ctx.projectId || !ctx.datasetId) return undefined;
  try {
    const raw = await ctx.backend.post(
      `/api/projects/${ctx.projectId}/audit`,
      {
        node_id: ctx.datasetId,
        node_kind: "dataset",
        payload: { tool: args.tool, say: args.say, tag: args.tag },
      },
    );
    const id = readBackendId(raw, "tool-call");
    return id;
  } catch (err) {
    // Best-effort provenance — never fail the transform on a log miss.

    console.warn(
      `tool-call persistence failed for ${args.tool}: ${errorMessage(err)}`,
    );
    return undefined;
  }
}

/** Validates the dispatcher has the dataset context it needs. */
export function requireDatasetId(
  emit: Emit,
  failedTool: string,
  datasetId: string | undefined,
): { ok: true; datasetId: string } | DispatcherFailure {
  if (!datasetId) {
    const message = `${failedTool}: missing dataset context`;
    emit({
      type: "error_occurred",
      phase: "validation",
      message,
      failed_tool: failedTool,
      retryable: false,
    });
    return { ok: false, error: message };
  }
  return { ok: true, datasetId };
}
