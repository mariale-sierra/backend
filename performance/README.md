# B6 — Performance, Redis & scalability

This folder holds everything for the B6 sprint block: a reproducible load-test
harness, raw before/after results, and the analysis behind the optimizations
in `../database/migrations/2026-09-27-01-add-workout-logs-challenge-id-index.sql`
and the Redis caching in `../src/cache/`.

Read [`METHODOLOGY.md`](./METHODOLOGY.md) for exactly how the benchmark was
run and why (endpoints, concurrency, environment, confounders). Read
[`FINDINGS.md`](./FINDINGS.md) for the bottleneck analysis and the cache
candidate evaluation. Read [`REDIS.md`](./REDIS.md) for the caching design
(keys, TTL, invalidation, failure behavior, local/Azure config). Read
[`RESULTS.md`](./RESULTS.md) for the before/after numbers, the rate-limiting
evaluation, the conclusion, and future work.

## Why a local database, not the shared Azure Postgres

The shared Azure instance (`DB_HOST` in `backend/.env` — see root `CLAUDE.md`)
is real infrastructure other people are actively using. B6's own instructions
are explicit about not stress-testing it, not writing large synthetic
datasets into it, and not running anything that could affect other
contributors. This machine also has no Azure credentials configured (no
`backend/.env` existed before this work — it's gitignored and was never
committed), so hitting Azure directly wasn't even possible here.

Instead, every measurement in this folder runs against a **disposable local
Postgres** (a database named `havit_perf`, migrated from the exact same
`backend/database/init|migrations|seeds` files as production) seeded with a
moderate amount of synthetic data (see `fixtures/`). This is safe, reproducible
by anyone without Azure access, and lets BEFORE/AFTER conditions be held
perfectly constant (same data, same machine, same process) — the one thing
`METHODOLOGY.md` calls out explicitly is what this trades away: real Azure
network latency is not part of these numbers, so absolute latencies here are
a floor, not what production actually experiences (see that file's
"Confounders / what this does NOT measure" section).

## Reproducing this from a clean checkout

```bash
cd backend
npm install
```

### 1. Local Postgres (disposable, separate from any Docker Postgres you use for dev)

```bash
# Requires a local Postgres server (e.g. `brew install postgresql@18 && brew services start postgresql@18`,
# or use raiz/docker-compose.local.yml's `db` service instead — either works, this just needs
# *some* reachable local Postgres).
psql -h localhost -U "$(whoami)" -d postgres -c "CREATE ROLE havit_perf LOGIN PASSWORD 'havit_perf_local_only';"
psql -h localhost -U "$(whoami)" -d postgres -c "CREATE DATABASE havit_perf OWNER havit_perf;"
```

### 2. `backend/.env` (gitignored — never commit this)

Copy `backend/.env.example` to `backend/.env` and set:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=havit_perf
DB_PASSWORD=havit_perf_local_only
DB_DATABASE=havit_perf
DB_SSL=false
JWT_SECRET=local-benchmark-only-secret-do-not-use-in-prod
REDIS_URL=redis://localhost:6390
# Benchmark-only — see METHODOLOGY.md's "Why the throttle is raised" section.
# Never set this outside a local benchmark run.
THROTTLE_LIMIT=100000
```

### 3. Migrate + seed fixture data

```bash
npm run db:migrate                              # creates schema on the fresh local DB
node performance/fixtures/run-local-fixtures.js  # ~500 users / 300 challenges / 20k workout logs / ~7k posts
```

`run-local-fixtures.js` refuses to run unless `DB_HOST` resolves to a local
host — see its own header comment. Never point it at Azure.

### 4. Redis (local)

```bash
brew install redis
redis-server --port 6390 --save ""   # or: docker run --rm -p 6390:6379 redis:7-alpine
```

Or, for the full local Docker stack (backend + Postgres + Redis together),
see `raiz/README.md`'s Option B (`npm run dev:local`) — `raiz/docker-compose.yml`
now also starts a `redis` service by default (see `REDIS.md`).

### 5. Run the app and the benchmark

```bash
npm run build && node dist/src/main.js &
node performance/scripts/run-benchmark.js before   # or "after"
node performance/scripts/measure-cache-cold-warm.js
```

Raw results land in `performance/results/before/` and `performance/results/after/`
as one JSON file per (endpoint, concurrency) scenario, plus `_all-results.json`
and `comparison-summary.json`. Nothing here contains secrets — it's request
counts and latency numbers only.

### 6. Tests / lint / build

```bash
npm test            # includes src/cache/redis-cache.service.spec.ts and the
                     # caching tests in src/exercises/exercises.service.spec.ts
npm run lint
npm run build
```
