# B6 — Redis caching design

## What's cached, and why

Only the exercises-catalog family in `src/exercises/exercises.service.ts` —
see `FINDINGS.md`'s cache candidate evaluation for why everything else was
deferred or excluded:

| Method | Route | TTL |
|---|---|---|
| `findAll()` | `GET /exercises` | 120s |
| `findAllBodyParts()` | `GET /exercises/body-parts` | 300s |
| `findAllCategories()` | `GET /exercises/categories` | 300s |
| `findMuscleRegions()` | `GET /exercises/muscle-regions` | 300s |
| `findMusclesInRegion(code)` | `GET /exercises/muscle-regions/:code/muscles` | 300s |
| `findMuscleDetail(code, page, pageSize)` | `GET /exercises/muscles/:code` | 300s |
| `findFullById(id, locale)` | `GET /exercises/:id/full` | 300s |

`countMatchingExercises()` (`GET /exercises/count`) was deliberately left
uncached — it's a single already-cheap `COUNT` query, not one of the
multi-query paths this block targeted, and adding cache handling to it would
be scope without evidence.

### TTL rationale

Two tiers, both short by caching standards:

- **120s for `findAll()`** — the one paginated/filterable endpoint, with many
  possible cache-key combinations (see below). A shorter TTL bounds how many
  of those combinations can be stale at once after a write.
- **300s (5 min) for everything else** — fixed-shape catalog data
  (categories, body parts, muscle regions, a single exercise's full detail)
  changed only by the two admin-only mutating endpoints
  (`POST /exercises`, `POST /exercises/:id/relations`). A few minutes of
  staleness on "what categories exist" or "what does this exercise look
  like" is unobservable to a user, and is explicitly invalidated immediately
  anyway (see below) — the TTL is a safety net for a missed invalidation
  path, not the primary staleness control.

Neither TTL was picked to "look good" in a benchmark — both are short enough
that a bug in the invalidation logic would self-heal within minutes, per the
task's instruction to prefer explicit invalidation over large TTLs.

### Cache keys

Every key is namespaced under `exercises:` and embeds a per-namespace
**version counter** (`RedisCacheService.getVersion('exercises')`, backed by
a single Redis key `exercises:version`):

```
exercises:v{version}:findAll:{"page":1,"pageSize":20,"locale":"en"}
exercises:v{version}:categories
exercises:v{version}:bodyParts
exercises:v{version}:muscleRegions
exercises:v{version}:musclesInRegion:{regionCode}
exercises:v{version}:muscleDetail:{code}:{page}:{pageSize}
exercises:v{version}:full:{id}:{locale}
```

`findAll`'s key embeds `JSON.stringify(query)` — the exact query DTO
(page/pageSize/locale/search/category/location/region/muscle) — so two
different filter combinations can never collide or return each other's
results; the fixed-shape endpoints' keys need no parameters because their
result never varies by anything but the exercise catalog itself.

### Why a version counter instead of deleting specific keys

`findAll()` has a combinatorial number of possible cache keys (any
combination of page/search/category/location/region/muscle). Redis has no
cheap "delete every key matching a prefix" primitive (`KEYS`/`SCAN` are
expensive and were explicitly worth avoiding here), so enumerating and
deleting every affected `findAll` variant on a mutation isn't practical.
Instead, every cache key in the namespace embeds the *current* version; a
mutation just does `INCR exercises:version`, and every previously-cached key
instantly stops being read (a lookup for `v{N}:...` after the bump reads
`v{N}` from a request built with the *old* version number it already computed,
so this is actually per-request-consistent, not a race — see
`RedisCacheService.getVersion`/`bumpVersion` doc comments). Old, now-orphaned
keys (`exercises:v{N-1}:*`) simply expire via their own TTL — no sweep needed.

### Invalidation

`ExercisesService.create()` and `.updateRelations()` — the only two mutating
endpoints in this module — call `this.cache.bumpVersion('exercises')` after
their write succeeds. That's the entire invalidation surface; see
`src/exercises/exercises.service.ts` for both call sites.

## Failure behavior

`src/cache/redis-cache.service.ts` is a thin wrapper around `ioredis` that
**fails open** everywhere:

- `REDIS_URL` unset → the service never even constructs an `ioredis` client;
  `isEnabled()` is `false`, every `get()`/`getVersion()` resolves as a miss,
  every `set()`/`del()`/`bumpVersion()` is a no-op. The app logs one warning
  at boot and otherwise behaves exactly as it did before Redis existed.
- Redis unreachable or erroring → every method catches its own error, logs a
  rate-limited warning (at most once per 30s, so a sustained outage doesn't
  spam logs), and returns/no-ops the same as the disabled case.
- **`enableOfflineQueue: false` is load-bearing, not incidental.** ioredis's
  default behavior queues commands issued while disconnected and only
  rejects them after riding out `maxRetriesPerRequest` reconnect attempts —
  measured **4-12 seconds per request** locally with Redis killed mid-run,
  which is far worse than just hitting Postgres. With the offline queue
  disabled, a command issued while disconnected fails in ~2-4ms, and the
  caller falls through to the database immediately. This is covered by a
  regression test (`redis-cache.service.spec.ts`: "disables the offline
  command queue...").

Every read-through call site uses `getOrSet()`, whose loader (the real
Postgres query) is the true source of truth and is what actually gets
returned on any cache miss or failure — Redis is purely an accelerator, and
this was verified manually end-to-end (see `RESULTS.md`'s cold/warm section
and the manual "kill Redis mid-run, confirm 200s keep flowing" check
performed while building this).

## Cache stampede

Not addressed with a lock, deliberately. At the traffic level this endpoint
actually sees (a catalog list, not a viral feed) and with TTLs this short
(2-5 minutes), the worst case on expiry is a handful of concurrent requests
each recomputing the same already-cheap query once — the queries being
cached here cost single-digit milliseconds even uncached (see `FINDINGS.md`
finding #2: they were already well-indexed). A `SETNX`-based lock or
request-coalescing would add real complexity (lock acquisition, timeout,
stale-lock recovery) to prevent a cost that's already negligible. Documented
here per the task's instruction to make this decision explicit rather than
silently skip it, not to over-engineer a problem with no evidence behind it.

## Local configuration

`raiz/docker-compose.yml` now starts a `redis:7-alpine` service alongside
`backend` (no host port published by default — only the backend container
needs it, over the internal Docker network as `redis:6379`), and sets
`REDIS_URL=${REDIS_URL:-redis://redis:6379}` on the `backend` service so it
works with zero `.env` changes for anyone already using `raiz/`'s existing
Option A or Option B flow. No healthcheck gate exists between `backend` and
`redis` — intentionally, since a slow/failed Redis must never delay or block
the API starting (see "Failure behavior" above).

Running the backend directly (`npm run start:dev`, as this block's own
benchmarking did — see `README.md`) needs `REDIS_URL` set in `backend/.env`
by hand; `backend/.env.example` documents this.

## Production / Azure

No Azure infrastructure was provisioned as part of this block (no access to
do so from this environment). What's documented instead, for whoever wires
it up:

- Set `REDIS_URL` in the deployed container's environment to an **Azure
  Cache for Redis** connection string, TLS-enabled:
  `rediss://:<access-key>@<cache-name>.redis.cache.windows.net:6380`
  (note `rediss://`, not `redis://` — `ioredis` enables TLS automatically
  from that scheme).
- Never commit that value anywhere — it belongs in whatever secret store
  backs the deployment (the same place `DB_PASSWORD`/`JWT_SECRET` already
  live, per the existing `.env`-on-the-server convention described in
  `backend/README.md`).
- If `REDIS_URL` is never set in production, the app runs exactly as it does
  today — no caching, no behavior change, no crash. This makes the Redis
  rollout itself zero-risk: it can be deployed with caching off, then
  enabled later purely by setting one env var, with no code change.
- No persistence (`appendonly`/RDB snapshots) is needed or configured, here
  or on Azure — this is a cache of already-durable Postgres data, not a
  store of record; an empty cache after a restart is a cold-cache miss, not
  data loss.
