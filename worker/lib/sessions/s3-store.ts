import type { S3Client } from "@aws-sdk/client-s3";
import { putSessionLog, getSessionLog, listSessionLogs } from "../s3";
import type { SessionMetadata, TurnRecord, SessionEvent, SessionStartEvent, TurnEvent, ChatSession, ChatTurn } from "./types";

export class S3SessionStore {
  constructor(
    private client: S3Client,
    private bucket: string,
  ) {}

  async saveSession(
    projectId: string,
    datasetId: string,
    sessionId: string,
    meta: SessionMetadata,
    turns: TurnRecord[],
  ): Promise<void> {
    const lines: string[] = [];

    // Session start event
    const startEvent: SessionStartEvent = {
      event: "session_start",
      session_id: sessionId,
      project_id: projectId,
      dataset_id: datasetId,
      created_at: meta.created_at,
    };
    lines.push(JSON.stringify(startEvent));

    // Turn events
    for (const turn of turns) {
      const turnEvent: TurnEvent = {
        event: "turn",
        sequence: turn.sequence,
        turn_id: turn.turn_id,
        user_message: turn.user_message,
        system_prompt: turn.system_prompt,
        tool_definitions: turn.tool_definitions,
        assistant_content: turn.assistant_content,
        tool_calls: turn.tool_calls,
        tool_results: turn.tool_results,
        table_schema: turn.table_schema,
        created_at: turn.created_at,
      };
      lines.push(JSON.stringify(turnEvent));
    }

    await putSessionLog(this.client, this.bucket, projectId, datasetId, sessionId, lines.join("\n") + "\n");
  }

  async loadSession(projectId: string, datasetId: string, sessionId: string): Promise<ChatSession | null> {
    const content = await getSessionLog(this.client, this.bucket, projectId, datasetId, sessionId);
    if (!content) return null;

    const events: SessionEvent[] = content
      .trim()
      .split("\n")
      .filter(line => line.trim())
      .map(line => JSON.parse(line));

    const startEvent = events.find((e): e is SessionStartEvent => e.event === "session_start");
    if (!startEvent) return null;

    const turns: ChatTurn[] = events
      .filter((e): e is TurnEvent => e.event === "turn")
      .map(e => ({
        id: e.turn_id,
        session_id: sessionId,
        sequence: e.sequence,
        user_message: e.user_message,
        system_prompt: e.system_prompt,
        tool_definitions: e.tool_definitions,
        assistant_content: e.assistant_content,
        tool_calls: e.tool_calls,
        tool_results: e.tool_results,
        table_schema: e.table_schema,
        created_at: e.created_at,
      }));

    const lastTurn = turns[turns.length - 1];

    return {
      id: sessionId,
      project_id: startEvent.project_id,
      dataset_id: startEvent.dataset_id,
      turns,
      created_at: startEvent.created_at,
      updated_at: lastTurn?.created_at ?? startEvent.created_at,
    };
  }

  async listSessions(projectId: string, datasetId: string): Promise<ChatSession[]> {
    const sessionIds = await listSessionLogs(this.client, this.bucket, projectId, datasetId);
    const sessions: ChatSession[] = [];

    for (const id of sessionIds) {
      const session = await this.loadSession(projectId, datasetId, id);
      if (session) sessions.push(session);
    }

    return sessions;
  }
}
