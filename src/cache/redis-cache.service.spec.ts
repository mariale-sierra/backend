import RedisConstructor from 'ioredis';
import { RedisCacheService } from './redis-cache.service';

const mockRedisInstance = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  incr: jest.fn(),
  quit: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
};

jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => mockRedisInstance),
  };
});

describe('RedisCacheService', () => {
  const originalRedisUrl = process.env.REDIS_URL;

  afterEach(() => {
    jest.clearAllMocks();
    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
  });

  describe('when REDIS_URL is not set (Redis disabled)', () => {
    beforeEach(() => {
      delete process.env.REDIS_URL;
    });

    it('reports itself as disabled and never touches the ioredis client', () => {
      const cache = new RedisCacheService();
      expect(cache.isEnabled()).toBe(false);
    });

    it('get() always misses', async () => {
      const cache = new RedisCacheService();
      await expect(cache.get('any-key')).resolves.toBeNull();
    });

    it('getOrSet() falls straight through to the loader and does not cache it', async () => {
      const cache = new RedisCacheService();
      const loader = jest.fn().mockResolvedValue({ value: 42 });
      const result = await cache.getOrSet('key', 60, loader);
      expect(result).toEqual({ value: 42 });
      expect(loader).toHaveBeenCalledTimes(1);
      expect(mockRedisInstance.set).not.toHaveBeenCalled();
    });

    it('set()/del()/bumpVersion() are no-ops (no throw)', async () => {
      const cache = new RedisCacheService();
      await expect(cache.set('k', 'v', 60)).resolves.toBeUndefined();
      await expect(cache.del('k')).resolves.toBeUndefined();
      await expect(cache.bumpVersion('ns')).resolves.toBeUndefined();
      await expect(cache.getVersion('ns')).resolves.toBe(0);
    });
  });

  describe('when REDIS_URL is set (Redis enabled)', () => {
    beforeEach(() => {
      process.env.REDIS_URL = 'redis://localhost:6379';
    });

    it('reports itself as enabled', () => {
      const cache = new RedisCacheService();
      expect(cache.isEnabled()).toBe(true);
    });

    it('disables the offline command queue, so a disconnected Redis fails a request immediately instead of queuing it for a future reconnect', () => {
      // Regression guard: with the offline queue enabled (ioredis's
      // default), a command issued while Redis is down sits queued until
      // `maxRetriesPerRequest` reconnect attempts play out — measured 4-12s
      // per request locally, far worse than just hitting Postgres. Every
      // get()/set() call here must fail fast instead.

      const RedisMock = RedisConstructor as unknown as jest.Mock;
      new RedisCacheService();
      expect(RedisMock).toHaveBeenCalledWith(
        'redis://localhost:6379',
        expect.objectContaining({ enableOfflineQueue: false }),
      );
    });

    it('get() parses a hit and returns null on a miss', async () => {
      const cache = new RedisCacheService();
      mockRedisInstance.get.mockResolvedValueOnce(JSON.stringify({ a: 1 }));
      await expect(cache.get('hit')).resolves.toEqual({ a: 1 });

      mockRedisInstance.get.mockResolvedValueOnce(null);
      await expect(cache.get('miss')).resolves.toBeNull();
    });

    it('getOrSet() returns the cached value on a hit without calling the loader', async () => {
      const cache = new RedisCacheService();
      mockRedisInstance.get.mockResolvedValueOnce(JSON.stringify('cached'));
      const loader = jest.fn().mockResolvedValue('fresh');

      const result = await cache.getOrSet('key', 60, loader);

      expect(result).toBe('cached');
      expect(loader).not.toHaveBeenCalled();
    });

    it('getOrSet() calls the loader and stores the result on a miss', async () => {
      const cache = new RedisCacheService();
      mockRedisInstance.get.mockResolvedValueOnce(null);
      const loader = jest.fn().mockResolvedValue('fresh');

      const result = await cache.getOrSet('key', 60, loader);

      expect(result).toBe('fresh');
      expect(mockRedisInstance.set).toHaveBeenCalledWith(
        'key',
        JSON.stringify('fresh'),
        'EX',
        60,
      );
    });

    it('a Redis error on get() is swallowed and treated as a cache miss', async () => {
      const cache = new RedisCacheService();
      mockRedisInstance.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(cache.get('key')).resolves.toBeNull();
    });

    it('a Redis error during getOrSet() still returns the loader result', async () => {
      const cache = new RedisCacheService();
      mockRedisInstance.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      mockRedisInstance.set.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const loader = jest.fn().mockResolvedValue('fresh-despite-redis-down');

      await expect(cache.getOrSet('key', 60, loader)).resolves.toBe(
        'fresh-despite-redis-down',
      );
    });

    it('getVersion()/bumpVersion() read and increment a per-namespace counter', async () => {
      const cache = new RedisCacheService();
      mockRedisInstance.get.mockResolvedValueOnce('3');
      await expect(cache.getVersion('exercises')).resolves.toBe(3);

      await cache.bumpVersion('exercises');
      expect(mockRedisInstance.incr).toHaveBeenCalledWith('exercises:version');
    });

    it('getVersion() defaults to 0 when the counter was never set', async () => {
      const cache = new RedisCacheService();
      mockRedisInstance.get.mockResolvedValueOnce(null);
      await expect(cache.getVersion('exercises')).resolves.toBe(0);
    });
  });
});
