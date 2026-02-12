import Redis from "ioredis";
import { S3Client } from "@aws-sdk/client-s3";
import { createS3Client, type S3Config } from "../s3";
import { RedisSessionStore } from "./redis-store";
import { S3SessionStore } from "./s3-store";
import { SessionFlusher } from "./flusher";
import type { ChatSession, ChatTurn, LogTurnRequest, TurnRecord } from "./types";
import { randomUUID } from "crypto";

export interface SessionManagerConfig {
  redisUrl: string;
  s3: S3Config;
}

export class SessionManager {
  private redis!: Redis;
  private redisStore!: RedisSessionStore;
  private s3Store!: S3SessionStore;
  private flusher!: SessionFlusher;
  private s3Client!: S3Client;

  constructor(private config: SessionManagerConfig) {}

  async start(): Promise<void> {
    this.redis = new Redis(this.config.redisUrl);
    this.redisStore = new RedisSessionStore(this.redis);

    this.s3Client = createS3Client(this.config.s3);
    this.s3Store = new S3SessionStore(this.s3Client, this.config.s3.bucket);

    this.flusher = new SessionFlusher(this.redisStore, this.s3Store);
    this.flusher.start();

    console.log("[sessions] Session manager started");
  }

  async stop(): Promise<void> {
    console.log("[sessions] Shutting down — flushing all active sessions...");
    this.flusher.stop();
    await this.flusher.flushAll();
    this.redis.disconnect();
    console.log("[sessions] Session manager stopped");
  }

  async createSession(projectId: string, datasetId: string): Promise<ChatSession> {
    const sessionId = randomUUID();
    const meta = await this.redisStore.createSession(sessionId, projectId, datasetId);

    return {
      id: sessionId,
      project_id: meta.project_id,
      dataset_id: meta.dataset_id,
      turns: [],
      created_at: meta.created_at,
      updated_at: meta.created_at,
    };
  }

  async logTurn(sessionId: string, data: LogTurnRequest): Promise<ChatTurn> {
    const turnId = randomUUID();
    const now = new Date().toISOString();

    // Sequence is assigned atomically by RPUSH return value (new list length)
    const turn: TurnRecord = {
      turn_id: turnId,
      sequence: 0, // placeholder, set after append
      user_message: data.user_message,
      system_prompt: data.system_prompt,
      tool_definitions: data.tool_definitions,
      assistant_content: data.assistant_content,
      tool_calls: data.tool_calls,
      tool_results: data.tool_results,
      table_schema: data.table_schema,
      created_at: now,
    };

    const sequence = await this.redisStore.appendTurn(sessionId, turn);
    turn.sequence = sequence;

    return {
      id: turnId,
      session_id: sessionId,
      sequence,
      user_message: data.user_message,
      system_prompt: data.system_prompt,
      tool_definitions: data.tool_definitions,
      assistant_content: data.assistant_content,
      tool_calls: data.tool_calls,
      tool_results: data.tool_results,
      table_schema: data.table_schema,
      created_at: now,
    };
  }

  async getSession(sessionId: string): Promise<ChatSession | null> {
    const status = await this.redisStore.getStatus(sessionId);

    // Active session — full data in Redis
    if (status !== "flushed") {
      const redisData = await this.redisStore.getSession(sessionId);
      if (!redisData) return null;

      const { meta, turns } = redisData;
      const lastTurn = turns[turns.length - 1];
      return {
        id: sessionId,
        project_id: meta.project_id,
        dataset_id: meta.dataset_id,
        turns: turns.map(t => ({
          id: t.turn_id,
          session_id: sessionId,
          sequence: t.sequence,
          user_message: t.user_message,
          system_prompt: t.system_prompt,
          tool_definitions: t.tool_definitions,
          assistant_content: t.assistant_content,
          tool_calls: t.tool_calls,
          tool_results: t.tool_results,
          table_schema: t.table_schema,
          created_at: t.created_at,
        })),
        created_at: meta.created_at,
        updated_at: lastTurn?.created_at ?? meta.created_at,
      };
    }

    // Flushed session — meta in Redis (reverse lookup), data in S3
    const meta = await this.redisStore.getMeta(sessionId);
    if (!meta) return null;

    return this.s3Store.loadSession(meta.project_id, meta.dataset_id, sessionId);
  }

  async listSessions(datasetId: string): Promise<ChatSession[]> {
    const sessionIds = await this.redisStore.listSessionIds(datasetId);
    const sessions: ChatSession[] = [];

    for (const id of sessionIds) {
      const session = await this.getSession(id);
      if (session) sessions.push(session);
    }

    return sessions.sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }
}

export type { ChatSession, ChatTurn, LogTurnRequest, CreateSessionRequest } from "./types";
