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

## Response shape

No response envelope and no pagination convention exist. Controllers return the entity/DTO/array the service produces, serialized directly. If you're adding a list endpoint that could grow large, flag the missing pagination rather than inventing a one-off shape.

## Errors

Standard NestJS HTTP exceptions (`NotFoundException`, `ForbiddenException`, `BadRequestException`, etc.) thrown from services, producing Nest's default `{ statusCode, message, error }` JSON shape. No custom exception filter.

## Auth & ownership

`@UseGuards(JwtAuthGuard)` per route (not global) protects authenticated endpoints; `Authorization: Bearer <token>` required. The authenticated user id is `req.user.sub` (from the JWT payload), passed explicitly into service calls for ownership checks. There is no tenant/business/branch concept — ownership is always a direct per-user check.

> Must reflect the real current standards as implemented, not assumptions.
