# ARCHITECTURE

## Purpose

Describe how `backend/` is structured and *why*, so changes respect the existing design instead of fighting it.

## When to read

At the start of any non-trivial task, right after INDEX.

## Keep updated

- When a structural pattern, layer, or boundary is added or changed.
- When a major dependency or framework choice changes.

## Tech stack

- NestJS 11 + TypeScript, `@nestjs/typeorm` + TypeORM 0.3 + `pg` against PostgreSQL.
- Auth: `@nestjs/passport` + `passport-jwt`, `bcrypt` for password hashing.
- Docs: `@nestjs/swagger`, served at `/api-docs`, snapshot checked in at `backend/swagger.json`.
- Uploads: `@aws-sdk/client-s3` (Cloudflare R2/S3-compatible storage), images stored as URLs, never as blobs in Postgres.
- `openai` SDK for content moderation of workout posts.
- Validation: `class-validator`/`class-transformer` via a global `ValidationPipe`.
- Lint/format: ESLint (`typescript-eslint` recommended-type-checked) + Prettier.
- Test: Jest (unit) + a separate `test/jest-e2e.json` config for e2e.

## High-level structure

Flat, module-per-domain under `src/`, **not** a layered DDD structure:

```
src/<module>/
  <module>.module.ts
  <module>.controller.ts
  <module>.service.ts
  dto/
  entities/
```

Modules today: `auth`, `users`, `challenges`, `exercises`, `routine`, `workout-log`, `metrics`, `workout-posts`, `uploads`, `openai`. There is no `use-cases/`, `mappers/`, `repositories/`, or shared `common/` folder — services call TypeORM repositories directly via `@InjectRepository(...)`.

`app.module.ts` wires every feature module together and configures `TypeOrmModule.forRoot` directly (not per-module config), with `autoLoadEntities: true` and Postgres `schema: 'havit'`.

## Key patterns & boundaries

- **Request flow:** route → `JwtAuthGuard` (where applied) → global `ValidationPipe` (DTO validation/transform, `whitelist + forbidNonWhitelisted`) → controller → service → TypeORM repository → DB. Response is the raw service return value — **no response envelope, no interceptor wrapping, no pagination convention**.
- **Ownership, not tenancy:** there is no multi-tenant business/branch concept. `JwtAuthGuard` authenticates; the JWT payload's `sub` (`req.user.sub`) is the user id, threaded explicitly into service calls (e.g. `challengesService.joinChallenge(req.user.sub, challengeId)`), and services enforce per-user ownership themselves.
- **Schema is not TypeORM-managed.** `synchronize: false`. The database is the source of truth, versioned as raw SQL under `backend/database/` and applied by a custom runner (see `docs/ai/db/`) — not by TypeORM's migration CLI (`src/migrations/*.migration.ts`, `npm run migration:*`), which is legacy/frozen.

## External dependencies & integrations

- **Database:** Azure Database for PostgreSQL, schema `havit` (shared, remote — not something to run/reset locally).
- **Object storage:** Cloudflare/S3-compatible, via signed URLs (`uploads` module) — the frontend PUTs directly to the signed URL.
- **OpenAI:** content moderation for workout posts (`openai` module → `workout-posts`).
- **Frontend:** `frontend/` (separate repo) is the only consumer of this API; see `docs/ai/backend/BACKEND-INTEGRATION-GUIDE.md`.

## Non-goals / constraints

- No multi-tenancy / business-branch model (unlike some other NestJS boilerplates this project was seeded from).
- No response envelope or pagination convention has been introduced — don't add one to a single endpoint unilaterally.
- No `common/` cross-cutting folder exists yet — don't create one speculatively for a single use.

> This document must reflect the real current codebase, not assumptions.
