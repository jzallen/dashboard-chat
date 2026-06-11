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

const ACTIVITY_DEBOUNCE_MS = 5 * 60 * 1000; // keep-alive cadence ceiling
const INACTIVITY_THRESHOLD_MS = 20 * 60 * 1000; // idle → "are you still there?"
const INACTIVITY_CHECK_MS = 60 * 1000; // poll cadence

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
}: UseInactivityArgs): UseInactivityResult {
  const [showModal, setShowModal] = useState(false);
  // Stash the latest callbacks in refs so the debounced listener never closes
  // over a stale one (and the effect needn't re-bind on every render).
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
      if (now - last > ACTIVITY_DEBOUNCE_MS) {
        setLastActivity(now);
        keepAliveRef.current?.();
      }
    };
    ACTIVITY_EVENTS.forEach((event) =>
      document.addEventListener(event, updateActivity, { passive: true }),
    );
    const intervalId = setInterval(() => {
      const last = getLastActivity() ?? Date.now();
      if (Date.now() - last >= INACTIVITY_THRESHOLD_MS) setShowModal(true);
    }, INACTIVITY_CHECK_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((event) =>
        document.removeEventListener(event, updateActivity),
      );
      clearInterval(intervalId);
    };
  }, [isAuthenticated]);

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
