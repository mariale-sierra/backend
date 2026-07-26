/**
 * Force the whole backend process to run in UTC.
 *
 * The database stores DATE/TIMESTAMP values in UTC (Postgres `now()` /
 * `CURRENT_TIMESTAMP`), but the columns are `TIMESTAMP WITHOUT TIME ZONE`.
 * The node-postgres driver parses those naive timestamps using the process's
 * local timezone. If the process runs in a non-UTC zone (e.g. a dev machine at
 * UTC-6), every timestamp is read ~offset hours off, which shifts day-boundary
 * math (challenge "current day", "today's workout" windows) by up to a full
 * day near midnight — challenges looked stuck on a rest day, progress windows
 * misclassified today's logs, etc.
 *
 * Pinning the process to UTC makes reads, writes and all local-midnight math
 * agree with the UTC database. Imported first in main.ts so it runs before any
 * Date is constructed. Assigning process.env.TZ triggers tzset() so subsequent
 * Date operations honor it.
 */
process.env.TZ = 'UTC';
