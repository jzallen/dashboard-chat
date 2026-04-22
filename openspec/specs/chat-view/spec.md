## Purpose

Describes ChatView — the full-width chat page that hosts both new and resumed chat sessions as the primary authenticated landing surface. It replaces the fixed-sidebar ChatPanel as the main entry point to chat-driven workflows and owns session creation, history rendering, and tool-call execution.

## Requirements

### Requirement: ChatView as Routed Page

The system SHALL provide a full-width ChatView component rendered as a routed page at `/` (new session) and `/chat/:channelId` (resume session). ChatView replaces the fixed ChatPanel sidebar as the primary chat interface.

- ChatView SHALL fill the entire content area of the 2-panel layout (no fixed width constraint).
- ChatView SHALL render a scrollable message history area above and an input area below.
- ChatView SHALL support both new sessions (empty state) and resumed sessions (loaded history).
- ChatView SHALL use the refactored `useChatEngine` hook for SSE streaming, message state, and tool call execution.
- Message history SHALL be sourced from the Stream channel's `channel.state.messages`.

#### Scenario: New session on landing page

- **WHEN** an authenticated user navigates to `/`
- **THEN** the system SHALL render ChatView with an empty message history
- **THEN** the welcome state SHALL be displayed (see Welcome State requirement below)
- **THEN** a new Stream channel SHALL be created with the user's `orgId` as custom data
- **THEN** the URL SHALL update to `/chat/{channelId}` via replace (no history push)

#### Scenario: Resume existing session

- **WHEN** an authenticated user navigates to `/chat/{channelId}`
- **THEN** the system SHALL watch the Stream channel via `client.channel("messaging", channelId).watch()`
- **THEN** the message history SHALL be populated from `channel.state.messages`
- **THEN** the dataset context (if `datasetId` is set in channel custom data) SHALL be restored in the input gutter
- **THEN** the user SHALL be able to continue sending messages in the same channel

---

### Requirement: Welcome State

When a session has no messages, ChatView SHALL display a welcome state with actionable suggestions.

- The welcome state SHALL display a greeting message (e.g., "What would you like to explore?").
- The welcome state SHALL display clickable suggestion chips.
- Suggestion chips SHALL include at minimum: "Upload CSV" and "Browse Projects".
- Clicking "Upload CSV" SHALL trigger the dataset upload workflow within the chat.
- Clicking "Browse Projects" SHALL navigate to `/projects`.
- The welcome state SHALL disappear once the first message is sent.

#### Scenario: User clicks Upload CSV chip

- **WHEN** the user clicks the "Upload CSV" suggestion chip
- **THEN** the system SHALL display a file picker or upload widget inline in the chat
- **THEN** the upload workflow SHALL proceed as defined in the dataset-context-picker spec

#### Scenario: User clicks Browse Projects chip

- **WHEN** the user clicks the "Browse Projects" suggestion chip
- **THEN** the system SHALL navigate to `/projects`

---

### Requirement: Expanding Textarea Input

The ChatView input area SHALL use an auto-expanding textarea that grows with content.

- The textarea SHALL start at a single line height.
- The textarea SHALL expand vertically as text wraps to additional lines.
- The textarea SHALL have a maximum height (e.g., 200px) with overflow scroll beyond that.
- The textarea SHALL submit on Enter (without Shift) and insert a newline on Shift+Enter.
- A fixed gutter below the textarea SHALL display the current dataset context (if any) and action buttons.

#### Scenario: Dataset context displayed in gutter

- **GIVEN** a dataset "Sales Q4" is selected as context for the current session (stored in channel custom data)
- **THEN** the gutter SHALL display "Sales Q4" aligned to the right
- **THEN** clicking the dataset name SHALL allow the user to change or clear the context

#### Scenario: No dataset context

- **GIVEN** no dataset is selected as context (channel custom data has no `datasetId`)
- **THEN** the gutter SHALL not display a dataset name
- **THEN** the gutter MAY display a hint like "No dataset selected"

---

### Requirement: Message Rendering

ChatView SHALL render messages using shared chat components (extracted from the current ChatPanel).

- User messages SHALL be right-aligned with a distinct background color.
- Assistant messages SHALL be left-aligned with a different background color.
- Streaming responses SHALL show a typing indicator until complete.
- Tool call results SHALL be rendered inline (e.g., "Filtered to 42 rows").
- The message list SHALL auto-scroll to the bottom on new messages.
- The message list SHALL preserve scroll position when the user scrolls up.

#### Scenario: New message appended to history

- **GIVEN** ChatView has rendered an existing message history
- **WHEN** a new user or assistant message arrives on the channel
- **THEN** the message SHALL be rendered with role-appropriate alignment and styling
- **AND** the message list SHALL auto-scroll to the bottom if the user was already at the bottom
- **AND** the scroll position SHALL be preserved if the user had scrolled up to read earlier messages

#### Scenario: Assistant response streams with typing indicator

- **WHEN** an assistant response is streaming
- **THEN** a typing indicator SHALL be visible until streaming completes
- **AND** tool call results SHALL be rendered inline alongside the streamed text
