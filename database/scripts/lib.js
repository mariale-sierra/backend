'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DATABASE_DIR = path.join(__dirname, '..');
const PHASES = ['init', 'migrations', 'seeds'];

function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

    const separatorIndex = trimmed.indexOf('=');
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^"|"$/g, '')
      .replace(/^'|'$/g, '');

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function createClient() {
  loadEnvFile();

  return new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    // Azure Postgres requires TLS (default). A local Postgres container does
    // not speak SSL, so set DB_SSL=false to disable it for local dev only.
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
    // Fail fast instead of hanging forever when the DB is unreachable —
    // connectWithRetry() turns this into bounded retries.
    connectionTimeoutMillis: 10_000,
  });
}

/**
 * Connects with retries so container starts don't race the database:
 * `db:migrate` runs before the API on every boot (Dockerfile CMD and
 * raiz/docker-compose.yml command), and the DB — remote Azure Postgres —
 * may be briefly unreachable (network blip, failover). Retries only
 * connection-level errors; real migration failures still abort the start.
 */
async function connectWithRetry(maxAttempts = 15, delayMs = 2000) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = createClient();
    try {
      await client.connect();
      if (attempt > 1) {
        console.log(`[db] connected after ${attempt} attempt(s)`);
      }
      return client;
    } catch (err) {
      lastError = err;
      await client.end().catch(() => {});
      console.warn(
        `[db] connection attempt ${attempt}/${maxAttempts} failed: ${err.message}`,
      );
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

function listSqlFiles(phase) {
  const dir = path.join(DATABASE_DIR, phase);
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((filename) => filename.endsWith('.sql'))
    .sort() // filenames are YYYY-MM-DD-NN-name.sql, lexical sort == chronological
    .map((filename) => ({
      phase,
      filename,
      filePath: path.join(dir, filename),
    }));
}

function listAllSqlFiles() {
  return PHASES.flatMap(listSqlFiles);
}

async function ensureMigrationsTable(client) {
  await client.query('CREATE SCHEMA IF NOT EXISTS havit');
  await client.query(`
    CREATE TABLE IF NOT EXISTS havit.schema_migrations (
      id SERIAL PRIMARY KEY,
      phase VARCHAR(20) NOT NULL,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedFilenames(client) {
  const result = await client.query('SELECT filename FROM havit.schema_migrations');
  return new Set(result.rows.map((row) => row.filename));
}

module.exports = {
  DATABASE_DIR,
  PHASES,
  loadEnvFile,
  createClient,
  connectWithRetry,
  listAllSqlFiles,
  ensureMigrationsTable,
  getAppliedFilenames,
};
