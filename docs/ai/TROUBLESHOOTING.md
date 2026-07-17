# TROUBLESHOOTING

## Purpose

Common failures in `backend/` and how to fix them, so a Claude Code session (or a human) doesn't re-diagnose the same issue from scratch every time.

## When to read

When something fails unexpectedly — a request, a `db:migrate` run, a build, a container start.

## Keep updated

- Whenever a new recurring failure mode is diagnosed. Add it here instead of only fixing it once.

## "I get a 500 for something that should be a 404/400"

**Symptom**: an endpoint that should return `404 Not Found` (e.g. a routine/exercise/workout id that doesn't exist) instead returns an opaque `500 Internal Server Error` with no useful message.

**Cause**: the service throws a plain `new Error(...)` instead of a Nest HTTP exception. Nest doesn't know how to map a generic `Error` to a status code, so it falls through to 500. This is a real, verified issue at six call sites today — see `docs/ai/backend/ERROR-HANDLING.md`'s "Current state" section for the exact file/line list (`routine.service.ts`, `workout-log.service.ts`, `workout-log-exercise.service.ts`).

**Fix**: replace the `new Error('X not found')` with `throw new NotFoundException('X not found')` (import from `@nestjs/common`). For a validation problem, use `BadRequestException` instead. This is a one-line change per site; if you're touching one of the files above for any reason, fix its `new Error()` too rather than leaving it for later.

## "I get a 401 Unauthorized" / "my token stopped working"

**Possible causes, in order of likelihood**:
1. **No `Authorization` header sent.** `JwtAuthGuard` (`src/auth/guards/jwt-auth.guard.ts`) throws `UnauthorizedException('No token provided')` if the header is missing entirely.
2. **Malformed header** (missing the `Bearer ` prefix or the token itself) → `UnauthorizedException('Invalid token format')`.
3. **Expired or invalid signature** → `UnauthorizedException('Invalid or expired token')`. Tokens are issued with `expiresIn: '7d'`; after 7 days from login, re-authenticate. There is no refresh-token flow — expiry means logging in again.
4. **`JWT_SECRET` mismatch between issuing and verifying processes.** The guard calls `this.configService.getOrThrow<string>('JWT_SECRET')` — if this env var differs between the process that issued the token and the one verifying it (e.g. a stale container, or `backend/.env` vs. `raiz/.env` drifting apart, a known duplication — see `docs/ai/SECURITY.md`), every token verification fails. Confirm both `.env` files agree.
5. **Route genuinely has no guard and you expected one.** A significant portion of write endpoints currently have no `@UseGuards(JwtAuthGuard)` at all (see `docs/ai/SECURITY.md`'s "Current gaps" list) — a 401 you *don't* get where you expected one is itself a bug to flag, not fix by "making the 401 go away."

## "A migration failed" / `npm run db:migrate` errors

- **`relation "X" already exists` / `type "X" already exists`**: you're pointing `db:migrate` at a database that already has the schema from a source other than the runner (most likely the pre-existing Azure DB before `db:baseline` was run once — see root `CLAUDE.md`'s Database section). Do **not** re-run `db:baseline` reflexively; check `havit.schema_migrations` first (`SELECT filename FROM havit.schema_migrations ORDER BY applied_at`) to see what's actually tracked as applied.
- **A new migration file fails partway through**: the runner wraps each file's SQL + its tracking-row insert in a single transaction, so a failing file is **not** marked applied and the whole run stops (see `docs/ai/db/MIGRATION-GUIDE.md`). Fix the SQL in that same file (it hasn't been tracked yet, so editing it is safe) and re-run `npm run db:migrate` — don't create a second migration to "patch" a file that never successfully applied.
- **Non-idempotent SQL** (`CREATE TABLE` without `IF NOT EXISTS`, `CREATE TYPE` without a `DO $$` guard) breaks on a second run against a DB that already has the object from a previous partial attempt. Always write migrations idempotently per `docs/ai/db/MIGRATION-GUIDE.md`.
- **Never hand-edit an already-applied file** in `init/`/`migrations/`/`seeds/` to "fix" it — once its filename is in `havit.schema_migrations`, create a new migration instead.

## "Missing environment variable" / app won't start

- `app.module.ts` wires `TypeOrmModule.forRoot` from `DB_HOST`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` (port `5432` is currently hardcoded, not env-driven — a known gap, see the plan's "Config tipada" item). `JwtAuthGuard`/`auth.service.ts` require `JWT_SECRET` via `getOrThrow`, which throws immediately if unset rather than silently defaulting.
- There is currently **no startup-time schema validation for env vars** (e.g. via `@nestjs/config`'s `validationSchema`) — a missing var surfaces as whatever error the first consumer throws (a `getOrThrow` exception, or a TypeORM connection failure), not a single clear "missing X" message. Check `.env` (or the container's env) against: `DB_HOST`, `DB_PORT` (if introduced), `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`, `JWT_SECRET`, plus whatever `uploads`/`openai` need (S3/Cloudflare credentials, `OPENAI_API_KEY`).
- Real secrets live in a `.env` inside an OneDrive-synced folder today (verified gap, see `docs/ai/SECURITY.md`) — don't assume `.env` is git-ignored-and-safe by convention alone; double-check before sharing screen/logs.

## "Build fails" (`npm run build` / `nest build`)

- Confirm `npm install` has actually run and matches `package-lock.json` — this repo has no unusual install flags (unlike the frontend's `--legacy-peer-deps`).
- TypeScript errors from `class-validator`/`@nestjs/swagger` decorators usually mean a DTO field type doesn't match how it's used in the service — check the DTO against the service method signature.
- If the error is in `src/migrations/*.migration.ts` or `src/data-source.ts`: these are frozen legacy TypeORM files (see root `CLAUDE.md`) — don't "fix forward" by extending them; the live schema path is `backend/database/`.

## "Container starts but the app isn't reachable" / Docker

- `backend/Dockerfile`'s `CMD` runs `npm run db:migrate && node dist/main.js` — if migration fails, the container never starts the app. Check container logs for a migration error first (see "A migration failed" above) before assuming it's a networking/port issue.
- `main.ts` listens on `process.env.PORT ?? 3000` and binds `'0.0.0.0'` — if the app doesn't respond, check the actual `PORT` env value and the container's port mapping, not just the code default.

## Related docs

- `backend/docs/ai/backend/ERROR-HANDLING.md` — the 500-vs-404 issue in full.
- `backend/docs/ai/SECURITY.md` — the auth/guard gaps referenced above.
- `backend/docs/ai/db/MIGRATION-GUIDE.md` — the full migration workflow.

> Must reflect real, reproduced failure modes — not speculation. Add a new entry only after actually hitting and diagnosing it.
