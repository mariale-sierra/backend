# API-STANDARDS

## Purpose

The cross-cutting rules every endpoint should follow so the API stays consistent.

## When to read

Before adding or changing any endpoint.

## Keep updated

- When a cross-cutting API standard changes.

## Routing & naming

- Plural resource nouns for base routes (`/challenges`, `/exercises`, `/workout-logs`), kebab-case for multi-word resources.
- Sub-actions/sub-resources as path segments off the id: `challenges/:id/join`, `challenges/:id/leave`, `challenges/:id/cycle-days/:dayInCycle`.
- No global prefix, no API versioning (`/v1/...`) — everything is mounted at the route root.

## HTTP methods & status codes

- `GET` for reads, `POST` for creation and state-changing actions without a natural PATCH target (`join`, `progress`), `PATCH` for partial updates and status transitions (`leave`, `complete`, `finish`), `DELETE` for deletion. No `PUT` usage observed.
- Default Nest status codes are used as-is (201 for `POST`, 200 otherwise, 404/400/401/403 via thrown exceptions) — no custom status-code overriding pattern.

## Request validation

- DTOs live in each module's `dto/` folder, decorated with `class-validator`. The global `ValidationPipe` (`whitelist: true, forbidNonWhitelisted: true, transform: true`) means **any field not declared on the DTO is stripped or the request is rejected** — always declare every field the endpoint should accept.
- Path params use `ParseIntPipe`/`ParseUUIDPipe` as appropriate (ids are a mix of `BIGINT` and `UUID` depending on the table — check `docs/ai/db/TABLES-GUIDE.md`).
- As of Fase 5, every endpoint with a body has a typed DTO — the previously-untyped `POST /exercises` (`CreateExerciseDto`), `POST /routine` (`CreateRoutineDto`), `POST /routine/:id/exercises` (`AddRoutineExerciseDto`), and `POST /metrics/workout-log-exercises/:id` (`AddMetricDto`) were the last ones (`@Body() body: any`/inline object types) and are now covered. `CreateRoutineDto.createdByUserId` is intentionally accepted-but-ignored (optional, `@IsUUID`) — the owner always comes from the JWT in `RoutineService.create`; it exists only so the frontend's current payload (which still sends this field) doesn't 400 under `forbidNonWhitelisted`.
- `CreateChallengeDto` still declares `categories`/`locations`/`cycle_days` as `any[]` that `ChallengesService.create` does not persist. This looks like dead-field cleanup at first glance, but **do not remove them** — `frontend/services/adapters/createChallengePayloadAdapter.ts` actively sends all three on every real `POST /challenges` request; removing them from the DTO would make `forbidNonWhitelisted` reject every challenge creation from the app. Treat this as a cross-repo item (either implement category/location/cycle-day persistence backend-side, or have the frontend stop sending them) — not something to change unilaterally in a backend-only pass.

## Response shape

No response envelope and no pagination convention exist. Controllers return the entity/DTO/array the service produces, serialized directly. If you're adding a list endpoint that could grow large, flag the missing pagination rather than inventing a one-off shape.

## Errors

Standard NestJS HTTP exceptions (`NotFoundException`, `ForbiddenException`, `BadRequestException`, etc.) thrown from services. A global `HttpExceptionFilter` (`src/common/filters/http-exception.filter.ts`, registered as `APP_FILTER`) turns every thrown exception — including unhandled ones — into the standard shape `{ statusCode, error, message, code?, timestamp, path }`. See `ERROR-HANDLING.md` for the full shape and the `code` catalog.

## Logging

A global `LoggingInterceptor` (`src/common/interceptors/logging.interceptor.ts`, registered as `APP_INTERCEPTOR`) logs one line per request (method, path, status, duration) via Nest's `Logger`. It never logs request bodies.

## Auth & ownership

`@UseGuards(JwtAuthGuard)` per route (not global) protects authenticated endpoints; `Authorization: Bearer <token>` required. The authenticated user id is `req.user.sub` (from the JWT payload), passed explicitly into service calls for ownership checks. There is no tenant/business/branch concept — ownership is always a direct per-user check.

> Must reflect the real current standards as implemented, not assumptions.
