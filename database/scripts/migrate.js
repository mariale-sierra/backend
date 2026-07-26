#!/usr/bin/env node
'use strict';

// Applies every not-yet-applied file under database/init, database/migrations
// and database/seeds (in that order) against DB_HOST/DB_USERNAME/DB_PASSWORD/
// DB_DATABASE, tracking progress in havit.schema_migrations. Safe to run on
// every deploy/start: already-applied files are skipped.
//
// See "Base de datos y migraciones" in CLAUDE.md for the full workflow.

const fs = require('fs');
const {
  connectWithRetry,
  listAllSqlFiles,
  ensureMigrationsTable,
  getAppliedFilenames,
} = require('./lib');

async function run() {
  // Waits for the database to be reachable before applying anything, so a
  // container start never fails just because the DB was momentarily away.
  const client = await connectWithRetry();

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedFilenames(client);
    const pending = listAllSqlFiles().filter((file) => !applied.has(file.filename));

    if (pending.length === 0) {
      console.log('[db] nothing to apply, schema is up to date');
      return;
    }

    for (const { phase, filename, filePath } of pending) {
      const sql = fs.readFileSync(filePath, 'utf8');
      console.log(`[db] applying ${phase}/${filename}`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO havit.schema_migrations (phase, filename) VALUES ($1, $2)',
          [phase, filename],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[db] FAILED applying ${phase}/${filename}`);
        throw err;
      }
    }

    console.log(`[db] applied ${pending.length} file(s)`);
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error('[db] migration run failed:', err.message);
  process.exit(1);
});
