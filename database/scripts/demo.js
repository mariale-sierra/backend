#!/usr/bin/env node
'use strict';

// Loads the optional demo content in database/demo/*.sql (fake users,
// challenges, posts - see the header of each file). Deliberately separate from
// `db:migrate`: nothing here is tracked or run on boot/deploy, so demo data
// only lands where someone runs `npm run db:demo` on purpose. Dev databases only.

const fs = require('fs');
const path = require('path');
const { connectWithRetry } = require('./lib');

const DEMO_DIR = path.join(__dirname, '..', 'demo');

async function run() {
  const files = fs
    .readdirSync(DEMO_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const client = await connectWithRetry();
  try {
    for (const filename of files) {
      const sql = fs.readFileSync(path.join(DEMO_DIR, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
        console.log(`[db:demo] applied ${filename}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error('[db:demo] failed:', err.message);
  process.exit(1);
});
