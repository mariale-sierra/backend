import { Logger, OnApplicationShutdown, OnModuleDestroy } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';

type ThrottlerRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Rate-limit storage shared across instances through Redis (B1), failing
 * open to @nestjs/throttler's own in-memory storage — the same one used when
 * REDIS_URL is unset — whenever Redis can't answer. Plain
 * ThrottlerStorageRedisService let a Redis outage reject every throttled
 * request with a 500 after ioredis rode out its retries (10-30s each), and
 * ThrottlerGuard is global. Limits keep being enforced during an outage, per
 * instance instead of shared, and Redis is used again as soon as it is back.
 */
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnModuleDestroy, OnApplicationShutdown
{
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly redis: Redis;
  private readonly shared: ThrottlerStorageRedisService;
  private readonly local = new ThrottlerStorageService();
  private lastErrorLoggedAt = 0;

  constructor(url: string) {
    // Same fail-fast client options as RedisCacheService: without
    // enableOfflineQueue: false a command issued while disconnected waits for
    // every reconnect attempt before failing.
    this.redis = new Redis(url, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      commandTimeout: 1000,
      retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
    });
    this.redis.on('error', (error: Error) => this.logRateLimited(error));
    this.shared = new ThrottlerStorageRedisService(this.redis);
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerRecord> {
    try {
      return await this.shared.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    } catch (error) {
      this.logRateLimited(error);
      return this.local.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
  }

  private logRateLimited(error: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorLoggedAt > 30_000) {
      this.logger.warn(
        `Redis error (rate limiting falls back to in-memory storage): ${error instanceof Error ? error.message : String(error)}`,
      );
      this.lastErrorLoggedAt = now;
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect(false);
  }

  onApplicationShutdown(): void {
    this.local.onApplicationShutdown();
  }
}
