import type { RedisSessionStore } from "./redis-store";
import type { S3SessionStore } from "./s3-store";

const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export class SessionFlusher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private isFlushing = false;

  constructor(
    private redisStore: RedisSessionStore,
    private s3Store: S3SessionStore,
    private intervalMs: number = 60_000,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.flushIdleSessions(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async flushAll(): Promise<void> {
    const activeIds = await this.redisStore.getActiveSessionIds();
    for (const sessionId of activeIds) {
      await this.flushSession(sessionId);
    }
  }

  private async flushIdleSessions(): Promise<void> {
    if (this.isFlushing) return;
    this.isFlushing = true;
    try {
      const activeIds = await this.redisStore.getActiveSessionIds();
      const now = Date.now();

      for (const sessionId of activeIds) {
        try {
          const lastWrite = await this.redisStore.getLastWriteTime(sessionId);
          if (!lastWrite) continue;

          const idleMs = now - new Date(lastWrite).getTime();
          if (idleMs > IDLE_THRESHOLD_MS) {
            await this.flushSession(sessionId);
          }
        } catch (err) {
          console.error(`[flusher] Error flushing session ${sessionId}:`, err);
        }
      }
    } finally {
      this.isFlushing = false;
    }
  }

  private async flushSession(sessionId: string): Promise<void> {
    const data = await this.redisStore.getSession(sessionId);
    if (!data) return;

    const { meta, turns } = data;

    // Skip empty sessions — no S3 write, just clean up Redis
    if (turns.length === 0) {
      await this.redisStore.deleteSession(sessionId);
      console.log(`[flusher] Discarded empty session ${sessionId}`);
      return;
    }

    await this.s3Store.saveSession(
      meta.project_id,
      meta.dataset_id,
      sessionId,
      meta,
      turns,
    );

    await this.redisStore.markFlushed(sessionId);
    console.log(`[flusher] Flushed session ${sessionId} to S3 (${turns.length} turns)`);
  }
}
