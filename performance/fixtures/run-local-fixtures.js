#!/usr/bin/env node
/**
 * Safety-gated runner for generate-local-fixtures.sql. Refuses to run unless
 * DB_HOST clearly points at a local database — this file inserts thousands of
 * synthetic rows and must never touch the shared Azure Postgres instance.
 */
const path = require('path');
const { execFileSync } = require('child_process');

// Reuses the same .env loader every other database/scripts/*.js tool uses.
const lib = require('../../database/scripts/lib.js');
lib.loadEnvFile();

const host = process.env.DB_HOST || '';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
if (!LOCAL_HOSTS.has(host)) {
  console.error(
    `[fixtures] Refusing to run: DB_HOST="${host}" is not a recognized local host ` +
      `(${[...LOCAL_HOSTS].join(', ')}). This script inserts ~20k synthetic rows and ` +
      'must only ever run against a disposable local database.',
  );
  process.exit(1);
}

const sqlFile = path.join(__dirname, 'generate-local-fixtures.sql');
const args = [
  '-h',
  host,
  '-p',
  process.env.DB_PORT || '5432',
  '-U',
  process.env.DB_USERNAME,
  '-d',
  process.env.DB_DATABASE,
  '-v',
  'ON_ERROR_STOP=1',
  '-f',
  sqlFile,
];

console.log(`[fixtures] Applying ${sqlFile} to ${host}:${process.env.DB_PORT || 5432}/${process.env.DB_DATABASE} ...`);
execFileSync('psql', args, {
  stdio: 'inherit',
  env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD },
});
