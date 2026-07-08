# BACKEND-INTEGRATION-GUIDE

## Purpose

The contract the frontend (`frontend/`, separate repo) integrates against. Bridges to the frontend's `docs/ai/frontend/API-CLIENT-GUIDE.md`.

## When to read

Before changing any endpoint, and whenever the frontend needs to know how to call the API.

## Keep updated

- Whenever endpoints, payloads, or response formats change. Keep in sync with `/api-docs` and `backend/swagger.json`.

## Base & auth

- Base URL: `http://20.63.84.1:3000` (hardcoded on both sides today — see `frontend/services/api.ts`). No path prefix/versioning.
- Auth: `POST /auth/login` → `{ accessToken }`; send `Authorization: Bearer <token>` on every protected route. The frontend attaches this via an Axios request interceptor (`services/api.ts`) and stores the token via `services/auth/token.service.ts`.

## Response shape & errors

No envelope: every endpoint returns the raw entity/DTO/array. Errors come back as Nest's default `{ statusCode, message, error }`; the frontend's Axios response interceptor maps HTTP status (401/403/404/500) and network errors to toast notifications (`store/errorNotificationStore.ts`) generically — it does not parse a custom error code.

## Endpoint catalog

See `docs/ai/backend/BACKEND-MAP.md`'s "Controllers → routes" table for the full, current route list per module. Known frontend call sites, for cross-reference when changing a contract:

| Backend area | Frontend service |
| --- | --- |
| `/auth/*` | `frontend/services/auth/auth.service.ts` |
| `/users/*` | `frontend/services/user/user.service.ts` |
| `/challenges/*` | `frontend/services/challenge/challenge.service.ts` |
| `/exercises/*` | `frontend/services/exercises/exercises.service.ts` |
| `/routine/*` | `frontend/services/routine/routine.service.ts` |
| `/workout-logs/*` | `frontend/services/workout-log/workout-log.service.ts` |
| `/metrics/*` | `frontend/services/metrics/metrics.service.ts` |
| `/workout-posts/*` | `frontend/services/feed/feed.service.ts` (verify — feed adapter may also read from `/challenges/progress` or mock data, see `frontend/docs/ai/frontend/`) |
| `/uploads/*` | `frontend/services/uploads/upload.service.ts` (uses native `fetch` for the actual signed-URL `PUT`, not the shared Axios client — see frontend docs) |

## Versioning & deprecation

None established — no breaking-change process exists yet. Coordinate directly (both repos are independent, so a backend contract change requires a matching frontend PR, not an atomic commit).

> Must reflect the real current API contracts, not assumptions. Frontend depends on this being accurate.
