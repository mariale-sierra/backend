# SECURITY

## Purpose

The security model for `backend/`: how auth and ownership work today, the target hardened model from the restructuring plan, and a checklist to run before shipping any endpoint. This is the highest-priority doc in this tree — read it before adding or changing any route.

## When to read

Before adding, changing, or reviewing any endpoint. Before touching `auth/`, `uploads/`, or anything that reads/writes a user-owned resource.

## Keep updated

- Whenever a route's auth/ownership status changes.
- Whenever a P0 item below is actually fixed (move it from "current gaps" to "done", don't just delete it).

## Current state: this is not a multi-tenant app

There is no "business"/"organization" entity and none will be added. **All authorization is per-user ownership**, checked against `req.user.sub` — the `sub` claim of the verified JWT (see `src/auth/guards/jwt-auth.guard.ts`, which sets `request.user = payload` where `payload` is `{ sub, email, username }`). Wherever an audit or a habit from other codebases talks about "cross-tenant leakage" or "business permissions" in this repo, it means **cross-user data leakage** — one user seeing or mutating another user's rows.

## Current gaps (P0 — being fixed in the restructure, not yet fixed)

These are real, verified-against-code issues as of this doc's writing. Don't assume any of them are fixed without checking the controller/service directly.

1. **Most writes have no guard at all.** `PATCH /challenges/:id`, `DELETE /challenges/:id`, `POST /exercises`, `POST /routine`, `POST /routine/:id/exercises`, `POST /workout-logs`, `GET/PATCH /workout-logs/:id`, `GET /workout-logs` (returns every user's logs), `POST /metrics/workout-log-exercises/:id`, and `POST /uploads/sign` are all reachable with no `Authorization` header. `src/challenges/challenges.controller.ts`'s `update`/`remove` handlers have no `@UseGuards(JwtAuthGuard)` and no ownership check even though `create`/`join`/`leave` do.
2. **`GET /users/me` returns the raw `User` entity, including `password_hash`.** `src/users/users.service.ts`'s `findById` does `this.userRepo.findOne({ where: { id } })` and returns it as-is; `users.controller.ts`'s `getMe` returns that directly. There is no response DTO filtering the entity.
3. **`POST /workout-logs` (and the underlying `createWorkout`) trust `userId` from the request body**, not from the JWT — a caller can log workouts as any user id they choose. Compare this to `POST /challenges/progress`, which correctly overrides `userId: req.user.sub` before calling the same service method — the fix pattern already exists in the codebase, it's just not applied everywhere.
4. **Authenticated-but-unverified ownership**: `PATCH /challenges/:id/cycle-days/:dayInCycle` has the guard but the service never checks that the caller owns/created the challenge. `GET /workout-logs/:id` and `POST /metrics/workout-log-exercises/:id` don't check that the workout log belongs to the caller.
5. **`GET /challenges/:id/users` is public and returns participant `email` addresses** — no guard, no field filtering.
6. **`POST /uploads/sign` is completely public** (`src/uploads/uploads.controller.ts`) and accepts `fileType` as an untyped `@Body('fileType')` string with no allow-list — anyone can mint a presigned write URL to the Cloudflare/S3 bucket at will (abuse/cost risk), for any content type.
7. **Transport/secrets**: the frontend talks to the API over plain HTTP (`http://20.63.84.1:3000`), so the JWT and login credentials are sent unencrypted; `ssl: { rejectUnauthorized: false }` is set in three places (`app.module.ts`, `data-source.ts`, `database/scripts/lib.js`), which accepts any TLS certificate on the Postgres connection (MITM risk); real `.env` secrets live in an OneDrive-synced folder; `JWT_SECRET` is duplicated between `backend/.env` and `raiz/.env` instead of having one source of truth.
8. **No `Helmet`, no CORS allow-list, no rate limiting, no global exception filter** in `main.ts` — only the global `ValidationPipe`.

## Target model (what new/changed code should move toward)

- **Auth denied by default.** Register `JwtAuthGuard` as a global guard (`APP_GUARD`) instead of per-route `@UseGuards(...)`, with an explicit `@Public()` decorator for the intentionally open routes (`POST /auth/login`, `POST /auth/register`, and catalog-style public reads like `GET /challenges`). This eliminates the "forgot the guard" bug class described above. Until this lands, **every new/changed route must still decide its auth explicitly** — don't add a route and leave it unguarded "for now."
- **One ownership pattern everywhere**: a reusable check (helper function or a `@CurrentUser()` param decorator that services call as `assertOwnership(resourceUserId, req.user.sub)`) used in every service method that reads or mutates a user-owned resource. Never accept a `userId`/owner id from the request body or query string — always derive it from `req.user.sub`.
- **Response DTOs / serialization** so entities are never returned raw. Either explicit `*-response.dto.ts` classes per endpoint, or `ClassSerializerInterceptor` + `@Exclude()` on sensitive entity fields (`password_hash` first). `password_hash` and any future auth tokens must never appear in a response body, ever.
- **Secrets & transport**: no secrets committed to code or logged; HTTPS end-to-end (frontend base URL forced to `https://`); `rejectUnauthorized: true` with the Azure Postgres CA once configured; JWT stored in `expo-secure-store` on the client, not `AsyncStorage`; one `JWT_SECRET` source, rotated once this lands, out of the OneDrive-synced path.
- **Hardening**: `helmet`, `@nestjs/throttler` (at least on `/auth/login`), an explicit CORS allow-list, `/api-docs` gated outside of dev.

## Secure endpoint checklist

Run through this for every new or changed endpoint before considering it done:

- [ ] **Auth decided explicitly**: either `@Public()` (target) / documented-as-intentionally-open (current), or protected by the JWT guard. No route ships "undecided."
- [ ] **Ownership derives from the token, not the request.** If the endpoint reads/writes a resource tied to a user, the user id used for the check/query is `req.user.sub` — never `req.body.userId`, `req.query.userId`, or a param.
- [ ] **Ownership is actually checked**, not just "the route has a guard." A guard proves the caller is *someone*; it does not prove they own *this* resource. Verify the resource's owner column matches `req.user.sub` before returning or mutating it.
- [ ] **Response never includes sensitive fields.** No `password_hash`, no raw tokens, no other users' PII (e.g. email in a public participant list) unless the endpoint is explicitly meant to expose it.
- [ ] **Body is DTO-typed with class-validator.** No `@Body()` without a type, no `@Body('field')` string plucking (see `uploads.controller.ts`'s `getSignedUrl` for the anti-pattern to avoid). The global `ValidationPipe` (`whitelist: true, forbidNonWhitelisted: true`) only protects you if the DTO declares every field.
- [ ] **List endpoints don't leak across users.** A "list mine" endpoint filters by `req.user.sub` in the query — it does not return every row and rely on the frontend to filter.
- [ ] **Params use the right pipe** (`ParseIntPipe`/`ParseUUIDPipe`) matching the column type (see `docs/ai/db/TABLES-GUIDE.md`).
- [ ] **Swagger reflects the real auth**: `@ApiBearerAuth()` present iff the route requires a token; `401`/`403` documented if applicable.
- [ ] **No new secret, credential, or token is hardcoded** or written to a log statement (`console.log`, `Logger`).

## Related docs

- `backend/docs/ai/backend/API-STANDARDS.md` — routing/DTO/response conventions this checklist assumes.
- `backend/docs/ai/backend/ERROR-HANDLING.md` — how a rejected/unauthorized request should respond.
- `backend/docs/ai/TROUBLESHOOTING.md` — symptoms like unexpected 401s or migration/env failures.

> Must reflect the real current security posture, not aspirations. If a gap above gets fixed, update this file in the same change.
