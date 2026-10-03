import type { NextFunction, Request, Response } from 'express';
import type { HelmetOptions } from 'helmet';

/**
 * Swagger UI is the only HTML this server serves, and it needs inline
 * scripts/styles to boot. Everything else is a JSON API that never renders
 * a document, so it gets a lockdown CSP (nothing may load or frame it).
 * Keeping the relaxed policy scoped to /api-docs lets us drop
 * 'unsafe-inline' from every other response.
 */
const isSwaggerPath = (req: { url?: string }) =>
  req.url?.startsWith('/api-docs') ?? false;

const swaggerOr = (swagger: string, api: string) => (req: Request) =>
  isSwaggerPath(req) ? swagger : api;

export const helmetOptions: HelmetOptions = {
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      'default-src': ["'none'"],
      'script-src': [swaggerOr("'self' 'unsafe-inline'", "'none'")],
      'style-src': [swaggerOr("'self' 'unsafe-inline'", "'none'")],
      'img-src': [
        swaggerOr("'self' data: https://validator.swagger.io", "'none'"),
      ],
      'font-src': [swaggerOr("'self' data:", "'none'")],
      'connect-src': [swaggerOr("'self'", "'none'")],
      'frame-ancestors': ["'none'"],
      'form-action': ["'none'"],
      'base-uri': ["'none'"],
      'object-src': ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: { policy: 'require-corp' },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'no-referrer' },
};

/**
 * Helmet has no Permissions-Policy support. The API never needs any browser
 * capability, so every one we know of is switched off.
 */
export const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=()',
  'camera=()',
  'display-capture=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'publickey-credentials-get=()',
  'usb=()',
  'xr-spatial-tracking=()',
].join(', ');

/**
 * Permissions-Policy on every response, and Cache-Control: no-store on all
 * API responses (they carry personal data and bearer-token-gated content, so
 * no shared cache or browser should keep them). Swagger's static assets are
 * public and harmless to cache, so /api-docs is left alone.
 */
export function securityHeadersMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
  if (!isSwaggerPath(req)) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
}
