# ERROR-HANDLING

## Purpose

How errors flow from a service, through the controller, to the HTTP response — as implemented today, and the target standard shape the restructuring plan defines. Read this before throwing an error in a service or writing an exception filter.

## When to read

Before adding error handling to a service/controller, and before consuming an error response from the frontend side.

## Keep updated

- Whenever the actual error shape changes (e.g. once the exception filter below is implemented).
- Whenever a new stable `code` is added to the catalog.

## Current state (as implemented today, Fase 4)

- A global `HttpExceptionFilter` (`src/common/filters/http-exception.filter.ts`) is registered as `APP_FILTER` in `src/app.module.ts`. It's `@Catch()` (catches everything, not just `HttpException`), so it's also the safety net for any stray unhandled error.
- Every error response now has the standard shape below. `statusCode`/`error`/`message` still mirror Nest's previous default shape (non-breaking), `code`/`timestamp`/`path` are new.
- All `new Error(...)` call sites are gone. `src/routine/routine.service.ts` now throws `NotFoundException('Routine not found')` / `NotFoundException('Exercise not found')`. `src/workout-log/workout-log-exercise.service.ts` — the dead, unregistered `WorkoutLogExerciseService` that had the other two `new Error(...)` sites — was deleted outright (see `CURRENT-STATE.md`/`BACKEND-MAP.md`). `src/workout-log/workout-log.service.ts` already threw `NotFoundException`/`ForbiddenException` by the time this pass started (fixed incidentally during Fase 1's ownership work, ahead of this doc).
- `code` is populated for essentially every error today, not just migrated call sites: `HttpExceptionFilter` auto-assigns a default `code` from a small status→code map (`src/common/constants/error-code.enum.ts`) whenever the thrown exception doesn't specify its own. A call site can still override with a more specific code by throwing e.g. `new NotFoundException({ message: 'Routine not found', code: 'ROUTINE_NOT_FOUND' })` — the filter reads `code`/`message`/`error` off the exception's response body when present.
- The frontend's Axios response interceptor (`frontend/services/api.ts`) still maps by **HTTP status only**; it has not been updated to read `code` yet (that's frontend work, Fase 6/transversal, not done in this pass). `message`/`statusCode` are unchanged in meaning, so the interceptor keeps working as-is.

## Standard error shape (implemented)

```jsonc
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Routine not found",
  "code": "NOT_FOUND",
  "timestamp": "2026-07-14T12:00:00.000Z",
  "path": "/routine/abc123"
}
```

- `statusCode` / `error` / `message` mirror Nest's previous convention — this was a low-friction change, not a breaking rewrite.
- `code` catalog (`src/common/constants/error-code.enum.ts`, `ErrorCode` enum): `AUTH_REQUIRED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `VALIDATION_ERROR` (400/422), `INTERNAL` (500 / unhandled exceptions). Deliberately generic/small rather than one code per resource — a call site can still attach a more specific `code` string via the exception's response body (see above) without needing a new enum member.
- `timestamp` and `path` are added by the filter, not by each call site.
- Unhandled/non-`HttpException` errors (a stray `throw new Error(...)`, a DB driver error, etc.) are still caught, logged server-side with the full stack via `Logger`, and turned into a `500` with `message: "Internal server error"` and `code: "INTERNAL"` — the client never sees a raw stack trace or Express's default HTML error page.

## Not done in this pass

- The frontend does not yet read `error.response.data.code` — see `frontend/docs/ai/frontend/I18N-GUIDE.md` for the target `errors.<code>` → i18n mapping when that's picked up.
- No response **envelope** (e.g. `{ data, meta }` wrapping successful responses) was adopted — out of scope; see `API-STANDARDS.md`.
- Per-resource codes (`ROUTINE_NOT_FOUND`, `WORKOUT_NOT_FOUND`, etc.) were not threaded through every call site — the generic status-derived `code` covers all of them today; add a specific one only where a call site genuinely needs to be distinguished from its status-mates.

## Related docs

- `backend/docs/ai/backend/API-STANDARDS.md` — the broader endpoint conventions (routing, DTOs, response shape) this fits into.
- `backend/docs/ai/SECURITY.md` — why ownership failures must not leak as 500s or as raw entity data.
- `frontend/docs/ai/frontend/I18N-GUIDE.md` — the frontend half of the `code` → translated-message mapping.

> Must reflect what is actually implemented vs. still planned. Keep the "Current state" and "Target standard" sections honestly separated as the migration progresses.
