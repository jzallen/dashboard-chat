# Stream Chat Channel Query Returns 400

## Problem

Chat is returning a 400 Bad Request when querying a Stream Chat channel. The app uses the Stream Chat API for real-time messaging, and channel queries are failing.

## Failing Request

```
POST https://chat.stream-io-api.com/channels/messaging/{channel_id}/query
  ?user_id=user_01KH8E8CZ7VGT2ZQJNY1XFAERT
  &connection_id=69ae8477-0a1d-1ba9-0200-0000006fe4ef
  &api_key=6gpzkbh3kv4a

Status: 400 Bad Request
```

Channel ID pattern: `project_{project_id}_{session_id}` (e.g. `project_019ce9c7-0d01-7031-b95b-bcef2a97ddb4_dfa29055-d394-406e-960d-956efec4dbcb`)

## Investigation Areas

1. **Channel ID format** — Is the channel ID too long or containing invalid characters? Stream Chat may have constraints on channel ID length or format.

2. **User token / permissions** — The `user_id` param is present. Check whether the frontend is sending a valid Stream user token. The backend generates these via `STREAM_API_KEY` / `STREAM_API_SECRET` in `backend/app/routers/stream_token.py`.

3. **Channel creation** — Does the channel need to be created before querying? Check if the frontend expects the channel to auto-create on first query or if there's a missing creation step.

4. **Request body** — Inspect the POST body for malformed or missing fields. Stream's `/query` endpoint expects specific parameters (e.g. `state`, `messages`, `members`).

5. **API key / environment** — Verify `STREAM_API_KEY` and `STREAM_API_SECRET` in `.env` are valid and match the Stream app configuration.

## Key Files

- `frontend/src/lib/stream/` — Stream Chat client setup
- `backend/app/routers/stream_token.py` — Token generation endpoint
- `frontend/src/core/chat/` — Chat context and hooks
- `.env` — `STREAM_API_KEY`, `STREAM_API_SECRET`
