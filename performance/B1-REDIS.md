# B1 — Redis, extended

Continuation of `REDIS.md` (read that first — namespace/version-counter
design, fail-open behavior, cache stampede decision: all unchanged and
reused exactly). This file covers only what's new in B1.

## `challenges` namespace

| Method | Route | TTL | Key |
|---|---|---|---|
| `findAll(cursor, limit)` | `GET /challenges` | 20s | `challenges:v{version}:findAll:{cursor or "first"}:{limit}` |
| `findOne(id)` | `GET /challenges/:id` | 20s | `challenges:v{version}:findOne:{id}` |

20s, not 300s like the exercises catalog: `challenges` is actively mutated
(create/join/leave/close/...), unlike a rarely-changing exercise catalog —
B6's own cache-candidate table already recommended exactly this 15-30s range
for this endpoint. `bumpVersion('challenges')` is called at the end of every
mutating method that can change `findAll()`/`findOne()`'s output on
`development` today: `create`, `update`, `remove`, `joinChallenge` (the
public-join branch only — a pending private-challenge join request doesn't
change membership yet), `respondToChallengeJoinRequest` (only when
`approve: true`), `removeChallengeParticipant`, `closeChallenge`, and
`leaveChallenge`/`completeChallenge` (both via the shared
`updateChallengeUserStatus` helper). One namespace-wide bump per write, same
simplicity-over-precision choice the exercises module already made.

## `workout-log:user:${userId}` namespace (per-user, not global)

| Method | Route | TTL | Key |
|---|---|---|---|
| `findAll(userId, cursor, limit)` | `GET /workout-logs` | 15s | `workout-log:user:{userId}:v{version}:findAll:{cursor or "first"}:{limit}` |

`RedisCacheService.getVersion`/`bumpVersion` already accept an arbitrary
namespace string — this uses `workout-log:user:${userId}` instead of a
single global namespace, so one user's write only ever invalidates their
own cached list, never another user's. `bumpVersion` is called right after
`createWorkout` and `finishWorkout`'s saves succeed. See `B1-FINDINGS.md`
for why this is safe despite B6 flagging this module as "do not cache" —
short version: only the plain list read is cached, not anything in the
daily-progress-uniqueness/race-condition path.

## `@nestjs/throttler` storage → Redis

`src/app.module.ts`'s `ThrottlerModule.forRoot(...)` is now
`forRootAsync(...)`, with `storage: new ThrottlerStorageRedisService(REDIS_URL)`
when `REDIS_URL` is set, falling back to `@nestjs/throttler`'s own default
in-memory storage otherwise — unset behaves exactly as before (per-instance
in-memory counter), same env-gated, zero-risk rollout as every other Redis
usage in this codebase. Implements B6's own "Future work #3" recommendation
verbatim: the gap it closes is that an in-memory counter is per-process, so
running more than one `backend` instance behind a load balancer would
silently turn a "300 requests/minute" limit into "300 × instance count"
without this. Not separately load-tested in this block — see
`B1-RESULTS.md`'s future-work section for why (needs a real multi-instance
setup).

## Shared pagination util relocation

`src/workout-posts/pagination.util.ts` (and its matching DTO,
`cursor-pagination-query.dto.ts`) moved to `src/common/` in this block,
since it's now a 3-consumer shared utility (`workout-posts`, `challenges`,
`workout-log`) rather than something specific to one module. Pure
relocation — `encodeCursor`/`decodeCursor`/`DEFAULT_PAGE_LIMIT`/
`MAX_PAGE_LIMIT` are unchanged, `workout-posts.service.ts`'s import updated
accordingly.
