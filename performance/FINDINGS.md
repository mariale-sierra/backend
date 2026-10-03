# B6 findings

## Bottleneck analysis

### 1. `GET /workout-posts/mosaic` — missing index on `workout_logs.challenge_id` (fixed)

`WorkoutPostsService.findMosaicByChallenge()` (`src/workout-posts/workout-posts.service.ts`)
joins `workout_posts` to `workout_logs` and filters on `workoutLog.challenge_id`.
`workout_logs` already had btree indexes on `user_id` and `routine_id`
(`database/init/2026-07-07-00-init-schema.sql`) but none on `challenge_id`,
despite it being a real FK (`fk_workout_logs_challenge`).

Evidence (local `havit_perf`, 20,000 workout_logs / ~7,000 workout_posts —
raw output in `results/before/explain-mosaic-before.txt`):

```
->  Seq Scan on workout_logs wl  (cost=0.00..497.00 rows=240 width=8)
      (actual time=0.758..3.598 rows=240.00 loops=1)
      Filter: (challenge_id = '...')
      Rows Removed by Filter: 19760
Execution Time: 8.003 ms
```

A full scan of every workout log in the system, for every mosaic request, to
find the ~240 belonging to one challenge — cost scales with total workout_logs
across *every* challenge, not the one being viewed.

**Fix:** `database/migrations/2026-09-27-01-add-workout-logs-challenge-id-index.sql`
adds `idx_workout_logs_challenge_id`. After (`results/after/explain-mosaic-after.txt`):

```
->  Bitmap Heap Scan on workout_logs wl  (cost=6.15..263.56 rows=240 width=8)
      (actual time=0.019..0.036 rows=240.00 loops=1)
      ->  Bitmap Index Scan on idx_workout_logs_challenge_id
Execution Time: 0.991 ms
```

**8.0ms → 1.0ms (≈87% reduction)** for this query at the seeded scale; the gap
widens as `workout_logs` grows, since the old plan's cost was linear in table
size and the new one is not. App-level (HTTP, JSON serialization, auth guard)
improvement is smaller but still clear — see RESULTS.md.

Checked and *not* changed: the per-user "today"/"completed days" lookups in
`ChallengesService.getToday()`/`WorkoutLogService` filter `workout_logs` by
`user_id` first (already indexed) — confirmed cheap via `EXPLAIN` (a
0.15-0.26ms bitmap scan even at 20k total rows, since a single user's own
workout count stays small regardless of table size). No evidence they need
`challenge_id` in the index too, so the index was scoped to exactly the
column the mosaic query needed.

### 2. `GET /exercises` and friends — already well-optimized queries, but paid for on every request

Reading `ExercisesService` in full: `findAll()` already avoids N+1 (batches
category/location/translation/asset lookups in one `Promise.all` after
fetching the page of ids — see its own doc comment), and every join target
(`exercise_category_map`, `exercise_location_map`, `exercise_translations`,
etc.) already has the right indexes (composite PKs on the FK pairs, plus a
dedicated GIN trigram index for name search — `idx_exercise_translations_name_trgm`).
`EXPLAIN` confirmed no sequential scan on anything but the 27-row `exercises`
table itself, which is correct planner behavior at that size regardless of
indexing.

So there was **no query to fix here** — the finding is different: this is
public, unauthenticated, rarely-mutated catalog data, re-fetched and
re-assembled from 5+ separate queries (base list + category maps + location
maps + translations + assets, per `findAll()`) on *every single request*,
by *every* user opening the app, all pulling identical results. That's a
caching problem, not a query problem — see the evaluation below.

### 3. `GET /challenges` — the slowest endpoint measured, but not a single missing index

`ChallengesService.findAll()` has no filters or pagination — it loads every
row in `challenges` unconditionally, then batches three more queries in
parallel (`getMemberCountsByChallenge`, `getDominantActivityCategories`,
`loadAuthors`) plus `attachCategoriesAndLocations`'s two queries. Each
individual query is fast in isolation (checked with `EXPLAIN ANALYZE`
against the 300-row local fixture — all under 10ms), but the endpoint pays
for 5-6 sequential/parallel round trips on every call, with no filtering or
pagination to bound the base table scan as it grows. This shows up directly
in the benchmark: `challenges-list` is the slowest scenario at every
concurrency level (11-63ms, see RESULTS.md), while every other benchmarked
endpoint stays under ~15ms even at concurrency 20.

**Not fixed in this block.** Two ways to address it exist, and both were
ruled out as out of scope rather than attempted:

- **Caching** would help a lot (public, no per-user variation, same shape as
  the exercises catalog work) — but `findAll()` backs the challenge
  discovery/list screen, which is exactly the kind of frequently-changing,
  actively-developed area the task flagged as coordination-risky. The
  in-flight `feature/challenge-roles` branch doesn't touch `findAll()`
  itself (confirmed by reading its diff), but it does add new ways challenges
  get created/closed/joined, and a short-TTL cache here would need its
  invalidation hooked into every one of those mutation paths — care that's
  better done once that branch's shape has landed on `development`, not
  guessed at now. **Recommended as the next thing to cache once B1's
  challenge-roles work merges**, with a short TTL (15-30s) and explicit
  invalidation on create/update/close/join/leave.
- **Pagination** would bound the base query, but changes the response shape
  (`{ message, data: [...] }` → something with page metadata) — a public
  contract change the task explicitly said not to make without a clear
  requirement to do so. Flagged as future work instead.

### 4. `GET /workout-logs` — unbounded per-user history with deep eager relations

`WorkoutLogService.findAll()` loads every workout log a user has ever logged,
eagerly joining `exercises`, `exercises.exercise`, `exercises.metrics`,
`exercises.targets`, `exercises.sets`, `exercises.sets.targets`, and `posts`
— no pagination, no date bound. At the seeded scale (each fixture user has
dozens of logs, but none of them have `workout_log_exercises` rows) this
didn't show up as a bottleneck in the benchmark, but the shape is real: a
long-time user with hundreds of logged workouts, each with several exercises
and sets, would multiply out to a large joined result set on every call.

**Not touched.** This sits squarely inside the "progreso diario /
concurrencia" area the task named as B5's active territory
(`workout-log`/`challenges` progress tracking) — per the task's explicit
instruction not to cache or restructure that data without very strong
evidence and an unambiguous invalidation story. Flagged here as **future
work**: either pagination (contract change, needs a product decision) or a
narrower `relations` selection matched to what each caller actually needs.

## Index review

Reviewed every index touching the four modules in scope
(`database/init/2026-07-07-00-init-schema.sql` plus every migration since).
Summary of what's already correct vs. the one gap found:

| Table | Column(s) | Status |
|---|---|---|
| `workout_logs` | `user_id` | Existing index, confirmed used and cheap for per-user lookups |
| `workout_logs` | `routine_id` | Existing index |
| `workout_logs` | `challenge_id` | **Was missing** — added (finding #1) |
| `workout_posts` | `(created_at DESC, id DESC) WHERE visibility='public' AND moderation_status='approved'` | Existing partial index, correctly targeted at the public feed query |
| `workout_posts` | `(user_id, created_at DESC, id DESC)` | Existing index for per-user timelines |
| `workout_posts` | `workout_log_id` (unique) | Existing, backs the 1:1 relationship |
| `challenge_user_map` | PK `(challenge_id, user_id)` + `user_id` | Existing — covers both the join-membership check and per-user "my challenges" lookups |
| `exercise_category_map` / `exercise_location_map` / `exercise_muscle` | PK `(exercise_id, ...)` | Existing — covers every join `ExercisesService` does |
| `exercise_translations` | PK `(exercise_id, locale)`, `locale`, GIN trigram on `name` | Existing — already supports the cross-locale search `findAll()` does |

No other index was added. `challenges` has no index beyond its primary key,
because nothing in the benchmarked code path filters it by anything other
than its id — its cost is the unconditional full scan discussed in finding
#3, which an index cannot fix (there's no `WHERE` clause to serve).

## Cache candidate evaluation

| Candidate | Read freq. | Write freq. | Cost to compute | Stale-tolerance | Invalidation | Interaction w/ B1-B5 | Verdict |
|---|---|---|---|---|---|---|---|
| `GET /exercises` (+ `/categories`, `/muscle-regions`, `/muscles-in-region`, `/muscles/:code`, `/:id/full`) | Very high (every screen showing exercises) | Very low (admin-only `POST /exercises`, `POST /exercises/:id/relations`) | Moderate (multiple batched queries) | High — a few minutes of staleness on a workout catalog is unobservable | Simple — one cache-version counter bumped on the only two mutating endpoints | None — no in-flight branch touches this module | **Good candidate — implemented** |
| `GET /challenges` (list) | High (discovery screen) | Moderate, and about to increase (join/close/role features in flight) | Moderate-high (5-6 round trips) | Moderate — a stale "open" challenge or member count for a few seconds is a minor UX issue, not a correctness one | Needs hooking into create/update/close/join/leave/remove-participant — several call sites, some in a branch not yet merged | **High** — `feature/challenge-roles` adds new mutation paths for this exact resource | **Possible candidate — deferred**, see finding #3 |
| `GET /workout-logs`, workout-log "today"/progress endpoints | High (home screen) | High (a user logging a workout mutates exactly this) | Low-moderate per user | **Low** — this is the "did I already log today" data the task explicitly named as concurrency-sensitive | Would need per-user invalidation on every workout write, exactly where B5 is adding concurrency protection | **High** — named directly in the task as B5's territory | **Do not cache** |
| `GET /workout-posts/mosaic`, challenge/user photo feeds | Moderate | Moderate (new posts, moderation approval) | Low-moderate | Moderate, but moderation approval changes visibility unpredictably (async OpenAI batch job) | Would need invalidation on post create *and* on the async moderation batch approving/rejecting a post later — more moving parts than the exercises case for less benefit (the missing-index fix already made this fast) | Moderate (`feature/challenge-roles` adds workout-post tagging) | **No cache — the index fix already resolved the measured bottleneck** |
| `POST /auth/login`, `GET /auth/me` | High | N/A (reads) / high (every login) | Low | **None** — this is per-user identity/auth data | N/A | N/A | **Never cache** (also excluded on principle: auth data, per-user) |

Only the exercises-catalog family was implemented this block. Everything
else in the "good/possible" tier is either deferred with a documented reason
(challenges list) or was resolved by a non-caching fix (workout-posts mosaic).
Nothing sensitive, per-user, or concurrency-critical was cached — see
`REDIS.md` for the exact design.
