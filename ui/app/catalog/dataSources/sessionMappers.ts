/**
 * sessionMappers — pure, fetch-free mappers that adapt the backend's project
 * sessions (`GET /api/projects/{id}/sessions`) to the catalog's
 * {@link import("../models").ChatHistoryItem} shown in the assistant-dock recents
 * list and the `/project/:projectId/chats` history. Mirrors {@link lineageMappers}:
 * the fetch lives in {@link metadataApiSource}; this module is pure.
 *
 * `now` is a PARAMETER (never `Date.now()` here) so the relative-time formatting
 * stays deterministic under test — the wall clock is read in the adapter shell.
 */
import type { ChatHistoryItem } from "../models";

/** A session resource as the backend returns it (post envelope-unwrap). */
export interface BackendSession {
  id: string;
  title: string;
  active_dataset_id?: string | null;
  created_at?: string | null;
  last_active_at?: string | null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A small relative-time formatter: "just now" / "Nm ago" / "Nh ago" / "Nd ago",
 * falling through to a plain date for anything older than a week.
 */
export function formatWhen(iso: string, now: number): string {
  const elapsed = now - Date.parse(iso);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Adapt a backend session to a {@link ChatHistoryItem}. `nodeId` is the session's
 * active dataset (a dataset id IS its staging-node id, so a recent links to and
 * opens its dataset) or `null`; `when` is the relative time of the last activity
 * (falling back to creation); `snippet` is omitted (sessions carry none).
 */
export function toChatHistoryItem(
  session: BackendSession,
  now: number,
): ChatHistoryItem {
  const iso = session.last_active_at ?? session.created_at ?? undefined;
  return {
    title: session.title,
    nodeId: session.active_dataset_id ?? null,
    when: iso ? formatWhen(iso, now) : undefined,
    snippet: undefined,
  };
}
