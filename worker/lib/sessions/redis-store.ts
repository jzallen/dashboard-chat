import type { Redis } from "ioredis";
import type { SessionMetadata, TurnRecord } from "./types";

const TTL_SECONDS = 2 * 60 * 60; // 2 hours

export class RedisSessionStore {
  constructor(private redis: Redis) {}

  async createSession(sessionId: string, projectId: string, datasetId: string): Promise<SessionMetadata> {
    const now = new Date().toISOString();
    const meta: Record<string, string> = {
      session_id: sessionId,
      project_id: projectId,
      dataset_id: datasetId,
      created_at: now,
      last_write_at: now,
    };

    const pipeline = this.redis.pipeline();
    pipeline.hset(`session:${sessionId}:meta`, meta);
    pipeline.expire(`session:${sessionId}:meta`, TTL_SECONDS);
    pipeline.sadd("sessions:active", sessionId);
    pipeline.sadd(`dataset:${datasetId}:sessions`, sessionId);
    await pipeline.exec();

    return { session_id: sessionId, project_id: projectId, dataset_id: datasetId, created_at: now };
  }

  async appendTurn(sessionId: string, turn: TurnRecord): Promise<number> {
    const now = new Date().toISOString();
    const turnsKey = `session:${sessionId}:turns`;
    const pipeline = this.redis.pipeline();
    pipeline.rpush(turnsKey, JSON.stringify(turn));
    pipeline.expire(turnsKey, TTL_SECONDS);
    pipeline.hset(`session:${sessionId}:meta`, "last_write_at", now);
    pipeline.expire(`session:${sessionId}:meta`, TTL_SECONDS);
    const results = await pipeline.exec();
    // rpush is the first command; its result is [error, newLength]
    const [err, newLength] = results![0];
    if (err) throw err;
    const sequence = newLength as number;

    // Update the stored turn with its correct sequence number
    turn.sequence = sequence;
    await this.redis.lset(turnsKey, sequence - 1, JSON.stringify(turn));

    return sequence;
  }

  async getSession(sessionId: string): Promise<{ meta: SessionMetadata; turns: TurnRecord[] } | null> {
    const meta = await this.redis.hgetall(`session:${sessionId}:meta`);
    if (!meta || !meta.session_id) return null;

    const rawTurns = await this.redis.lrange(`session:${sessionId}:turns`, 0, -1);
    const turns: TurnRecord[] = rawTurns.map(t => JSON.parse(t));

    return {
      meta: {
        session_id: meta.session_id,
        project_id: meta.project_id,
        dataset_id: meta.dataset_id,
        created_at: meta.created_at,
      },
      turns,
    };
  }

  async listSessionIds(datasetId: string): Promise<string[]> {
    return this.redis.smembers(`dataset:${datasetId}:sessions`);
  }

  async getActiveSessionIds(): Promise<string[]> {
    return this.redis.smembers("sessions:active");
  }

  async getLastWriteTime(sessionId: string): Promise<string | null> {
    return this.redis.hget(`session:${sessionId}:meta`, "last_write_at");
  }

  async getStatus(sessionId: string): Promise<string | null> {
    return this.redis.hget(`session:${sessionId}:meta`, "status");
  }

  async getMeta(sessionId: string): Promise<SessionMetadata | null> {
    const meta = await this.redis.hgetall(`session:${sessionId}:meta`);
    if (!meta || !meta.session_id) return null;
    return {
      session_id: meta.session_id,
      project_id: meta.project_id,
      dataset_id: meta.dataset_id,
      created_at: meta.created_at,
    };
  }

  async markFlushed(sessionId: string): Promise<void> {
    const pipeline = this.redis.pipeline();
    // Remove turns (now in S3) and remove from active set
    pipeline.del(`session:${sessionId}:turns`);
    pipeline.srem("sessions:active", sessionId);
    // Mark as flushed and persist the meta (no TTL — lightweight reverse lookup)
    pipeline.hset(`session:${sessionId}:meta`, "status", "flushed");
    pipeline.persist(`session:${sessionId}:meta`);
    await pipeline.exec();
    // Keep dataset:{datasetId}:sessions membership so listSessions still finds it
  }

  async deleteSession(sessionId: string): Promise<void> {
    const datasetId = await this.redis.hget(`session:${sessionId}:meta`, "dataset_id");
    const pipeline = this.redis.pipeline();
    pipeline.del(`session:${sessionId}:meta`);
    pipeline.del(`session:${sessionId}:turns`);
    pipeline.srem("sessions:active", sessionId);
    if (datasetId) {
      pipeline.srem(`dataset:${datasetId}:sessions`, sessionId);
    }
    await pipeline.exec();
  }
}
