#!/usr/bin/env node
/**
 * B6 — isolates cold-cache (Redis miss, hits Postgres) vs warm-cache (Redis
 * hit) latency for the cached exercises endpoints, by bumping the exercises
 * cache version (via a throwaway POST that only admins could call in
 * production, so instead we just flush Redis directly here) before each
 * "cold" sample. Five samples per endpoint, min/avg/max reported — enough to
 * see the shape, not a statistically rigorous distribution.
 */
const { execSync } = require('child_process');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const REDIS_CLI = process.env.REDIS_CLI_CMD || 'redis-cli -p 6390';
const SAMPLES = 5;

const endpoints = [
  '/exercises',
  '/exercises/categories',
  '/exercises/muscle-regions',
];

function flushRedis() {
  execSync(`${REDIS_CLI} flushall`, { stdio: 'ignore' });
}

async function timeRequest(url) {
  const start = process.hrtime.bigint();
  const res = await fetch(url);
  await res.arrayBuffer();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1e6; // ms
}

function stats(samples) {
  return {
    min: Math.min(...samples).toFixed(2),
    avg: (samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2),
    max: Math.max(...samples).toFixed(2),
  };
}

async function main() {
  const results = [];
  for (const path of endpoints) {
    const url = `${BASE_URL}${path}`;
    const coldSamples = [];
    const warmSamples = [];

    for (let i = 0; i < SAMPLES; i++) {
      flushRedis();
      coldSamples.push(await timeRequest(url));
      // Same key immediately after — guaranteed warm hit.
      warmSamples.push(await timeRequest(url));
    }

    results.push({ path, cold: stats(coldSamples), warm: stats(warmSamples) });
  }

  console.log('endpoint'.padEnd(28), 'cold(min/avg/max ms)'.padEnd(24), 'warm(min/avg/max ms)');
  for (const r of results) {
    console.log(
      r.path.padEnd(28),
      `${r.cold.min}/${r.cold.avg}/${r.cold.max}`.padEnd(24),
      `${r.warm.min}/${r.warm.avg}/${r.warm.max}`,
    );
  }

  require('fs').writeFileSync(
    require('path').join(__dirname, '..', 'results', 'after', 'cache-cold-vs-warm.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), samples: SAMPLES, results }, null, 2),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
