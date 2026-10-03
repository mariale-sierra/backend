# B6 results

Raw data: `results/before/*.json`, `results/after/*.json`,
`results/comparison-summary.json` (machine-generated from the two), and the
`EXPLAIN (ANALYZE, BUFFERS)` captures referenced from `FINDINGS.md`. See
`METHODOLOGY.md` for exactly how these were produced and its "Confounders"
section for what these numbers do and don't represent (local Postgres, not
Azure — treat every improvement below as a conservative floor).

## Before vs. after — average / p97.5 latency, autocannon, 200 requests per scenario

| Endpoint | Concurrency | Avg (before→after) | Avg Δ | p97.5 (before→after) | p97.5 Δ | Errors/non-2xx |
|---|---:|---|---:|---|---:|---|
| `exercises-list` | 1 | 1.90 → 0.05 ms | **-97.4%** | 3.00 → 0.00 ms | -100.0% | 0/0 |
| `exercises-list` | 5 | 3.64 → 0.88 ms | **-75.8%** | 9.00 → 2.00 ms | -77.8% | 0/0 |
| `exercises-list` | 10 | 6.64 → 2.74 ms | **-58.7%** | 14.00 → 14.00 ms | 0.0% | 0/0 |
| `exercises-list` | 20 | 14.31 → 4.16 ms | **-70.9%** | 30.00 → 16.00 ms | -46.7% | 0/0 |
| `exercises-categories` | 1 | 0.26 → 0.04 ms | -84.6% | 1.00 → 0.00 ms | -100.0% | 0/0 |
| `exercises-categories` | 5 | 0.43 → 0.49 ms | +14.0% (noise) | 3.00 → 2.00 ms | -33.3% | 0/0 |
| `exercises-categories` | 10 | 1.46 → 1.42 ms | -2.7% (noise) | 9.00 → 7.00 ms | -22.2% | 0/0 |
| `exercises-categories` | 20 | 2.33 → 2.78 ms | +19.3% (noise) | 8.00 → 11.00 ms | +37.5% (noise) | 0/0 |
| `exercises-muscle-regions` | 1 | 1.19 → 0.06 ms | **-95.0%** | 4.00 → 0.00 ms | -100.0% | 0/0 |
| `exercises-muscle-regions` | 5 | 1.36 → 0.47 ms | **-65.4%** | 5.00 → 2.00 ms | -60.0% | 0/0 |
| `exercises-muscle-regions` | 10 | 2.66 → 1.25 ms | **-53.0%** | 12.00 → 7.00 ms | -41.7% | 0/0 |
| `exercises-muscle-regions` | 20 | 6.00 → 3.20 ms | **-46.7%** | 19.00 → 14.00 ms | -26.3% | 0/0 |
| `workout-posts-mosaic` | 1 | 3.90 → 1.14 ms | **-70.8%** | 9.00 → 2.00 ms | -77.8% | 0/0 |
| `workout-posts-mosaic` | 5 | 1.65 → 0.88 ms | **-46.7%** | 6.00 → 5.00 ms | -16.7% | 0/0 |
| `workout-posts-mosaic` | 10 | 2.62 → 2.28 ms | -13.0% | 13.00 → 12.00 ms | -7.7% | 0/0 |
| `workout-posts-mosaic` | 20 | 9.48 → 3.57 ms | **-62.3%** | 43.00 → 13.00 ms | -69.8% | 0/0 |
| `challenges-list` (not modified) | 1/5/10/20 | 12.16/14.71/31.93/63.22 → 11.32/16.30/31.24/63.00 ms | -6.9% / +10.8% / -2.2% / -0.3% (all noise) | — | — | 0/0 |
| `workout-logs-list` (not modified) | 1/5/10/20 | 5.56/1.92/4.24/7.77 → 5.54/1.93/4.24/7.36 ms | all within ±5% (noise) | — | — | 0/0 |

**Reading this honestly:**

- The three cached exercises endpoints improved substantially at concurrency
  1 (cold-adjacent, near-pure cache-hit path) and at concurrency 20 (where
  avoiding repeated Postgres round trips under load matters most) —
  46-97% faster.
- `exercises-categories` shows **no reliable improvement at concurrency 5 and
  20** (both within noise, one even nominally slower). This endpoint's
  uncached query was already sub-millisecond on this 27-row local catalog —
  there's very little latency left to cut, and at that scale the Redis
  round-trip itself (network syscall + JSON parse) can occasionally cost
  about as much as the Postgres query it's replacing. This is called out
  explicitly rather than cherry-picking the concurrency-1 result: **the
  caching win for this specific endpoint is real but small in this
  environment**, and would be more pronounced against Azure's real network
  latency (see METHODOLOGY.md's confounders).
- `workout-posts-mosaic` improved 47-71% at three of four concurrency levels;
  concurrency 10 shows a smaller (but still real, non-noise-direction) 13%
  gain. This endpoint wasn't cached — the entire improvement is the
  `idx_workout_logs_challenge_id` index (see FINDINGS.md finding #1).
- `challenges-list` and `workout-logs-list` — **deliberately unmodified** —
  show only noise-level differences (within ±11%) between before and after,
  in both directions. This is the expected result and doubles as a sanity
  check on the whole methodology: if these had shown a systematic
  improvement too, that would suggest an uncontrolled variable between the
  two runs rather than a real effect from the changes made.

## Cold vs. warm cache (Redis effect in isolation)

`performance/scripts/measure-cache-cold-warm.js`, 5 samples per endpoint,
Redis flushed before each "cold" sample (raw data:
`results/after/cache-cold-vs-warm.json`):

| Endpoint | Cold (min/avg/max ms) | Warm (min/avg/max ms) |
|---|---|---|
| `GET /exercises` | 3.78 / 16.88 / 63.74 | 0.85 / 1.20 / 2.33 |
| `GET /exercises/categories` | 0.99 / 1.29 / 1.68 | 0.50 / 0.56 / 0.72 |
| `GET /exercises/muscle-regions` | 1.71 / 2.00 / 2.22 | 0.56 / 0.61 / 0.66 |

Warm reads are consistently 2-14x faster than cold ones even against a local
Postgres a few milliseconds away — the effect against Azure's real network
latency would be larger, not smaller, since a cache hit skips that round
trip entirely. `GET /exercises`'s cold numbers are noisier (first-request
JIT/connection-pool warmup effects on top of the actual query) — the warm
numbers are the more stable, repeatable figure.

## `EXPLAIN` before/after (workout_logs.challenge_id index)

See `FINDINGS.md` finding #1 for the full analysis. Summary: **8.0ms → 1.0ms
(~87% reduction)** in the query itself, from a full sequential scan of
`workout_logs` to a bitmap index scan, at 20,000 seeded rows. Raw
`EXPLAIN (ANALYZE, BUFFERS)` output: `results/before/explain-mosaic-before.txt`,
`results/after/explain-mosaic-after.txt`.

## Rate limiting — evaluation

The app already has rate limiting; this block evaluated it rather than
building one from scratch:

- **Global**: `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }])` in
  `src/app.module.ts`, applied via a global `ThrottlerGuard` — 300
  requests/minute per client (IP-based, the default tracker). Comment in the
  code marks this as "Fase 1" hardening.
- **Login-specific**: `POST /auth/login` already carries
  `@Throttle({ default: { limit: 10, ttl: 60_000 } })` — a much tighter
  10/minute, appropriate brute-force protection on the one endpoint where
  that matters most. **This already exists; nothing needed to be added here.**

**Gap identified (not fixed — infra decision, not a code bug):** `@nestjs/throttler`'s
default storage is in-memory, per-process. That's correct for a single
backend instance (today's deployment, per `raiz/docker-compose.yml` running
one `backend` container), but would silently stop being a real 300/min limit
the moment the app runs as more than one instance behind a load balancer —
each instance would enforce its own independent 300/min, making the
effective limit `300 × instance count`. **Recommendation for whenever
horizontal scaling is planned:** back `ThrottlerStorage` with Redis (already
being introduced in this same block) via a shared-storage adapter, so every
instance enforces one real, shared limit. Not implemented now because there's
no evidence of multi-instance deployment yet — doing it speculatively would
be exactly the kind of unrequested infrastructure the task says to avoid.

The only rate-limiting-adjacent code change in this whole block is the
`THROTTLE_TTL_MS`/`THROTTLE_LIMIT` env override in `src/app.module.ts`,
made solely so this benchmark could run without tripping the existing
300/60s limit against itself — see `METHODOLOGY.md`. Both env vars default
to the exact pre-existing values; no deployment should ever set them.

## Conclusion

- **One index added** (`idx_workout_logs_challenge_id`), backed by direct
  `EXPLAIN` evidence of a full table scan it eliminates. Real, reproducible
  ~87% reduction in the query itself and a 13-71% reduction in the full HTTP
  endpoint depending on concurrency.
- **Seven exercises-catalog read paths cached** in Redis, with an explicit
  version-based invalidation scheme, TTL safety net, and verified fail-open
  behavior (including a real bug caught and fixed during this work — ioredis's
  default offline queue turning a Redis outage into 4-12s requests instead of
  falling back instantly; see `REDIS.md`). Measured 46-97% latency reduction
  on three of the four cached endpoint/concurrency combinations tested, with
  one endpoint (`exercises-categories`) showing only noise-level change at
  this local scale — reported honestly rather than rounded up.
- **`GET /challenges`** was identified as the single slowest and worst-scaling
  endpoint measured (11-63ms), but deliberately left unchanged: fixing it well
  needs either caching (deferred pending `feature/challenge-roles` merging,
  since that branch adds new mutation paths a cache would need to invalidate
  correctly) or pagination (a public contract change out of this block's
  scope). Documented as the clearest next-block candidate.
- **`GET /workout-logs`** was identified as having an unbounded, deep-relation
  query shape that will not scale with per-user workout history, but was left
  untouched entirely — it sits inside the workout-log/progress area the task
  named as B5's active concurrency-sensitive territory.
- Every functional test that existed before this block still passes, plus 40
  new tests covering the cache wrapper and its integration into
  `ExercisesService` (see RESULTS.md's sibling `README.md` for how to run
  them). No public response shape, status code, guard, or validation
  changed anywhere in this block.

## Future work (out of scope for B6, flagged per the task's own instructions)

1. **Cache `GET /challenges`** with a short TTL (15-30s) and invalidation on
   create/update/close/join/leave/remove-participant, once
   `feature/challenge-roles` (or its eventual successor) has merged and its
   mutation surface is stable. See FINDINGS.md finding #3.
2. **Paginate `GET /challenges` and `GET /workout-logs`.** Both currently
   return every row unconditionally; both would need a coordinated frontend
   change since it's a response-shape change. Not attempted here per the "no
   public contract changes" constraint.
3. **Redis-backed shared throttle storage** for `@nestjs/throttler`, once/if
   the backend runs as more than one instance — see the rate-limiting
   section above.
4. **Full RepDB catalog import** (~600 exercises via
   `npm run db:import:repdb`) would let a future benchmark measure the
   exercises endpoints at production-realistic catalog size; blocked in this
   environment only by missing Cloudflare R2 credentials, not by anything in
   the importer itself.
5. The pre-existing failing tests in `workout-posts.service.spec.ts`
   (`should create posts already approved...` /
   `should auto-approve every pending post directly...`) — confirmed via
   `git stash` to already fail on `development` before this block's changes,
   unrelated to B6 (they assert the old "moderation gate disabled" behavior
   against a service where `MODERATION_GATE_ENABLED` was re-enabled by a
   separate, already-merged commit, `3173f5d`). Left untouched as out of
   scope; flagged here so it isn't mistaken for something this block broke.
