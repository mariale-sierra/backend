import { Logger } from '@nestjs/common';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { RedisThrottlerStorage } from './redis-throttler-storage';

// Nothing listens here: connections are refused immediately, like a Redis
// container that is down.
const UNREACHABLE_REDIS = 'redis://127.0.0.1:1';
const TTL = 60_000;

describe('RedisThrottlerStorage', () => {
  let storage: RedisThrottlerStorage;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    storage = new RedisThrottlerStorage(UNREACHABLE_REDIS);
  });

  afterEach(() => {
    storage.onModuleDestroy();
    storage.onApplicationShutdown();
    jest.restoreAllMocks();
  });

  // Regression (BUG-02): with REDIS_URL set and Redis down, every throttled
  // request failed with a 500 after 10-30s of ioredis retries.
  it('keeps rate limiting in memory, fast, when Redis is unreachable', async () => {
    const started = Date.now();
    const hits: Array<{ totalHits: number; isBlocked: boolean }> = [];
    for (let i = 0; i < 3; i += 1) {
      hits.push(await storage.increment('ip-1', TTL, 2, TTL, 'default'));
    }

    expect(Date.now() - started).toBeLessThan(1000);
    expect(hits.map((h) => h.totalHits)).toEqual([1, 2, 3]);
    expect(hits.map((h) => h.isBlocked)).toEqual([false, false, true]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('falls back to in-memory storage'),
    );
  });

  it('counts each key separately in the fallback', async () => {
    await storage.increment('ip-1', TTL, 10, TTL, 'default');
    await storage.increment('ip-1', TTL, 10, TTL, 'default');

    const otherIp = await storage.increment('ip-2', TTL, 10, TTL, 'default');

    expect(otherIp.totalHits).toBe(1);
  });

  it('uses the shared Redis counter whenever Redis answers', async () => {
    const shared = {
      totalHits: 7,
      timeToExpire: 30,
      isBlocked: false,
      timeToBlockExpire: 0,
    };
    const increment = jest
      .spyOn(ThrottlerStorageRedisService.prototype, 'increment')
      .mockResolvedValue(shared);

    await expect(
      storage.increment('ip-1', TTL, 10, TTL, 'default'),
    ).resolves.toEqual(shared);
    expect(increment).toHaveBeenCalledWith('ip-1', TTL, 10, TTL, 'default');
  });

  it('goes back to Redis once it recovers', async () => {
    const shared = {
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    };
    jest
      .spyOn(ThrottlerStorageRedisService.prototype, 'increment')
      .mockRejectedValueOnce(new Error('Connection is closed.'))
      .mockResolvedValueOnce(shared);

    const duringOutage = await storage.increment('ip-1', TTL, 10, TTL, 'd');
    const afterRecovery = await storage.increment('ip-1', TTL, 10, TTL, 'd');

    expect(duringOutage.totalHits).toBe(1);
    expect(afterRecovery).toBe(shared);
  });

  it('logs the outage at most once per 30s instead of on every request', async () => {
    jest
      .spyOn(ThrottlerStorageRedisService.prototype, 'increment')
      .mockRejectedValue(new Error('Connection is closed.'));
    warn.mockClear();

    for (let i = 0; i < 5; i += 1) {
      await storage.increment('ip-1', TTL, 100, TTL, 'default');
    }

    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
