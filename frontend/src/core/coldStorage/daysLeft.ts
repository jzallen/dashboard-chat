// Cold-storage retention math — pure core (MR-7). RED scaffold (created by DISTILL).
//
// days-left is derived FRONTEND-side from the server's `retention_until` (path-forward
// §3.1 — no stored countdown). The clock is INJECTED (not `Date.now()` inside the helper)
// so the unit test is deterministic. DELIVER 07-02 replaces the body.
export const __SCAFFOLD__ = true;

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
  void retentionUntil;
  void now;
  throw new Error("Not yet implemented — RED scaffold (daysLeft, MR-7)");
}
