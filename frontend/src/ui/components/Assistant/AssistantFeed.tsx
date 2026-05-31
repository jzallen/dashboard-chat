// AssistantFeed — the shared chat feed for the assistant overlay/terminal (MR-4).
//
// RED scaffold (created by DISTILL). A pure presentation reshell: it consumes the
// EXISTING ChatProvider context (messages / input / handleSubmit / isLoading /
// chatEndRef) and reuses the existing MessageList + ChatInput. Both the light glass
// overlay and the dark TUI terminal render THIS same feed, so the chat wire /
// ui-state transport is untouched (saved-feedback constraint, path-forward §4.4).
export const __SCAFFOLD__ = true;

export function AssistantFeed(): JSX.Element {
  throw new Error("Not yet implemented — RED scaffold (Assistant MR-4)");
}

export default AssistantFeed;
