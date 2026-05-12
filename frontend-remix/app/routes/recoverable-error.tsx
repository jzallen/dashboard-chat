// Remix-style route module for the recoverable-error page (US-003).
//
// Per ADR-031 this lives in `frontend-remix/` alongside (not replacing)
// the existing Vite frontend. Step 02-01 ships only the component shape
// and copy table — wiring this module into the compose stack lands in a
// later step.
//
// The component is pure: it takes the closed-vocabulary cause tag and
// the correlation_id ("reference code" in Maya-facing language) and
// renders the appropriate variant. The reference code is visibly
// rendered so Maya can share it with support without re-typing.

import * as React from "react";

import { COPY_VARIANTS, type UnderlyingCauseTag } from "./copy-variants.ts";

export interface RecoverableErrorProps {
  underlyingCauseTag: UnderlyingCauseTag;
  /** Reference code Maya can share with support (== correlation_id). */
  correlationId: string;
  /** Called when Maya clicks the primary retry CTA. */
  onRetry?: () => void;
}

export function RecoverableError(props: RecoverableErrorProps): React.ReactElement {
  const variant = COPY_VARIANTS[props.underlyingCauseTag];
  return (
    <main aria-labelledby="recoverable-error-title">
      <h1 id="recoverable-error-title">{variant.title}</h1>
      <p>{variant.body}</p>
      <button type="button" onClick={props.onRetry}>
        {variant.cta}
      </button>
      <p>
        <span>Reference code: </span>
        <code>{props.correlationId}</code>
      </p>
    </main>
  );
}

// Default export for Remix-style route resolution.
export default RecoverableError;
