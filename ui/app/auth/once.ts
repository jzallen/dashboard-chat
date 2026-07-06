// A named one-shot latch.
//
// Several places in the auth flow need "run this exactly once, then never again"
// — most visibly the module-level 401 recovery, which must fire a single
// navigation even when a burst of concurrent 401s calls it. Hand-rolling that as
// a bare `let done = false` flag scatters the same pattern under different names
// and forces each site to expose its own test-reset seam. `once()` captures the
// pattern in one place: the guard is implicit in `run`, and `reset` gives tests a
// single, uniform seam.

export interface Once<A extends unknown[]> {
  /** Invoke the wrapped fn on the first call; a no-op on every later call. */
  run: (...args: A) => void;
  /** Re-arm the latch so the next `run` fires again. For tests. */
  reset: () => void;
}

export function once<A extends unknown[]>(fn: (...args: A) => void): Once<A> {
  let done = false;
  return {
    run: (...args: A) => {
      if (done) return;
      done = true;
      fn(...args);
    },
    reset: () => {
      done = false;
    },
  };
}
