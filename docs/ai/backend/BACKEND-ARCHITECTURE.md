# BACKEND-ARCHITECTURE

## Purpose

How the backend is layered: the flat module structure, the controller→service→TypeORM-repository→entity flow, DTOs, and where cross-cutting pieces (auth guards, config) live.

## When to read

Before any non-trivial backend change, after the general ARCHITECTURE.

## Keep updated

- When layering, a cross-cutting concern, or a core dependency changes.

## Stack

NestJS 11, TypeScript, `@nestjs/typeorm` + TypeORM 0.3 + `pg`, `@nestjs/passport` + `passport-jwt` + `bcrypt`, `@nestjs/swagger`, `class-validator`/`class-transformer`, `@aws-sdk/client-s3`, `openai`.

## Module anatomy

Every module under `src/<module>/` follows:
```
<module>.module.ts       # @Module: imports (incl. TypeOrmModule.forFeature([...entities])), controllers, providers, exports
<module>.controller.ts   # routes, guards, Swagger decorators; delegates to the service
<module>.service.ts      # business logic; injects Repository<Entity> via @InjectRepository
dto/                      # create-x.dto.ts / update-x.dto.ts, class-validator decorated
entities/                 # TypeORM @Entity() classes, one file per table (kebab-case, e.g. challenge-user-map.entity.ts)
```
No `use-cases/`, `mappers/`, `repositories/`, or shared `common/` folder exists. Cross-module reuse is done by importing the other module and injecting its exported service (e.g. `ChallengesModule` imports `WorkoutLogModule` and `ChallengesController` calls `WorkoutLogService` directly for progress endpoints).

## Request lifecycle

Request → `JwtAuthGuard` (applied per-route via `@UseGuards(JwtAuthGuard)`, not globally) → global `ValidationPipe` (`whitelist: true, forbidNonWhitelisted: true, transform: true`, registered in `main.ts`) → controller method → service method (often receiving `req.user.sub` as the acting user id) → `Repository<Entity>` calls → Postgres. The controller returns whatever the service returns, serialized as-is by Nest's default JSON serializer — there is no interceptor, no envelope, no pagination metadata.

## Auth & ownership

- `JwtAuthGuard` (`src/auth/guards/jwt-auth.guard.ts`) is the only guard in the codebase.
- `POST /auth/login` and `POST /auth/register` issue a JWT; `GET /auth/me` returns the decoded user from the guard.
- Ownership is enforced by passing `req.user.sub` into service methods and having the service check/scope by it (e.g. `challengesService.create(dto, req.user.sub)`, `.joinChallenge(req.user.sub, challengeId)`). There is no separate ownership-guard/decorator abstraction and no tenancy concept.

## Config & bootstrap

- `src/app.module.ts`: `ConfigModule.forRoot({ isGlobal: true })`, `TypeOrmModule.forRoot({ ... schema: 'havit', synchronize: false, ssl: { rejectUnauthorized: false } })`, then imports every feature module.
- `src/main.ts`: creates the Nest app, builds the Swagger document (`DocumentBuilder`, tags matching each module, `addBearerAuth()`), serves it at `/api-docs`, registers the global `ValidationPipe`, listens on `process.env.PORT ?? 3000`.
- `src/data-source.ts`: a standalone TypeORM `DataSource` used only by the legacy `npm run migration:*` CLI scripts — frozen, not used at runtime by the app itself (`app.module.ts` configures its own `TypeOrmModule.forRoot` independently).

> Must reflect the real current backend, not assumptions.
