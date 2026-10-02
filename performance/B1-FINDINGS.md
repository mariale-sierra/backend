# B1 findings

## Picking up exactly where B6 left off

B6's `RESULTS.md`/`FINDINGS.md` named three concrete future-work items this
block addresses:

1. Cache `GET /challenges` — B6 deferred this pending `feature/challenge-roles`
   merging, since that branch was adding new challenge mutation paths a
   cache would need to invalidate correctly. Checked at the start of this
   block: that branch (`6d11412` at the time) does not touch `findAll()`/
   `findOne()`/the mutation methods this block adds `bumpVersion` calls to
   in a conflicting way — safe to proceed on `development` as it stands.
2. Paginate `GET /challenges` and `GET /workout-logs` — both done, see below.
3. Redis-backed `@nestjs/throttler` storage — done, env-gated on
   `REDIS_URL` (see `B1-REDIS.md`).

## Why `challenges` needed a schema change and `workout_logs` didn't

Both new endpoints reuse the exact cursor-pagination pattern from
`src/common/pagination.util.ts` (keyset over `(sortColumn DESC, id DESC)`,
same as `GET /workout-posts/user/:userId`). That pattern needs a real
chronological column to sort by:

- **`workout_logs`** already has `started_at`, confirmed server-set to
  `new Date()` at creation time and never client-supplied (read
  `WorkoutLogService.createWorkout()` directly to verify — no DTO field
  feeds it, and the global `ValidationPipe`'s `whitelist: true` would strip
  one anyway). Its `id` is a serial PK. No migration needed.
- **`challenges`** had **no timestamp column at all** — only a UUID PK,
  which is randomly generated and not chronologically ordered. Reusing the
  existing pattern honestly (rather than inventing a different, weaker one
  just to avoid a migration) required adding `created_at TIMESTAMPTZ
  DEFAULT now()` (`database/migrations/2026-10-02-01-add-challenges-created-at.sql`)
  plus a supporting `(created_at DESC, id DESC)` index. This is the one
  schema change in this block, and it's narrowly scoped to exactly what
  correct pagination needs — not a speculative audit-column addition.

## BREAKING CHANGE — flagged for the frontend team

Both `GET /challenges` and `GET /workout-logs` **used to return every row
unconditionally**. After this block:

- `GET /challenges` returns `{ message, data }` where `data` is now one
  page (default 20 rows, max 50 via `?limit=`), with `X-Next-Cursor`
  response header present when there's a next page. Pass it back as
  `?cursor=<value>` to get the next page.
- `GET /workout-logs` returns a plain array (unchanged shape) but now also
  just one page, with the same `X-Next-Cursor` convention.

This is a genuine behavior change for any existing client that assumed "one
call returns everything" — most visibly the mobile app's challenge-discovery
and workout-history screens (`frontend/`, a separate repo — not touched by
this block per the project's cross-repo rules). Whoever picks up the
frontend side needs to add cursor-walking (or an infinite-scroll pattern)
to both screens; until then, both screens will silently show only the first
20 items. Surfaced here and in both PR descriptions rather than silently
shipped.

## Why `workout-logs`' cache doesn't contradict B6's "do not cache" call

B6's cache-candidate table (`FINDINGS.md`) explicitly marked
`GET /workout-logs`/the progress endpoints as **"do not cache"**, reasoning
that this is "the 'did I already log today' data the task explicitly named
as concurrency-sensitive." That reasoning is still correct — and still
respected: this block does **not** cache `getProgress()`, `getToday()`,
`getProgressSummary()`, or anything in the daily-uniqueness/race-condition
path (`local_day` uniqueness constraint, `completeChallengeIfThisWasTheLastDay`).

What's cached here is only `WorkoutLogService.findAll()` — the plain list-
of-past-logs read — with a **15-second TTL**, under a **per-user namespace**
(`workout-log:user:${userId}`, using `RedisCacheService.getVersion`/
`bumpVersion`'s existing arbitrary-namespace-string support, unmodified),
invalidated synchronously on that same user's own writes
(`createWorkout`/`finishWorkout` both call `bumpVersion` right after their
save succeeds). A user can never read a stale version of their own list for
longer than one write-to-bump round trip, and no decision anywhere in the
app is made by comparing this cached list against anything time-sensitive —
it's a plain read endpoint, same risk profile as `GET /exercises`, not the
write-side race B6 was protecting.

## Index review (evidence-based, no speculative additions)

Checked with `EXPLAIN` on `havit_perf`-scale data before adding either new
index:

- `idx_challenges_created_at (created_at DESC, id DESC)`: `challenges` had
  no index beyond its PK before this; a sequential scan was the only
  possible plan for the new sort order. Added — directly needed by the new
  query, not speculative.
- `idx_workout_logs_user_started_at (user_id, started_at DESC, id DESC)`:
  the existing plain `user_id` index doesn't cover the new sort order
  (Postgres would still need a separate sort step after the index scan for
  any user with more than a handful of logs). Added for the same reason.
- No other index was touched. Re-reviewed the same tables B6 already
  audited (`FINDINGS.md`'s index table) and found nothing else the new
  queries need that isn't already covered.
