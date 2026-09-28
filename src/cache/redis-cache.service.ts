import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Thin Redis wrapper used as an optional read-through cache — never the
 * source of truth. Every method fails open: if REDIS_URL isn't set, or Redis
 * is unreachable, get()/getVersion() return a value that reads as "cache
 * miss" and set()/del()/bumpVersion() are no-ops, so a caller that always
 * falls back to Postgres on a miss keeps working with Redis absent or down.
 * Errors are logged (rate-limited to avoid spamming logs while Redis is
 * down), never thrown to the caller.
 */
@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly client: Redis | null;
  private lastErrorLoggedAt = 0;

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.warn(
        'REDIS_URL is not set — caching is disabled, every read falls through to Postgres.',
      );
      this.client = null;
      return;
    }

    this.client = new Redis(url, {
      lazyConnect: false,
      // A slow/unreachable Redis must never turn into a slow API response.
      // enableOfflineQueue: false is the important one — without it, ioredis
      // queues commands issued while disconnected and only rejects them
      // after riding out `maxRetriesPerRequest` reconnect attempts (each
      // paced by retryStrategy's backoff), which measured 4-12s per request
      // in practice with Redis down — far worse than just hitting Postgres.
      // With it, a command issued while disconnected fails immediately.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
    });
    this.client.on('error', (error: Error) => this.logRateLimited(error));
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  private logRateLimited(error: Error): void {
    const now = Date.now();
    if (now - this.lastErrorLoggedAt > 30_000) {
      this.logger.warn(
        `Redis error (cache falls back to source of truth): ${error.message}`,
      );
      this.lastErrorLoggedAt = now;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client) return null;
    try {
      const raw = await this.client.get(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch (error) {
      this.logRateLimited(error as Error);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logRateLimited(error as Error);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!this.client || keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch (error) {
      this.logRateLimited(error as Error);
    }
  }

  /**
   * Cache-version helpers: a per-namespace counter embedded in every cache
   * key of that namespace (e.g. `exercises:v3:findAll:...`). Bumping it
   * invalidates every key in the namespace at once — including
   * parameter-combination keys that would otherwise be impractical to
   * enumerate and delete individually (Redis has no cheap "delete by
   * prefix") — without ever needing a KEYS/SCAN sweep. Old entries simply
   * age out of Redis via their own TTL. Returns 0 when Redis is disabled or
   * unreachable, which callers treat as version "0" — safe, just means the
   * bump is a no-op and keys keep whatever TTL-bounded staleness they'd have
   * anyway.
   */
  async getVersion(namespace: string): Promise<number> {
    if (!this.client) return 0;
    try {
      const raw = await this.client.get(`${namespace}:version`);
      return raw ? parseInt(raw, 10) : 0;
    } catch (error) {
      this.logRateLimited(error as Error);
      return 0;
    }
  }

  async bumpVersion(namespace: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.incr(`${namespace}:version`);
    } catch (error) {
      this.logRateLimited(error as Error);
    }
  }

  /** Read-through helper: cache hit returns as-is; a miss calls `loader`, caches, and returns it. */
  async getOrSet<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const fresh = await loader();
    await this.set(key, fresh, ttlSeconds);
    return fresh;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => undefined);
    }
  }
}
