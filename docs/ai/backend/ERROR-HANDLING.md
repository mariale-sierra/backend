# ERROR-HANDLING

## Purpose

How errors flow from a service, through the controller, to the HTTP response — as implemented today, and the target standard shape the restructuring plan defines. Read this before throwing an error in a service or writing an exception filter.

## When to read

Before adding error handling to a service/controller, and before consuming an error response from the frontend side.

## Keep updated

- Whenever the actual error shape changes (e.g. once the exception filter below is implemented).
- Whenever a new stable `code` is added to the catalog.

## Current state (as implemented today)

- No global exception filter exists. Nest's default exception handling produces the built-in shape: `{ statusCode, message, error }` (e.g. `{ "statusCode": 404, "message": "Routine not found", "error": "Not Found" }`).
- Most services correctly throw Nest HTTP exceptions (`NotFoundException`, `ForbiddenException`, `BadRequestException`, etc.), which map to the right status code.
- **Six call sites throw plain `new Error(...)` instead**, which Nest does not know how to map to a 4xx — it surfaces as an unhandled exception and becomes an opaque `500 Internal Server Error`, hiding the real cause from the client:
  - `src/routine/routine.service.ts:48` — `throw new Error('Routine not found')`
  - `src/routine/routine.service.ts:51` — `throw new Error('Exercise not found')`
  - `src/workout-log/workout-log.service.ts:184` — `throw new Error('Workout not found')`
  - `src/workout-log/workout-log.service.ts:208` — `throw new Error('Workout not found')`
  - `src/workout-log/workout-log-exercise.service.ts:24` — `throw new Error('Workout not found')`
  - `src/workout-log/workout-log-exercise.service.ts:27` — `throw new Error('Exercise not found')`
  
  Every one of these should be `NotFoundException('...')` and currently is not. Treat any of these five files as needing this fix the next time they're touched, even outside a dedicated error-handling pass.
- No stable machine-readable `code` field exists anywhere in an error response today — only the generic Nest `message`/`error` strings, several of which are in Spanish (matching the Swagger descriptions), some in English. The frontend's Axios response interceptor (`frontend/services/api.ts`) maps by **HTTP status only** (401/403/404/500/network), not by any field in the body.

## Target standard (not yet implemented)

> Everything in this section is the plan, not the current behavior. Don't write code or docs elsewhere that assume it already exists — check the controller/service directly, or check "Current state" above.

### Standard error shape

```jsonc
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Routine not found",
  "code": "ROUTINE_NOT_FOUND",   // optional but preferred: stable, machine-readable
  "timestamp": "2026-07-14T12:00:00.000Z",
  "path": "/routine/abc123"
}
```

- `statusCode` / `error` / `message` mirror Nest's existing convention so this is a low-friction change, not a breaking rewrite of everything.
- `code` is new: a stable, UPPER_SNAKE_CASE identifier the frontend can switch on instead of parsing `message` strings (which may be in either language and can change wording without notice). `code` is optional per-exception — add it as call sites are migrated, don't block the whole rollout on having a `code` for every single error.
- `timestamp` and `path` are new, added by the global filter, not by each call site.

### Implementation plan

1. Add a global `HttpExceptionFilter` (`@Catch(HttpException)` at minimum, ideally `@Catch()` to also catch the plain-`Error` cases as a safety net) registered via `app.useGlobalFilters(...)` in `main.ts`. It builds the shape above from the caught exception plus `request.url`/`new Date().toISOString()`.
2. Replace all six `new Error(...)` sites listed above with the matching `NotFoundException`/`BadRequestException`, etc. This alone fixes the "404 hidden behind a 500" class of bug (see `docs/ai/SECURITY.md` and the testing list in `TESTING-GUIDE.md`: *"should return 404 (not 500) when routine id does not exist"*).
3. Define a small `code` catalog as they're needed — don't invent a large enum speculatively. Start from real error sites: `ROUTINE_NOT_FOUND`, `EXERCISE_NOT_FOUND`, `WORKOUT_NOT_FOUND`, `CHALLENGE_NOT_FOUND`, `NOT_OWNER` (ownership check failures), `INVALID_CREDENTIALS`, `EMAIL_ALREADY_REGISTERED`.
4. Decide (and this doc will then record) whether a response **envelope** (e.g. `{ data, meta }` wrapping successful responses) is adopted alongside this. As of this plan, **no envelope decision has been made** — don't invent one for a single endpoint; see `API-STANDARDS.md`.

### How the frontend should consume `code` (target)

Once `code` exists, the frontend's Axios response interceptor (currently in `frontend/services/api.ts`, mapping by HTTP status only) should additionally read `error.response.data.code` when present and map it to a translated string via `i18n.t('errors.' + code)`, falling back to the existing status-based generic message when `code` is absent (during the migration window, most errors still won't have one). See `frontend/docs/ai/frontend/I18N-GUIDE.md` for the `errors.<code>` key convention and `frontend/docs/ai/TROUBLESHOOTING.md` for what a raw (non-translated) error currently looks like to a user.

## Related docs

- `backend/docs/ai/backend/API-STANDARDS.md` — the broader endpoint conventions (routing, DTOs, response shape) this fits into.
- `backend/docs/ai/SECURITY.md` — why ownership failures must not leak as 500s or as raw entity data.
- `frontend/docs/ai/frontend/I18N-GUIDE.md` — the frontend half of the `code` → translated-message mapping.

> Must reflect what is actually implemented vs. still planned. Keep the "Current state" and "Target standard" sections honestly separated as the migration progresses.
