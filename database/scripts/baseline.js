#!/usr/bin/env node
'use strict';

// One-time-per-database escape hatch: marks every current database/init,
// database/migrations and database/seeds file as already applied WITHOUT
// running their SQL. Use this only when pointing the migration system at a
// database whose schema was already created by hand (this is the case for
// the existing Azure DB the first time this system is wired up) so that
// `npm run db:migrate` doesn't try to re-run CREATE TABLE/CREATE TYPE
// statements that would fail because the objects already exist.
//
// Do NOT run this against a fresh/empty database - use `npm run db:migrate`
// instead so init/migrations/seeds actually execute.
//
// See "Base de datos y migraciones" in CLAUDE.md for the full workflow.

const {
  createClient,
  listAllSqlFiles,
  ensureMigrationsTable,
  getAppliedFilenames,
} = require('./lib');

async function run() {
  const client = createClient();
  await client.connect();

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedFilenames(client);
    const toBaseline = listAllSqlFiles().filter((file) => !applied.has(file.filename));

    if (toBaseline.length === 0) {
      console.log('[db] nothing to baseline, all files are already tracked');
      return;
    }

    for (const { phase, filename } of toBaseline) {
      await client.query(
        'INSERT INTO havit.schema_migrations (phase, filename) VALUES ($1, $2)',
        [phase, filename],
      );
      console.log(`[db] baselined ${phase}/${filename} (not executed)`);
    }

    console.log(`[db] baselined ${toBaseline.length} file(s)`);
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error('[db] baseline failed:', err.message);
  process.exit(1);
});
