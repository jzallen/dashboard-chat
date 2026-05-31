// Cold-storage retention math — pure core (MR-7).
//
// days-left is derived FRONTEND-side from the server's `retention_until` (path-forward
// §3.1 — no stored countdown). The clock is INJECTED (not `Date.now()` inside the helper)
// so callers control "now" and the unit test is deterministic.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days remaining until a source's retention window ends.
 *
 * @param retentionUntil ISO timestamp of the retention end, or null when the source is live.
 * @param now            the reference instant (injected for determinism).
 * @returns null when `retentionUntil` is null/empty; otherwise the ceiling of the
 *          remaining days (negative once the window has elapsed).
 */
export function daysLeft(
  retentionUntil: string | null | undefined,
  now: Date,
): number | null {
  if (!retentionUntil) return null;
  const end = new Date(retentionUntil).getTime();
  return Math.ceil((end - now.getTime()) / MS_PER_DAY);
}
