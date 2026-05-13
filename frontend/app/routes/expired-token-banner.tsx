// Remix-style component module for the ExpiredTokenBanner (US-005).
//
// Per ADR-031 this lives in `ui-presentation/` alongside (not replacing)
// the existing Vite frontend. Step 03-01 ships only the component shape —
// wiring this into the live projection-subscription stream lands in a
// later step (the UI-2 ticket referenced in DI-1).
//
// The banner is intentionally non-blocking: it carries `role="status"`
// and `aria-live="polite"` so screen readers announce the renewal
// without stealing keyboard focus. Maya keeps typing; the banner appears
// and clears underneath.
//
// Visibility contract:
//   - projection.state === "expired_token" → banner renders
//   - any other projection state → banner is omitted from the DOM

import * as React from "react";

export interface ExpiredTokenBannerProps {
  /** Current projection state. Banner is shown when this equals
   *  `"expired_token"`; any other value renders nothing. */
  projectionState: string;
}

export function ExpiredTokenBanner(
  props: ExpiredTokenBannerProps,
): React.ReactElement | null {
  if (props.projectionState !== "expired_token") return null;
  return (
    <div role="status" aria-live="polite">
      <span>Refreshing your session...</span>
    </div>
  );
}

export default ExpiredTokenBanner;
