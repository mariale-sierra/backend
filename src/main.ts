// Must be first: pins the process to UTC before any Date/DB work. See file.
import './set-timezone';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { isSwaggerEnabled, resolveCorsOrigin } from './config/http-config';
import { resolveTrustProxy } from './config/trust-proxy';
import {
  helmetOptions,
  securityHeadersMiddleware,
} from './config/security-headers';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Swagger's "servers" entry. Unset = same origin as the page, so it works
  // both behind Caddy (https) and on a local http dev server.
  const publicApiUrl = process.env.PUBLIC_API_URL ?? '/';

  // Behind Caddy (B3) req.ip must be the real client, or the throttler puts
  // every user in one bucket. Only the hops listed in TRUST_PROXY are
  // believed — see config/trust-proxy.ts.
  app.set('trust proxy', resolveTrustProxy(process.env));

  // CSP / COEP / COOP / CORP live in config/security-headers.ts; Permissions-
  // Policy and Cache-Control come from securityHeadersMiddleware (helmet has
  // no support for either).
  app.use(helmet(helmetOptions));
  app.use(securityHeadersMiddleware);

  // The mobile client (Expo/React Native) is not a browser and isn't subject
  // to CORS at all — this only matters for browser-based callers (Swagger UI,
  // a future web client). CORS_ORIGINS is a comma-separated allow-list; with
  // nothing configured we reflect the request origin (permissive but
  // explicit) rather than disabling the check entirely.
  // Allow-list only (see config/http-config.ts): with nothing configured CORS is off.
  app.enableCors({
    origin: resolveCorsOrigin(process.env),
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Timezone'],
    // Without this, a browser-based caller (Swagger UI, a future web client)
    // can't read X-Next-Cursor via the fetch/XHR Headers API even though the
    // header is on the wire — CORS hides non-"simple" response headers from
    // JS by default. The mobile client is unaffected either way (not
    // subject to CORS).
    exposedHeaders: ['X-Next-Cursor'],
  });
  // Swagger (UI + /api-docs-json) is a developer tool: only when ENABLE_SWAGGER=true.
  if (isSwaggerEnabled(process.env)) {
    const config = new DocumentBuilder()
      .setTitle('Havit - Fitness API')
      .setDescription(
        'API completa para la aplicación de fitness Havit. Incluye endpoints para autenticación, usuarios, rutinas, ejercicios, desafíos y tracking de entrenamientos.',
      )
      .setVersion('1.0')
      .addServer(publicApiUrl)
      .addTag('Auth', 'Endpoints de autenticación y login')
      .addTag('Users', 'Endpoints para gestionar usuarios y perfiles')
      .addTag('Challenges', 'Endpoints para gestionar desafíos')
      .addTag('Exercises', 'Endpoints para gestionar ejercicios')
      .addTag('Routine', 'Endpoints para gestionar rutinas')
      .addTag('Metrics', 'Endpoints para gestionar métricas')
      .addTag('Workout Logs', 'Endpoints para registrar entrenamientos')
      .addTag('Feed', 'Feed público de publicaciones')
      .addTag('Follows', 'Endpoints para seguir/dejar de seguir usuarios')
      .addTag(
        'Workout Post Reactions',
        'Reacciones (likes) sobre publicaciones',
      )
      .addTag('Workout Post Comments', 'Comentarios sobre publicaciones')
      .addTag('Badges', 'Badges de actividad calculados al vuelo')
      .addTag('Notifications', 'Bandeja, preferencias y tokens push (B3)')
      .addTag('Health', 'Sondas de salud para Docker, deploy y monitoreo (B6)')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api-docs', app, document);
  }
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
