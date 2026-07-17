# HOW-TO-ADD-A-FEATURE

## Purpose

An end-to-end walkthrough for adding a feature that touches both repos: DB → entity → module → controller/endpoint → service → frontend service → screen → tests/docs. Use this as the checklist for anything bigger than a one-file fix; for a single-file change, the relevant specific guide (e.g. `SECURITY.md`'s endpoint checklist) is probably enough on its own.

## When to read

Before starting any feature that adds or changes a database column/table, an endpoint, or a screen that consumes one.

## Keep updated

- When the step order or any linked doc's name changes.

## The walkthrough

### 1. Database (if the feature needs a schema change)

- Work only in `backend/database/`, never TypeORM's legacy `migration:*` CLI (frozen, see root `CLAUDE.md`).
- `cd backend && npm run db:new -- migration <short-name>` → edit the generated `database/migrations/YYYY-MM-DD-NN-<short-name>.sql` file with plain, idempotent SQL (`IF NOT EXISTS`, `DO $$ ... $$` guards on `CREATE TYPE`).
- `npm run db:migrate` to apply it against the shared Azure DB.
- Never edit an already-applied file; never run a destructive reset against the shared database.
- Reference: `backend/docs/ai/db/MIGRATION-GUIDE.md`.

### 2. Entity

- Add/update the TypeORM entity in `src/<module>/entities/`, matching the actual column names/types in the `havit` schema (TypeORM does **not** `synchronize` — the entity must describe reality, not the other way around).
- Follow the existing naming reality: some columns are snake_case with `@Column({ name: '...' })` mapping to a camelCase property, some aren't — check a neighboring entity in the same module before guessing.
- Add any FK relations the feature needs (`@ManyToOne`/`@OneToMany`) — several existing entities are missing relations that are instead joined by hand via QueryBuilder; adding a relation for new work is fine, don't feel obligated to retrofit old code in the same change.
- Reference: `backend/docs/ai/backend/DOMAIN-MODEL.md`.

### 3. Module (new module only — most features add to an existing one)

- `src/<module>/` with `<module>.module.ts` + `<module>.controller.ts` + `<module>.service.ts` + `dto/` + `entities/`. Flat structure — no `use-cases/`/`mappers/`/`repositories/` layer.
- Register it in `app.module.ts`'s `imports` **once** (the existing `MetricsModule` double-import is a known bug to avoid repeating, see `docs/ai/CURRENT-STATE.md`).

### 4. Controller / endpoint (+ DTOs + auth)

- **DTO(s) first**: `create-<x>.dto.ts`/`update-<x>.dto.ts` in `dto/`, every accepted field declared with `class-validator` decorators — the global `ValidationPipe` (`whitelist: true, forbidNonWhitelisted: true`) rejects anything undeclared, so an undeclared field isn't a soft failure, it's a hard 400 (or silent strip) for the caller.
- **Handler**: `@Api*` Swagger decorators matching the existing density in that module (`@ApiTags`, `@ApiOperation`, `@ApiResponse`/`@ApiOkResponse`, `@ApiBearerAuth()` iff protected), path param pipes (`ParseIntPipe`/`ParseUUIDPipe` matching the column type).
- **Auth**: decide explicitly. Today that means adding `@UseGuards(JwtAuthGuard)` per-route where the resource is user-owned (most things); once the global-guard + `@Public()` target lands (see `docs/ai/SECURITY.md`), it means adding `@Public()` only for the rare intentionally-open route. Never ship a new mutating endpoint with auth "undecided" — that's exactly the bug class already present at `PATCH/DELETE /challenges/:id`, `POST /workout-logs`, etc.
- **Routing**: base route in plural, kebab-case for multi-word resources; sub-actions as path segments off the id (`:id/join`, `:id/cycle-days/:dayInCycle`). Reference: `docs/ai/backend/API-STANDARDS.md`.

### 5. Service (+ ownership)

- Inject the TypeORM repository directly (`@InjectRepository`) — no repository/use-case abstraction layer.
- If the method reads or mutates a resource tied to a user, the user id it filters/checks against comes from the **controller passing `req.user.sub` in**, never from a body/query field the service trusts blindly. See `docs/ai/SECURITY.md`'s ownership rule and the `POST /workout-logs` counter-example (trusts body `userId`) vs. `POST /challenges/progress` (correctly overrides with `req.user.sub`) for the pattern to copy vs. avoid.
- Throw Nest HTTP exceptions (`NotFoundException`, `ForbiddenException`, `BadRequestException`), never a plain `new Error(...)` — see `docs/ai/backend/ERROR-HANDLING.md` for why that specific mistake currently produces a masked 500 in six places.
- Return a response DTO / filtered shape, not the raw entity, whenever the entity carries a sensitive field (`password_hash` being the canonical example — see `GET /users/me`'s current bug in `docs/ai/SECURITY.md`).

### 6. Swagger / backend docs

- Confirm the new route shows up correctly at `/api-docs` (tags, summary, response codes).
- Update `backend/docs/ai/backend/BACKEND-MAP.md`'s controller→routes table and, if the domain model changed, `DOMAIN-MODEL.md`.
- Update `backend/docs/ai/backend/BACKEND-INTEGRATION-GUIDE.md` — this is the contract the frontend repo reads; a stale entry there is a cross-repo bug waiting to happen since the two repos aren't updated atomically.

### 7. Frontend service

- Add/extend `frontend/services/<feature>/<feature>.service.ts`: calls the shared `api` (from `services/api.ts`) and returns `response.data`. Never call `api`/`axios`/`fetch` directly from a component or hook.
- If the backend response shape differs from what the UI needs, add/extend a `services/adapters/<x>Adapter.ts` rather than reshaping inline in a component.
- Reference: `frontend/docs/ai/frontend/API-CLIENT-GUIDE.md`.

### 8. Screen (+ i18n)

- Place the route in the correct Expo Router group (`(auth)`, `(tabs)`, `(add)`, or the relevant non-grouped stack like `challenge/`) — don't invent a new top-level folder for a small feature.
- Build with existing `components/ui`/`components/layout` primitives and `constants/theme` tokens before creating new ones.
- No fetch/business logic inside the visual component — call the service (step 7) from a hook, or from the screen via the service directly for simple cases, matching the existing pattern in a sibling screen.
- Every user-visible string goes into **both** `i18n/resources/en.ts` and `es.ts` in the same change, with correct Spanish accents. Reference: `frontend/docs/ai/frontend/I18N-GUIDE.md`.
- Update `frontend/docs/ai/frontend/FRONTEND-MAP.md`/`frontend/docs/ai/frontend/COMPONENTS-GUIDE.md` if a new route or reusable component was added.

### 9. Tests

- Backend: at minimum, a service test for the happy path and the not-authorized/not-owner path (`*.spec.ts` next to the service); a guard test if a new guard was introduced. Reference: `backend/docs/ai/backend/TESTING-GUIDE.md`.
- Frontend: at minimum, a test for any new adapter/service function once the test framework is installed (see `frontend/docs/ai/frontend/TESTING-GUIDE.md` — currently not installed; note that plainly rather than skipping the step silently if the framework genuinely isn't there yet).
- Any bug fixed along the way gets a regression test, not just a code fix.

## Related docs

- `backend/docs/ai/SECURITY.md` — the ownership/auth rules referenced in steps 4-5.
- `backend/docs/ai/backend/ERROR-HANDLING.md` — the error-shape rules referenced in step 5.
- `frontend/docs/ai/frontend/I18N-GUIDE.md` — the i18n rules referenced in step 8.
- `backend/docs/ai/backend/TESTING-GUIDE.md` / `frontend/docs/ai/frontend/TESTING-GUIDE.md` — step 9 in full.

> This is a checklist of the currently-correct process, not a description of how every existing feature was actually built — several existing endpoints skip steps here (missing DTOs, missing ownership checks, missing docs updates). Don't copy those as precedent; follow this walkthrough instead.
