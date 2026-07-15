# TESTING-GUIDE

## Purpose

How to write and where to put tests for `backend/`. There are currently **zero tests in this repo** — this guide is the standard new tests should follow from the first one written, not a description of an existing suite.

## When to read

Before writing any test, and before adding a new service/guard/controller that the plan says must ship with a test (see the "must have a test" rules in `docs/ai/CONVENTIONS.md` §Testing once populated, and the checklist in `docs/ai/SECURITY.md`).

## Keep updated

- Whenever the test framework, config, or conventions below change.
- Whenever `backend/test/` is actually created (see "Current state").

## Current state

- `npm run test` (`jest`) is configured via the `jest` block in `backend/package.json` (`rootDir: src`, `testRegex: ".*\\.spec\\.ts$"`, `ts-jest`, `testEnvironment: node`, coverage to `../coverage`) and **works today for unit tests**, but no `*.spec.ts` file exists anywhere in `src/` yet.
- `npm run test:e2e` (`jest --config ./test/jest-e2e.json`) is **broken**: `backend/test/` does not exist, so there is no `jest-e2e.json` to load. Creating that config + folder is part of this guide's rollout, not already done.
- `@nestjs/testing` and `supertest` are already in `devDependencies` — no new test-runner dependency is needed for the backend.

## Framework

- **Jest + ts-jest + `@nestjs/testing` + supertest.** All already present in `devDependencies`; nothing new to install for the backend.
- Unit tests exercise a single service/guard/pipe in isolation, with TypeORM repositories and other collaborators mocked (`@nestjs/testing`'s `Test.createTestingModule({...}).overrideProvider(...)`) — never hit the real Azure Postgres instance from a unit test.
- E2E tests spin up the Nest app (`Test.createTestingModule` + `app.init()`) and drive it via `supertest`, still against mocked/fake data sources where practical — not the shared Azure DB.

## File location & naming

- **Unit tests**: `*.spec.ts`, colocated next to the file under test in `src/<module>/`. Example: `src/challenges/challenges.service.spec.ts` next to `src/challenges/challenges.service.ts`. This matches the existing `testRegex`/`rootDir: src` jest config — no path changes needed.
- **E2E tests**: `test/*.e2e-spec.ts`, plus the currently-missing `test/jest-e2e.json`. Create both when the first e2e test is written; base the config on Nest's standard e2e template (`moduleFileExtensions`, `rootDir: .`, `testEnvironment: node`, `testRegex: .e2e-spec.ts$`, `transform` via `ts-jest`).
- One spec file per unit under test (one service → one `.spec.ts`), not one giant spec per module.

## Naming convention for test cases

`describe('<ClassName or unit>')` blocks, `it('should <expected behavior>')` cases. Tests document behavior — write the name as a sentence a non-author can read and know what broke.

### Example names (target — the actual priority list to write first)

1. `should reject request when JWT is missing` (`JwtAuthGuard`)
2. `should reject request when JWT is expired`
3. `should not allow a user to update a challenge they did not create` (`challenges.service` ownership)
4. `should not allow a user to delete a challenge they did not create`
5. `should never include password_hash in the /users/me response` (`users.service`/controller)
6. `should return 404 (not 500) when routine id does not exist` (regression test for the `new Error()` → `NotFoundException` fix in `docs/ai/backend/ERROR-HANDLING.md`)
7. `should reject POST /workout-logs when userId comes from the body` (regression test once `userId` is forced from `req.user.sub`)
8. `should not attach metrics to a workout log owned by another user`
9. `should hash the password and reject duplicate emails on register` (`auth.service`)
10. `should issue a valid JWT containing sub/email/username on login`

## Priority list (write these first — from the plan's testing strategy)

1. `JwtAuthGuard`: valid token, missing token, expired/invalid token.
2. Challenge ownership: `update`/`remove`/`updateCycleDay` reject a non-owner caller.
3. `/users/me` never leaks `password_hash`.
4. `workout-log`: `userId` is sourced from the JWT, never the body; the one-record-per-day-per-challenge rule is enforced.
5. `metrics`: cannot attach a metric to another user's workout-log exercise.
6. `auth.service`: login/register — password hashing, duplicate-email conflict, token issuance.
7. Once `ERROR-HANDLING.md`'s exception filter lands: a filter test asserting the standard shape (`statusCode`/`error`/`message`/`timestamp`/`path`) and that a 404 stays a 404.

Each item above is also a P0/P1 security or correctness concern documented in `docs/ai/SECURITY.md` — a passing test for it is the verification step for that fix, not optional follow-up.

## Minimum coverage guidance

Coverage is a proxy, not the goal — write tests for behavior that matters, and use these numbers as a floor, not a target to chase for its own sake:

- **Critical services** (`auth`, `challenges` ownership paths, `workout-log`, `metrics`): ≥80% line coverage, and 100% of the ownership/authorization branches specifically.
- **Guards and pipes**: 100% of branches (there are few branches — cover all of them: valid, missing, malformed, expired).
- **Everything else (controllers)**: happy path + the auth/validation failure path, not exhaustive DTO-field coverage.

Do not add tests just to move a global coverage percentage — a test with no assertion about real behavior (or one that mocks away the exact thing it's meant to verify) is worse than no test, because it looks like coverage without providing any.

## Mocking & test data

- Mock external dependencies: TypeORM repositories (`overrideProvider(getRepositoryToken(Entity))`), the OpenAI moderation client, the S3/Cloudflare client, `JwtService`/`ConfigService` where relevant.
- No real data from the shared Azure database in any test — use fixtures/factories local to the test file, not fetched rows.
- No network calls in unit tests. E2E tests may exercise the full Nest DI graph but should still fake the DB/external services rather than hitting Azure.

## Related docs

- `backend/docs/ai/SECURITY.md` — the security checklist each ownership/guard test is verifying.
- `backend/docs/ai/backend/ERROR-HANDLING.md` — the exception-shape tests reference.
- `frontend/docs/ai/frontend/TESTING-GUIDE.md` — the frontend counterpart.

> Must reflect the real current test setup, not an aspirational one. Update the "Current state" section the moment the first spec file or `test/` folder is added.
