# DB-INSTRUCTIONS

Read this before touching anything under `backend/database/`. Full depth lives in `backend/docs/ai/db/` and the "Base de datos y migraciones" section of the root `CLAUDE.md` — this file is the short mandatory gate.

## The rules, in order

1. **`backend/database/` is the only source of truth for schema.** Not TypeORM's `synchronize` (`false` in `app.module.ts`), not the legacy `npm run migration:*` scripts (`src/migrations/*.migration.ts` — frozen, kept for history only).
2. **Never edit a file that's already applied.** Once a filename is recorded in the `havit.schema_migrations` table, it's immutable history. Fix mistakes with a new file, not a rewrite.
3. **New change → new file, scaffolded, never hand-named.** From `backend/`:
   ```bash
   npm run db:new -- migration <short-kebab-name>   # schema change
   npm run db:new -- seed <short-kebab-name>         # reference data
   ```
   This produces the correct `YYYY-MM-DD-NN-short-name.sql` name in `database/migrations/` or `database/seeds/`.
4. **Write idempotent SQL** (`IF NOT EXISTS`, `DO $$ ... $$` guards) so the file is safe to re-run.
5. **Apply it.**
   ```bash
   npm run db:migrate
   ```
   This also runs automatically on every container start (`backend/Dockerfile`, `raiz/docker-compose.yml`) — **no docker-compose editing, no manual mount registration**. If you're deploying/starting normally, the file gets picked up on its own.
6. **The one-time exception:** `npm run db:baseline` marks every current `init`/`migrations`/`seeds` file as applied *without* running it. Only use this once, against a database whose schema already existed before this system did (this was already done once, for the current Azure DB). Never run it against a fresh/empty database.
7. **Update the docs.** After a schema change, update `backend/docs/ai/db/TABLES-GUIDE.md`, `RELATIONSHIPS-GUIDE.md`, and if relevant `SEEDING-GUIDE.md`/`FUNCTIONS-TRIGGERS-GUIDE.md`/`DB-MAP.md`. If the change affects entities the backend reads, update the matching TypeORM entity too (`synchronize: false` means TypeORM won't do it for you).

## No multi-tenancy

Havit has no business/branch/tenant concept. Ownership is a plain `user_id`/`created_by_user_id` foreign key (often nullable with `ON DELETE SET NULL`, e.g. `challenges.created_by_user_id`, so deleting a user doesn't cascade-delete their challenges). Keep that pattern for new user-owned tables.

## See also

- `backend/docs/ai/db/DATABASE-ARCHITECTURE.md`, `DB-MAP.md`, `TABLES-GUIDE.md`, `RELATIONSHIPS-GUIDE.md`, `MIGRATION-GUIDE.md`, `SEEDING-GUIDE.md`, `FUNCTIONS-TRIGGERS-GUIDE.md`.
- Root `CLAUDE.md` → "Base de datos y migraciones" for the full mechanism (how the runner works, why it's structured this way).
