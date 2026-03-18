import { useEffect,useState } from "react";

import { getLastActivity } from "@/auth/tokenStorage";

/**
 * Debug-only badge that displays minutes since last user activity.
 * Only rendered when VITE_DEBUG_ACTIVITY=true.
 */
export function ActivityDebugBadge() {
  const [idleMinutes, setIdleMinutes] = useState<number>(0);

  useEffect(() => {
    const update = () => {
      const lastActivity = getLastActivity();
      if (lastActivity) {
        const elapsed = Date.now() - lastActivity;
        setIdleMinutes(Math.floor(elapsed / 60_000));
      }
    };

    update();
    const id = setInterval(update, 5_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        left: 12,
        padding: "4px 10px",
        borderRadius: 6,
        background: "rgba(0, 0, 0, 0.55)",
        color: "#fff",
        fontSize: 12,
        fontFamily: "monospace",
        zIndex: 99999,
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      Idle: {idleMinutes}m
    </div>
  );
}
