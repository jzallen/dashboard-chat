/**
 * @deprecated Import from `lib/api/chatClient` instead.
 * This file is a re-export shim maintained for backward compatibility during migration.
 */

export type {
  ChatSession,
  ChatTurn,
  ChatTurnPayload,
  ToolResult,
} from "./chatClient";
export {
  createSession,
  getSession,
  listSessions,
  logTurn,
} from "./chatClient";
