import { Controller, Get } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { resolveTrustProxy } from './trust-proxy';

describe('resolveTrustProxy', () => {
  it('trusts nothing unless configured', () => {
    expect(resolveTrustProxy({})).toBe(false);
    expect(resolveTrustProxy({ TRUST_PROXY: '' })).toBe(false);
    expect(resolveTrustProxy({ TRUST_PROXY: 'false' })).toBe(false);
    expect(resolveTrustProxy({ TRUST_PROXY: '0' })).toBe(false);
  });

  it('accepts a hop count or an address list', () => {
    expect(resolveTrustProxy({ TRUST_PROXY: '1' })).toBe(1);
    expect(
      resolveTrustProxy({ TRUST_PROXY: 'loopback, uniquelocal ,10.0.0.0/8' }),
    ).toEqual(['loopback', 'uniquelocal', '10.0.0.0/8']);
  });

  it('refuses to trust every hop', () => {
    expect(() => resolveTrustProxy({ TRUST_PROXY: 'true' })).toThrow(
      /X-Forwarded-For/,
    );
  });
});

@Controller()
class IpController {
  @Get()
  ok() {
    return { ok: true };
  }
}

// The real ThrottlerGuard keyed by req.ip, as in AppModule, with a limit of 2.
// supertest connects from 127.0.0.1, which stands in for Caddy.
async function appWith(trustProxy: string | undefined) {
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 2 }])],
    controllers: [IpController],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.set('trust proxy', resolveTrustProxy({ TRUST_PROXY: trustProxy }));
  await app.init();
  return app;
}

const hit = (app: NestExpressApplication, xff?: string) => {
  const req = request(app.getHttpServer()).get('/');
  return (xff ? req.set('X-Forwarded-For', xff) : req).then((r) => r.status);
};

describe('throttler behind the proxy', () => {
  let app: NestExpressApplication;
  afterEach(() => app?.close());

  it('gives each client its own bucket when the proxy hop is trusted', async () => {
    app = await appWith('loopback,uniquelocal');
    expect(await hit(app, '203.0.113.1')).toBe(200);
    expect(await hit(app, '203.0.113.1')).toBe(200);
    expect(await hit(app, '203.0.113.1')).toBe(429);
    // Another user behind the same proxy is not affected.
    expect(await hit(app, '203.0.113.2')).toBe(200);
  });

  it('cannot be dodged by prepending fake X-Forwarded-For entries', async () => {
    app = await appWith('loopback,uniquelocal');
    // The proxy appends the real peer last; the left entries are the client's.
    expect(await hit(app, '1.1.1.1, 203.0.113.9')).toBe(200);
    expect(await hit(app, '8.8.8.8, 203.0.113.9')).toBe(200);
    expect(await hit(app, '9.9.9.9, 203.0.113.9')).toBe(429);
  });

  it('ignores X-Forwarded-For entirely when no proxy is trusted', async () => {
    app = await appWith(undefined);
    expect(await hit(app, '203.0.113.1')).toBe(200);
    expect(await hit(app, '203.0.113.2')).toBe(200);
    // Same 127.0.0.1 bucket regardless of the header.
    expect(await hit(app, '203.0.113.3')).toBe(429);
  });
});
