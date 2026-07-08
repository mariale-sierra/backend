#!/usr/bin/env node
'use strict';

// Scaffolds a new database/migrations or database/seeds file with the
// YYYY-MM-DD-NN-name.sql naming convention.
//
// Usage:
//   npm run db:new -- migration add-workout-post-tags
//   npm run db:new -- seed metric-types

const fs = require('fs');
const path = require('path');
const { DATABASE_DIR } = require('./lib');

function pad(n) {
  return String(n).padStart(2, '0');
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function slugify(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function nextIndex(dir, date) {
  if (!fs.existsSync(dir)) return 1;

  const prefix = `${date}-`;
  const indices = fs
    .readdirSync(dir)
    .filter((filename) => filename.startsWith(prefix))
    .map((filename) => parseInt(filename.slice(prefix.length, prefix.length + 2), 10))
    .filter((n) => !Number.isNaN(n));

  return indices.length ? Math.max(...indices) + 1 : 1;
}

const [, , kind, ...nameParts] = process.argv;
const phase = kind === 'seed' ? 'seeds' : kind === 'migration' ? 'migrations' : null;
const name = slugify(nameParts.join(' '));

if (!phase || !name) {
  console.error('Usage: npm run db:new -- <migration|seed> <short-name>');
  process.exit(1);
}

const dir = path.join(DATABASE_DIR, phase);
fs.mkdirSync(dir, { recursive: true });

const date = today();
const index = pad(nextIndex(dir, date));
const filename = `${date}-${index}-${name}.sql`;
const filePath = path.join(dir, filename);

fs.writeFileSync(
  filePath,
  `-- ${filename}\n-- TODO: describe this ${phase === 'seeds' ? 'seed' : 'migration'}.\n\n`,
);

console.log(`[db] created database/${phase}/${filename}`);
