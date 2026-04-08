# AI-Generated Session Titles

## Why

The `session-title-management` spec currently sets session titles by truncating the first message to 100 characters. The `chat-first-ui.feature` file has an explicit `# TODO: Auto-generated session titles via AI` at line 152. As users accumulate sessions, the session list fills with truncated first messages like "Show me all customers with reve..." instead of meaningful summaries like "Customer revenue analysis." This makes session navigation difficult.

The LLM infrastructure already exists — Groq with `llama-3.3-70b-versatile` is available in the agent. A lightweight title generation call adds minimal latency and significantly improves the session list UX.

## What Changes

- After the first chat response completes, make an asynchronous LLM call to generate a 5-10 word summary title from the user's first message
- Update the session title via the existing `PATCH /api/projects/{project_id}/sessions/{session_id}` endpoint
- Title generation runs as a background fire-and-forget task — it does not block the chat response
- If the LLM call fails (timeout, rate limit, API error), fall back to the existing truncation behavior
- Title is generated once (on first message) and not regenerated on subsequent messages, consistent with the existing spec

## Capabilities

### Modified Capabilities
- `session-title-management`: Title generation upgrades from truncation to AI-generated summary with truncation fallback

## Impact

- `agent/lib/chat/handleChat.ts` or `agent/lib/chat/titleGenerator.ts` — new lightweight module that takes the first user message and returns a summary title via a non-streaming Groq call
- `agent/index.ts` — after the `/chat` SSE response completes for a new session's first message, fire-and-forget the title generation
- OR: `backend/app/use_cases/session/generate_title.py` — alternative: title generation runs on the backend using the Groq Python SDK
- `features/chat-first-ui.feature` — remove/resolve the TODO comment
- Tests: unit test for title generation with mock LLM response, fallback test for error cases
- No database migrations — session title column already exists
- No frontend changes — session list already reads titles from backend
