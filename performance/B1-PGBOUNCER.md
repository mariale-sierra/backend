# B1 — PgBouncer

## Design

`raiz/docker-compose.yml` now starts a `pgbouncer` container
(`edoburu/pgbouncer`) between `backend` and Postgres (Azure in a real
deployment; a local `havit_perf` instance for the validation run described
in `B1-METHODOLOGY.md`). It's **opt-in**: `backend` only routes through it
when `DB_POOL_HOST`/`DB_POOL_PORT` are set in `.env` (pointing at the
`pgbouncer` service, `pgbouncer:6432`) — unset keeps the pre-B1 direct
connection, with the `pgbouncer` container simply idle. Same zero-risk,
env-gated rollout convention as `REDIS_URL` (see `REDIS.md`).

```
backend  --DB_POOL_HOST/PORT-->  pgbouncer:6432  --DATABASE_URL-->  Postgres
   \--------------------------DB_HOST/PORT (migrations, unaffected)---/
```

- **`src/app.module.ts`**: `TypeOrmModule.forRoot`'s `host`/`port` now read
  `DB_POOL_HOST || DB_HOST` / `DB_POOL_PORT || DB_PORT` (`||`, not `??` —
  see the code comment; a Docker Compose env var that's unset in `.env` but
  still declared in a service's `environment:` block arrives as an actual
  empty string, which `??` would keep instead of falling through — caught
  live while bringing this stack up, not guessed). An explicit
  `extra: { max: DB_POOL_SIZE ?? 10 }` bounds the app's own `pg` pool size,
  since PgBouncer — not `pg` — now does the real multiplexing.
- **`database/scripts/migrate.js`** (and the fixture/baseline scripts) are
  unchanged: they always use `DB_HOST`/`DB_PORT` directly, bypassing the
  pool entirely. DDL and one-off tooling have no reason to go through a
  transaction-mode pool, and keeping them on a direct connection removes an
  entire class of pooling-related migration edge cases from consideration.

## Why `pool_mode = transaction`

This is a stateless REST API: no `LISTEN/NOTIFY`, no session-level `SET`,
no advisory locks held across a request (confirmed by reading the backend —
nothing in `src/` does any of this). Transaction pooling is the standard,
safe choice for exactly this shape of app, and gives the real scalability
win (many client connections multiplexed onto a much smaller number of real
Postgres connections) that session pooling would not.

## TLS

Azure Database for PostgreSQL requires TLS for every connection
(`app.module.ts`'s existing `ssl` handling already reflects this).
`pgbouncer`'s `SERVER_TLS_SSLMODE` defaults to `require` for exactly that
reason; it's overridable via `PGBOUNCER_SERVER_TLS_SSLMODE` in `.env` only
for a non-TLS local Postgres (the local validation run used `disable` for
this reason — never set this outside a local, non-Azure Postgres).

## Secrets

`edoburu/pgbouncer` generates its `pgbouncer.ini` and a hashed
`userlist.txt` at container start from a single `DATABASE_URL` built from
the same `DB_USERNAME`/`DB_PASSWORD`/`DB_HOST`/`DB_PORT`/`DB_DATABASE`
already in `.env` (gitignored, never committed) — no new secret file, no
password in any committed config. Note from the image's own entrypoint
script: `docker inspect` will show the resolved `DATABASE_URL` env var in
plaintext, same exposure `DB_PASSWORD` already has on the `backend`
container today — not a new risk this introduces.

## Validated live (this block)

Brought up `raiz/docker-compose.yml` (backend + redis + pgbouncer) with
Docker running locally, pointed at the local `havit_perf` Postgres (see
`B1-METHODOLOGY.md` for why not real Azure, and the `host.docker.internal`
DNS wrinkle worked around to get there). Confirmed:

- `pgbouncer` logs a successful upstream connection
  (`S-...: havit_perf/havit_perf@<host>:5432 new connection to server`).
- `npm run db:migrate` (the direct path) ran both new B1 migrations
  successfully on container boot, confirmed via
  `havit.schema_migrations`.
- The app boots and serves real requests through the pooled path — login,
  `GET /challenges` (with the new cursor pagination and `X-Next-Cursor`
  header), `GET /workout-logs` all returned `200`.
- Connection multiplexing is real, not just theoretical — see
  `B1-RESULTS.md`'s `pg_stat_activity` comparison.

## Pending manual step — Azure `max_connections`

Not derivable from this repo or this environment (no Azure Portal access
here). Before enabling `DB_POOL_HOST`/`DB_POOL_PORT` against the real Azure
instance:

1. Check the Azure Portal → the Postgres flexible/single server resource →
   Server parameters → `max_connections` (or the equivalent compute-tier
   default if unset).
2. Size `pgbouncer`'s `DEFAULT_POOL_SIZE` / `MAX_CLIENT_CONN` so that
   `DEFAULT_POOL_SIZE × (number of backend instances, today 1) + headroom
   for admin/migration connections ≤ max_connections`. The values currently
   in `docker-compose.yml` (`DEFAULT_POOL_SIZE=20`, `MAX_CLIENT_CONN=200`)
   are a conservative starting point for a single-instance deployment —
   **revisit once step 1 is done**, especially before running more than one
   `backend` instance behind a load balancer.
