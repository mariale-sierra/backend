import express from 'express';
import helmet from 'helmet';
import request from 'supertest';
import {
  helmetOptions,
  PERMISSIONS_POLICY,
  securityHeadersMiddleware,
} from './security-headers';

describe('security headers', () => {
  const app = express();
  app.use(helmet(helmetOptions));
  app.use(securityHeadersMiddleware);
  app.get('/', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api-docs', (_req, res) => res.send('<html></html>'));

  it('locks the API down: strict CSP with no unsafe-inline', async () => {
    const res = await request(app).get('/');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
  });

  it('only relaxes the CSP for Swagger UI under /api-docs', async () => {
    const res = await request(app).get('/api-docs');
    expect(res.headers['content-security-policy']).toContain(
      "script-src 'self' 'unsafe-inline'",
    );
  });

  it('sets COEP, COOP, CORP and Permissions-Policy', async () => {
    const res = await request(app).get('/');
    expect(res.headers['cross-origin-embedder-policy']).toBe('require-corp');
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(res.headers['permissions-policy']).toBe(PERMISSIONS_POLICY);
  });

  it('marks API responses no-store but not Swagger assets', async () => {
    expect((await request(app).get('/')).headers['cache-control']).toBe(
      'no-store',
    );
    expect(
      (await request(app).get('/api-docs')).headers['cache-control'],
    ).not.toBe('no-store');
  });
});
