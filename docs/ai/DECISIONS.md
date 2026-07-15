# DECISIONS

## Purpose

A lightweight decision log (ADR-style). Records *why* important technical choices were made so future sessions don't unknowingly reverse them.

## When to read

When a change touches an architectural choice, or you're tempted to "do it differently."

## Keep updated

- Whenever a non-trivial technical decision is made, add an entry.
- If a decision is reversed, add a new entry that supersedes the old one (don't delete history).

## Decisions

### 2026-07-07 — Replace TypeORM CLI migrations with a raw-SQL runner under `backend/database/`
- **Context:** schema changes were split across a hand-maintained snapshot (`schema_havit_uuid.sql` at the `Havit/` root) and two hand-written TypeORM migration files (`src/migrations/*.migration.ts`), with no automated tracking of what had actually been applied to the shared Azure database, and no enforced naming/ordering convention.
- **Decision:** move to plain, dated SQL files under `backend/database/{init,migrations,seeds}/`, applied by a small custom Node script (`backend/database/scripts/migrate.js`) that tracks applied filenames in a `havit.schema_migrations` table, runs automatically on every container start, and requires no docker-compose wiring per migration.
- **Rationale:** the app already used raw SQL for its real schema (TypeORM `synchronize: false`); a file-per-change system with DB-side tracking is simpler to reason about than diffing TypeORM entities, and removes the need to manually register each migration in Docker config (the previous plan modeled on a `docker-entrypoint-initdb.d` approach, rejected because the target database is a managed Azure instance, not a local Postgres container).
- **Consequences:** `npm run migration:generate|run|revert` is now legacy/frozen. The existing Azure database needed a one-time `npm run db:baseline` to mark its current schema as already-applied without re-running `CREATE TABLE`/`CREATE TYPE` statements.
- **Status:** accepted.

### 2026-07-07 — Adapt the `app-builder*` skills from Klyro to Havit instead of using them as-is
- **Context:** four `app-builder` skills (general, backend, db, frontend) were copied in from a different project ("Klyro"), which assumed a DDD-layered NestJS backend with `use-cases/`/`mappers/`/`repositories/`/`common/`, multi-tenant business/branch isolation, a Next.js/shadcn/TanStack Query frontend, an 8-language i18n setup, and a `docker-entrypoint-initdb.d`-mounted database with a `root/` platform repo.
- **Decision:** rewrite the four `SKILL.md` files and their `templates/` to describe Havit's actual architecture (flat NestJS modules, no tenancy, Expo Router/React Native frontend with no form/query library, 2-language i18n, the new `backend/database/` runner) rather than leaving Klyro-specific assumptions in place.
- **Rationale:** using the skills unmodified would have actively misled future sessions into inventing layers, tenancy checks, and libraries that don't exist in this codebase.
- **Consequences:** `docs/ai/` had to be bootstrapped from scratch in both `backend/` and `frontend/` for the skills' Step 1 ("read docs/ai first") to have anything real to read.
- **Status:** accepted.

### 2026-07-15 — Fase 4/5: generic status-derived `code` catalog instead of a per-resource enum
- **Context:** the restructuring plan's Fase 4 (`ERROR-HANDLING.md`) suggested starting a `code` catalog from real error sites (`ROUTINE_NOT_FOUND`, `EXERCISE_NOT_FOUND`, etc.); the task brief for this pass instead asked for a small fixed enum (`AUTH_REQUIRED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `INTERNAL`).
- **Decision:** implemented the small fixed `ErrorCode` enum (`src/common/constants/error-code.enum.ts`), and had `HttpExceptionFilter` auto-derive a default `code` from the HTTP status (400/422→`VALIDATION_ERROR`, 401→`AUTH_REQUIRED`, 403→`FORBIDDEN`, 404→`NOT_FOUND`, 500→`INTERNAL`) whenever the thrown exception doesn't specify its own. A call site can still opt into a more specific code later by throwing `new NotFoundException({ message, code: 'ROUTINE_NOT_FOUND' })` — the filter reads it off the exception body if present.
- **Rationale:** gets every error a stable `code` today (not just migrated call sites) without touching dozens of existing `throw new XyzException(...)` call sites, while leaving the door open for granular codes later without a filter change.
- **Consequences:** the frontend can build its `code`→i18n mapping around the 5-value enum now; per-resource codes remain an opt-in enhancement per call site, not a blocking prerequisite.
- **Status:** accepted.

### 2026-07-15 — Kept `CreateChallengeDto.categories/locations/cycle_days` despite being dead fields
- **Context:** the restructuring plan (§3.3) flags these as dead DTO fields (`any[]`, declared but never persisted by `ChallengesService.create`) and this pass's brief said "remove them (or wire them only if trivial and safe; prefer removing)".
- **Decision:** did **not** remove them. Verified `frontend/services/adapters/createChallengePayloadAdapter.ts:102-122` builds and sends all three on every real `POST /challenges` request from the app today. With `ValidationPipe({ forbidNonWhitelisted: true })`, removing the fields from the DTO would make every challenge-creation request from the live app fail with 400.
- **Rationale:** "prefer removing" only applies when it's actually safe; here it isn't. Wiring them properly (persisting categories/locations, and turning `cycle_days` into real `challenge_cycle_days` + per-day routine creation) is substantial, unrelated business logic — not "trivial" — and out of scope for a backend-only pass without frontend coordination.
- **Consequences:** the fields stay as declared-but-ignored `any[]` for now. This is real follow-up work, tracked in `CURRENT-STATE.md` — properly resolving it needs either (a) backend work to actually persist them, coordinated with what the frontend already sends, or (b) a frontend change to stop sending them, done together so neither side breaks the other (same class of risk as master-plan §11 risk #1).
- **Status:** accepted (deferred, not resolved).

### 2026-07-15 — Skipped adding new ORM relations (Fase 5 item 11)
- **Context:** the plan/brief listed adding safe, non-breaking ORM relations (`Challenge`→`ChallengeUserMap`/`ChallengeCycleDay`, `ChallengeUserMap`→`User`, `WorkoutLog`→`User`/`Challenge`) as optional ("ADD only clearly-safe... if useful... skip and note anything risky").
- **Decision:** skipped entirely this pass.
- **Rationale:** every place that needs these joins today already does them explicitly via `QueryBuilder`/`where` clauses and works correctly; adding a `@ManyToOne`/`@OneToMany` mapping is low-risk in isolation but there is zero automated test coverage in this repo to catch a subtly wrong `@JoinColumn` (wrong column name, wrong nullability assumption) against the live shared Azure database, and this pass's time was prioritized on the higher-certainty Fase 4 items (exception filter, dead code/legacy migration removal, config) and the DTOs that were explicitly required. Nothing is currently blocked by the relations' absence.
- **Consequences:** none functionally — this is purely a "didn't do it" deferral, not a behavior change. Recommend doing it as its own small, isolated pass once `TESTING-GUIDE.md`'s Jest setup exists, so each new relation can be smoke-tested before being trusted.
- **Status:** accepted (deferred).

> This log must reflect real decisions affecting the codebase, not assumptions.
