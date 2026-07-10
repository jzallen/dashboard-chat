// Idle/activity tracker — ported from frontend/src/ui/context/AuthContext/hooks.
//
// Real input (mousedown/keydown/scroll/touchstart) stamps `lastActivity`, but
// DEBOUNCED to once per ACTIVITY_DEBOUNCE_MS — that debounced edge is also the
// keep-alive beat (onKeepAlive), so continuous use sends at most one keep-alive
// per ~5 min (the rate-limiter). A 1-min poll opens the ActivityCheckModal once
// idle passes INACTIVITY_THRESHOLD_MS; the modal then runs its own grace timer
// before auto-logout. "Continue" restamps activity AND fires a keep-alive.
import { useCallback, useEffect, useRef, useState } from "react";

import { getLastActivity, setLastActivity } from "./tokenStorage";

/** Default timings. Overridable via {@link UseInactivityArgs.timing} so tests can
 *  inject small values (rather than faking timers) and ops can tune without a
 *  rebuild — the constants remain the production defaults. */
export const DEFAULT_INACTIVITY_TIMING = {
  /** Keep-alive cadence ceiling: at most one beat per this window of activity. */
  debounceMs: 5 * 60 * 1000,
  /** Idle span before the "are you still there?" modal opens. */
  thresholdMs: 20 * 60 * 1000,
  /** How often the idle poll checks the threshold. */
  checkMs: 60 * 1000,
} as const;

export type InactivityTiming = typeof DEFAULT_INACTIVITY_TIMING;

const ACTIVITY_EVENTS: Array<keyof DocumentEventMap> = [
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
];

export interface UseInactivityArgs {
  /** Only track while signed in (no listeners/timers when logged out). */
  isAuthenticated: boolean;
  /** Auto-logout target — fired when the modal's grace timer elapses. */
  onLogout: () => void;
  /** The keep-alive beat, fired on each debounced activity edge + on Continue. */
  onKeepAlive?: () => void;
  /** Override any subset of the debounce/threshold/poll timings (defaults from
   *  {@link DEFAULT_INACTIVITY_TIMING}). */
  timing?: Partial<InactivityTiming>;
}

export interface UseInactivityResult {
  showModal: boolean;
  handleContinue: () => void;
  handleLogout: () => void;
}

export function useInactivity({
  isAuthenticated,
  onLogout,
  onKeepAlive,
  timing,
}: UseInactivityArgs): UseInactivityResult {
  const [showModal, setShowModal] = useState(false);
  const {
    debounceMs = DEFAULT_INACTIVITY_TIMING.debounceMs,
    thresholdMs = DEFAULT_INACTIVITY_TIMING.thresholdMs,
    checkMs = DEFAULT_INACTIVITY_TIMING.checkMs,
  } = timing ?? {};
  // Stash the latest callbacks in refs so the debounced listener reads them live
  // and the effect needn't re-bind on every render. The effect deliberately
  // depends only on isAuthenticated + the timings (NOT the callbacks); the refs
  // keep the listeners stable while still calling the current callbacks.
  const keepAliveRef = useRef(onKeepAlive);
  keepAliveRef.current = onKeepAlive;
  const logoutRef = useRef(onLogout);
  logoutRef.current = onLogout;

  useEffect(() => {
    if (!isAuthenticated) return;
    if (!getLastActivity()) setLastActivity(Date.now());

    const updateActivity = (): void => {
      const now = Date.now();
      const last = getLastActivity() ?? 0;
      if (now - last > debounceMs) {
        setLastActivity(now);
        keepAliveRef.current?.();
      }
    };
    ACTIVITY_EVENTS.forEach((event) =>
      document.addEventListener(event, updateActivity, { passive: true }),
    );
    const intervalId = setInterval(() => {
      const last = getLastActivity() ?? Date.now();
      if (Date.now() - last >= thresholdMs) setShowModal(true);
    }, checkMs);

    return () => {
      ACTIVITY_EVENTS.forEach((event) =>
        document.removeEventListener(event, updateActivity),
      );
      clearInterval(intervalId);
    };
  }, [isAuthenticated, debounceMs, thresholdMs, checkMs]);

  const handleContinue = useCallback(() => {
    setLastActivity(Date.now());
    setShowModal(false);
    keepAliveRef.current?.();
  }, []);

  const handleLogout = useCallback(() => {
    setShowModal(false);
    logoutRef.current();
  }, []);

  return { showModal, handleContinue, handleLogout };
}
