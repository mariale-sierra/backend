# B6 methodology

## Environment

| | |
|---|---|
| Backend commit (BEFORE and AFTER) | `5b17de9` (`development`) — see note below |
| Branch | `development` (no task branch — this block was done directly on it per project instruction) |
| Machine | Local macOS (darwin), Node v25.8.1 |
| Database | Local Postgres, database `havit_perf`, schema created from the exact `backend/database/init|migrations|seeds` files (`npm run db:migrate`) — **not** the shared Azure instance. See `README.md`'s "Why a local database" section. |
| Fixture data | `performance/fixtures/generate-local-fixtures.sql`: 500 synthetic users, 300 challenges, ~7k challenge memberships, 20,000 workout logs, ~7,000 workout posts, spread over the last 90 days. Exercise catalog is the real seeded data (27 exercises — the full ~600-exercise RepDB import needs Cloudflare R2 credentials not available in this environment; see FINDINGS.md's caching rationale, which doesn't depend on catalog size). |
| Redis | Local `redis-server` on port 6390 (AFTER only) |
| Tool | `autocannon` v8 (added as a devDependency — no load-testing tool existed in the repo before this) |

**Important honesty note on "BEFORE and AFTER used the same commit":** both
benchmark runs were executed from the *same* working tree, on `development`
at commit `5b17de9`, with the B6 code changes present in the tree throughout.
To get a genuine BEFORE, the specific optimizations under test —
`src/exercises/exercises.service.ts`'s caching wrappers and the
`idx_workout_logs_challenge_id` index — were **temporarily reverted**
(service file swapped back to its committed `HEAD` version; index dropped and
its migration's tracking row removed) immediately before the BEFORE run, then
restored immediately before the AFTER run. No other B1-B5 work landed on
`development` between the two runs (they were minutes apart), so this is a
clean, apples-to-apples comparison of exactly the B6 changes — it does
**not** capture a "the exact code that will exist right before this branch's
work started" checkpoint, because no separate B6 branch/tag exists to diff
against (see "Coordination with B1-B5" below for why this is called out).

## Endpoints benchmarked

Chosen from the real, existing routes (never invented) after reading
`src/challenges/challenges.controller.ts`, `src/workout-log/workout-log.controller.ts`,
`src/workout-posts/workout-posts.controller.ts`, and `src/exercises/exercises.controller.ts`.
All are GET/read-heavy per the task's own guidance to avoid write load against
a shared resource — the app itself does have a global rate limit that this
also respects (see below).

| Endpoint | Auth | Why chosen |
|---|---|---|
| `GET /exercises` | public | Catalog list, paginated/filterable — described in its own Swagger doc as read-heavy. Cache candidate. |
| `GET /exercises/categories` | public | Small, stable reference table. Cache candidate. |
| `GET /exercises/muscle-regions` | public | Small, stable reference table, with an in-memory join over muscles. Cache candidate. |
| `GET /challenges` | public | Unfiltered "list every challenge" — the heaviest of the endpoints tested (5-6 sequential/parallel queries per request, no pagination). Explicit "not cached this block" candidate — see FINDINGS.md. |
| `GET /workout-logs` | JWT (testuser) | Per-user list with several eager relations (exercises/sets/targets/posts) — the workout-log/progress area the task flagged as B5's active territory. Benchmarked for visibility only; deliberately not modified. |
| `GET /workout-posts/mosaic?challengeId=` | JWT (testuser) | Join between `workout_posts` and `workout_logs` filtered by `challenge_id` — the query with the confirmed missing index (see FINDINGS.md). |

`GET /challenges/progress`, `/today`, `/progress-summary` were read but not
included: they're single-user, single-challenge lookups already backed by
the existing `idx_workout_logs_user_id` index (confirmed cheap via `EXPLAIN`,
see FINDINGS.md) — no evidence of a bottleneck, and benchmarking them would
have added scenarios without adding information.

## Concurrency matrix

**1, 5, 10, 20 concurrent connections.** Chosen after reading
`ThrottlerModule.forRoot(...)` in `src/app.module.ts`: the app already
enforces a global rate limit (300 requests / 60s per IP, tightened to
10/60s specifically on `POST /auth/login`). 20 concurrent connections against
these endpoints' actual (sub-100ms) latencies is already enough to reach
hundreds of requests per second locally — comfortably past what a single
mobile client would ever generate, and past the point where the relative
behavior of each endpoint is visible. There was no reason to go higher: the
goal (per the task) is comparing endpoints' relative behavior under light-to-moderate
load, not finding how many requests it takes to fall over.

## Requests per scenario: fixed amount, not fixed duration

Each (endpoint × concurrency) scenario runs a **fixed 200 requests**
(`autocannon`'s `amount` option), not a fixed duration. This was a deliberate
accommodation of the global throttle above: every request in a run — across
every endpoint and concurrency level — comes from the same source IP
(`127.0.0.1`) and shares that single 300-req/60s bucket. A duration-based run
at concurrency 20 would burn through that budget in under a second and then
spend the rest of the "duration" collecting 429s instead of real latency
data. A fixed, modest amount keeps every scenario's total request count
predictable and small.

### Why the throttle is raised for the benchmark run

Even with a fixed amount, running ~24 scenarios × 200 requests sequentially
(4,800 requests total) in a single session would still blow through 300
requests/60s many times over, well before the sliding window could reset
between scenarios. Rather than insert dozens of 60-second cooldowns (which
would make the whole benchmark take over 20 minutes of pure waiting and
still be fragile to time it exactly right), `src/app.module.ts`'s
`ThrottlerModule.forRoot(...)` was changed to read its `ttl`/`limit` from
`THROTTLE_TTL_MS`/`THROTTLE_LIMIT` env vars, **defaulting to the exact same
300/60000 values as before**. Only the local benchmark `.env` sets
`THROTTLE_LIMIT=100000` — no deployment should ever set this. This is the one
non-benchmark-script code change made purely to make B6 reproducible; every
other optimization in this block is independent of it.

The existing global default (300/60s) and the tighter login-specific
throttle (`@Throttle({ default: { limit: 10, ttl: 60_000 } })` on
`POST /auth/login`) were themselves left completely unchanged for production —
see RESULTS.md's rate-limiting section for the full evaluation.

## Authentication

`POST /auth/login` is called **once** per benchmark run (not once per
request) using the repo's existing local/dev seed account
(`database/seeds/2026-07-21-01-test-user.sql`: `testuser@havit.dev` /
`TestHavit123!`, seeded on every fresh migrate). The resulting JWT is reused
as an `Authorization: Bearer` header for every request to an authenticated
endpoint in that run. No token is hardcoded anywhere in this folder — it's
fetched at runtime by `performance/scripts/run-benchmark.js` from
`AUTH_EMAIL`/`AUTH_PASSWORD` env vars (defaulting to the seeded test
account), matching the existing JWT auth flow with zero bypasses.

## Confounders / what this does NOT measure

- **Local Postgres, not Azure.** Every absolute millisecond figure in this
  folder reflects a loopback connection to a local Postgres instance. Real
  production latency includes a network round-trip to Azure Database for
  PostgreSQL (`DB_HOST=pg-havit-dev-01.postgres.database.azure.com`), which
  the caching work in this block would help hide *more*, not less, than these
  numbers suggest (a cache hit skips that round trip entirely; a cache miss
  still pays it, same as before). Treat every percentage improvement here as
  a **conservative floor**.
- **Small exercise catalog (27 rows, not ~600).** The real RepDB import
  (`database/importers/repdb/`) also uploads images to Cloudflare R2, which
  needs credentials not available in this environment — see README.md. This
  affects only the *absolute* cost of `GET /exercises` (a 27-row scan is
  already fast even uncached); the *relative* caching win (skip Postgres
  entirely on a hit) does not depend on catalog size, and the underlying
  query pattern was already read directly, not guessed.
- **No concurrent write load during the benchmark.** No other process was
  writing to `havit_perf` while these scenarios ran, which real production
  traffic would not guarantee. This mainly matters for `GET /challenges`
  and `GET /workout-logs`, which were left uncached — see FINDINGS.md for why.
- **Single machine, single run per scenario.** These are illustrative,
  reproducible numbers, not a statistically rigorous benchmark with repeated
  trials and confidence intervals. Where a change shows a result within
  noise (a few percent either direction), RESULTS.md says so explicitly
  rather than claiming an improvement.

## Coordination with B1-B5

Per the task's own instructions, no branches were merged or modified as part
of this reconnaissance. `git fetch --all --prune` in `backend/` showed one
relevant unmerged branch, `origin/feature/challenge-roles`
(`6d11412`), which touches `challenges.controller.ts`,
`challenges.service.ts`, `workout-log.service.ts`, and `workout-posts.service.ts`
substantially (see its diff stat). It does **not** touch
`ChallengesService.findAll()`/`attachCategoriesAndLocations()`/
`getMemberCountsByChallenge()` (the `GET /challenges` code path benchmarked
here) or `ExercisesService` at all — confirmed by reading its diff hunk line
ranges before deciding what was safe to change. If it merges before this
block's changes are integrated, the exercises caching and the
`workout_logs.challenge_id` index remain valid regardless (neither depends on
anything that branch changes); `GET /challenges` was left uncached
specifically because of this kind of in-flight risk (see FINDINGS.md).
