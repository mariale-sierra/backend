# CONVENTIONS

## Purpose

The coding conventions for `backend/`, so new code reads like the existing code and stays consistent.

## When to read

Before writing or editing code here.

## Keep updated

- When a convention is adopted, changed, or retired.

## Naming

- Files: kebab-case, suffixed by role — `<name>.module.ts`, `<name>.controller.ts`, `<name>.service.ts`, `<name>.entity.ts`, `create-<name>.dto.ts`, `update-<name>.dto.ts`.
- Routes: plural resource nouns, kebab-case for multi-word (`workout-logs`, `workout-posts`), nested sub-resources as path segments (`challenges/:id/join`, `challenges/:id/cycle-days/:dayInCycle`).
- DTOs: one class per request shape, in the module's `dto/` folder, validated with `class-validator` decorators.

## Structure & organization

- One folder per domain under `src/`: `<module>.module.ts` + `<module>.controller.ts` + `<module>.service.ts` + `dto/` + `entities/`. No `use-cases/`, `mappers/`, or `repositories/` — services inject TypeORM repositories directly via `@InjectRepository`.
- Cross-module reuse happens by importing the other module and injecting its service (e.g. `ChallengesModule` imports `WorkoutLogModule` and injects `WorkoutLogService`), not by duplicating logic.
- New DB-owning code belongs entirely inside the module it's about (module/controller/service/dto/entities) — don't split a feature across ad-hoc top-level folders.

## Style & formatting

- Prettier: `singleQuote: true, trailingComma: 'all'`. ESLint: `typescript-eslint` recommended-type-checked, with `@typescript-eslint/no-explicit-any` off and `no-floating-promises`/`no-unsafe-argument` downgraded to warnings. Run `npm run lint` / `npm run format`.
- Swagger decorators (`@ApiTags`, `@ApiOperation`, `@ApiResponse`/`@ApiOkResponse`, `@ApiBearerAuth`, `@ApiProperty` on DTOs) are used throughout existing controllers — match that density on new endpoints.

## Error handling & logging

- Standard NestJS HTTP exceptions (`NotFoundException`, `ForbiddenException`, etc.) thrown from services; no custom exception filter exists. No structured logging framework beyond Nest's default `Logger`/`console` — don't introduce one for a single feature.

## Testing

- Jest for unit tests (`*.spec.ts` colocated per module, per `jest` config in `package.json`, `rootDir: src`). Separate e2e config at `test/jest-e2e.json`. Run `npm run test`, `npm run test:e2e`.

## Anti-patterns to avoid

- Don't add a `use-cases/`/`mappers/`/`repositories/` layer to one module only — the whole codebase is intentionally flat.
- Don't invent a response envelope or pagination shape for a single endpoint — none exists yet; flag the gap instead.
- Don't add tenant/business/branch scoping logic — Havit has no multi-tenancy, only per-user ownership via `req.user.sub`.
- Don't use `npm run migration:*` (TypeORM CLI) or hand-edit `src/migrations/` for new schema work — use `backend/database/` (`npm run db:new` / `db:migrate`) instead.

> These conventions must reflect how the real codebase is actually written, not assumptions.
