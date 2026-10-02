# B1 methodology

Continuation of B6 (`README.md`/`METHODOLOGY.md`/`FINDINGS.md`/`RESULTS.md`/`REDIS.md`
in this folder). B1's own changes are in `src/challenges/`, `src/workout-log/`,
`src/app.module.ts`, `src/common/pagination.util.ts`, `database/migrations/
2026-10-02-*`, and `raiz/docker-compose.yml` (PgBouncer).

## Load testing stays local-only — not against the deployed backend

Per explicit instruction for this block: no autocannon run targets
`http://20.63.84.1:3000` (the real, shared production backend). Every number
below comes from the same disposable local setup B6 already established —
`havit_perf` (local Postgres, migrated from the real `backend/database/`
files) plus a local Redis — run through `raiz/docker-compose.yml`'s
`backend`/`redis`/`pgbouncer` containers rather than B6's bare
`node dist/src/main.js` process. That's a real environment difference from
B6's numbers (container networking overhead, PgBouncer in the path) — called
out explicitly wherever it matters below, not glossed over.

## PgBouncer validation environment

The task asked for PgBouncer to be validated live against the real Azure
Postgres instance. That wasn't possible from this environment: the
`backend/.env` already present in this checkout turned out to be B6's local
benchmark config (`DB_HOST=localhost`, `DB_DATABASE=havit_perf`), not real
Azure credentials — there are none available here. Confirmed with the user
before proceeding; the agreed fallback was to validate PgBouncer against
that same local `havit_perf` Postgres instead (already running on this
machine from prior B6 work). The pooling mechanics (transaction-mode
multiplexing, TLS-to-server negotiation, env-gated rollout) are identical
regardless of what's on the other side of PgBouncer — only the absolute
network latency numbers would differ against Azure's real round trip, same
caveat B6 already documented for its own local-vs-Azure gap.

One Docker-specific wrinkle, noted for whoever runs this next: PgBouncer's
own DNS resolver (`evdns2`) does **not** consult `/etc/hosts`, so
`host.docker.internal` (which Docker injects only into `/etc/hosts`, not
real DNS) fails to resolve from inside the `pgbouncer` container even though
it resolves fine via `getent`/glibc elsewhere. Worked around locally by
pointing `DB_HOST` at the Docker Desktop VM's literal gateway IP
(`192.168.65.254`) instead — irrelevant in any real deployment, since Azure
Postgres has a real, publicly resolvable DNS name that `evdns2` handles
normally.

## Endpoints and concurrency

Same matrix as B6: `performance/scripts/run-benchmark.js`, concurrency
`[1, 5, 10, 20]`, 200 requests per scenario, unchanged. The `challenges-list`
and `workout-logs-list` scenarios now exercise the new cached + cursor-
paginated code paths automatically — same URLs, changed server-side
behavior — so no new scenario names were needed to cover B1's own changes.

## Connection-pooling evidence (PgBouncer)

Not an autocannon latency test — PgBouncer's value is connection
multiplexing, not per-query speed on a single local Postgres instance.
Measured instead by sampling `pg_stat_activity` (real server-side
connection count for the app's own Postgres role) during a 50-request
concurrent burst against `GET /challenges`, once with `backend` connecting
directly to Postgres and once routed through `pgbouncer`
(`pool_mode = transaction`, `default_pool_size = 20`):

```bash
for i in $(seq 1 50); do
  curl -s -o /dev/null "http://localhost:3000/challenges?limit=5" \
    -H "Authorization: Bearer $TOKEN" &
done; sleep 0.3
psql ... -c "select count(*) from pg_stat_activity where usename='havit_perf';"
```

See `B1-RESULTS.md` for the numbers.
