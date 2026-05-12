import { useCallback, useEffect, useState } from "react";

import { getLastActivity, setLastActivity } from "@/auth/tokenStorage";

const ACTIVITY_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes
const INACTIVITY_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes
const INACTIVITY_CHECK_MS = 60 * 1000; // 1 minute

const ACTIVITY_EVENTS: Array<keyof DocumentEventMap> = ["mousedown", "keydown", "scroll", "touchstart"];

function updateActivity() {
  const now = Date.now();
  const last = getLastActivity() ?? 0;
  if (now - last > ACTIVITY_DEBOUNCE_MS) {
    setLastActivity(now);
  }
}

function configureActivityListeners(events: Array<keyof DocumentEventMap>) {
  events.forEach((event) => {
    document.addEventListener(event, updateActivity, { passive: true });
  });
}

function setInactivityInterval(onInactive: () => void) {
  return setInterval(() => {
    const currentActivity = getLastActivity() ?? Date.now();
    const inactiveMs = Date.now() - currentActivity;
    if (inactiveMs >= INACTIVITY_THRESHOLD_MS) {
      onInactive();
    }
  }, INACTIVITY_CHECK_MS);
}

function cleanupActivityTracking(events: Array<keyof DocumentEventMap>, intervalId: ReturnType<typeof setInterval>) {
  events.forEach((event) => {
    document.removeEventListener(event, updateActivity);
  });
  clearInterval(intervalId);
}

export function useInactivity(isAuthenticated: boolean, logout: () => void) {
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;

    const hasActivity = !!getLastActivity();
    if (!hasActivity) {
      setLastActivity(Date.now());
    }

    configureActivityListeners(ACTIVITY_EVENTS);
    const intervalId = setInactivityInterval(() => setShowModal(true));

    return () => cleanupActivityTracking(ACTIVITY_EVENTS, intervalId);
  }, [isAuthenticated]);

  const handleContinue = useCallback(() => {
    setLastActivity(Date.now());
    setShowModal(false);
  }, []);

  const handleLogout = useCallback(() => {
    setShowModal(false);
    logout();
  }, [logout]);

  return { showModal, handleContinue, handleLogout };
}
