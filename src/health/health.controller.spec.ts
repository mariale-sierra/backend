import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import type { ReadinessReport } from './health.service';
import { RedisCacheService } from '../cache/redis-cache.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { securityHeadersMiddleware } from '../config/security-headers';

describe('HealthController (B6)', () => {
  let app: INestApplication;
  const dataSource = { query: jest.fn() };
  const cache = { ping: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      // limit 1: any second request inside the window would be a 429 if the
      // controller weren't @SkipThrottle().
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1 }])],
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: DataSource, useValue: dataSource },
        { provide: RedisCacheService, useValue: cache },
        // The real global guards: no token is sent in any test below. Only
        // the Reflector matters to JwtAuthGuard on a @Public() route (it
        // returns before touching JWT/config/DB).
        {
          provide: APP_GUARD,
          useFactory: (reflector: Reflector) =>
            new JwtAuthGuard(null as any, null as any, reflector, null as any),
          inject: [Reflector],
        },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(securityHeadersMiddleware);
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => {
    dataSource.query.mockReset().mockResolvedValue([{ '?column?': 1 }]);
    cache.ping.mockReset().mockResolvedValue('up');
  });

  it('GET /health answers 200 without a token, without touching the DB, and is not cacheable', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      uptimeSeconds: expect.any(Number) as number,
    });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(dataSource.query).not.toHaveBeenCalled();
    expect(cache.ping).not.toHaveBeenCalled();
  });

  it('is exempt from the rate limit (repeated probes never get 429)', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).get('/health').expect(200);
    }
  });

  it('GET /health/ready answers 200 when Postgres answers SELECT 1', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('GET /health/ready answers 503 when Postgres is down', async () => {
    dataSource.query.mockRejectedValue(new Error('connection refused'));
    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);
    expect((res.body as ReadinessReport).checks.database).toBe('down');
  });

  it('a down or disabled Redis does not make the API not-ready (cache fails open)', async () => {
    cache.ping.mockResolvedValue('down');
    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'down' },
    });
  });

  it('a hung Postgres is reported down after the timeout instead of hanging the probe', async () => {
    jest.useFakeTimers();
    try {
      dataSource.query.mockReturnValue(new Promise(() => undefined));
      const service = app.get(HealthService);
      const pending = service.readiness();
      jest.advanceTimersByTime(2000);
      await expect(pending).resolves.toMatchObject({
        status: 'error',
        checks: { database: 'down' },
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
