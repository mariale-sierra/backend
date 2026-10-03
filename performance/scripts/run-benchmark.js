#!/usr/bin/env node
/**
 * B6 performance benchmark runner.
 *
 * Hits a fixed set of real, existing GET endpoints (challenges, workout-log,
 * workout-posts, exercises) at a few conservative concurrency levels using
 * autocannon, and writes one raw JSON result file per (endpoint, concurrency)
 * combination — see README.md in this folder for how to run it and where
 * results land.
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 \
 *   AUTH_EMAIL=testuser@havit.dev AUTH_PASSWORD='TestHavit123!' \
 *   node performance/scripts/run-benchmark.js before   # or "after"
 *
 * Deliberately uses a fixed request `amount` per scenario (not a fixed
 * duration) — see METHODOLOGY.md's "Why amount-based, not duration-based"
 * note: it keeps every scenario's total request count small and predictable
 * regardless of how fast responses come back, which matters because every
 * request in a run shares one global rate-limit bucket per source IP
 * (ThrottlerModule in src/app.module.ts). BEFORE and AFTER always use the
 * exact same amount/concurrency list so they stay comparable.
 */
const fs = require('fs');
const path = require('path');
const autocannon = require('autocannon');
const { execSync } = require('child_process');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const AUTH_EMAIL = process.env.AUTH_EMAIL || 'testuser@havit.dev';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'TestHavit123!';
const CONCURRENCY_LEVELS = [1, 5, 10, 20];
const AMOUNT_PER_SCENARIO = 200; // fixed request count, not a fixed duration — see header comment
const PAUSE_BETWEEN_SCENARIOS_MS = 1500;

const scenario = process.argv[2];
if (!['before', 'after'].includes(scenario)) {
  console.error('Usage: node run-benchmark.js <before|after>');
  process.exit(1);
}

const outDir = path.join(__dirname, '..', 'results', scenario);
fs.mkdirSync(outDir, { recursive: true });

function gitInfo() {
  try {
    const sha = execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '..', '..') })
      .toString()
      .trim();
    const branch = execSync('git branch --show-current', { cwd: path.join(__dirname, '..', '..') })
      .toString()
      .trim();
    return { sha, branch };
  } catch {
    return { sha: 'unknown', branch: 'unknown' };
  }
}

async function login() {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: AUTH_EMAIL, password: AUTH_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.accessToken;
}

async function pickSampleChallengeId(token) {
  const res = await fetch(`${BASE_URL}/challenges`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  const withPosts = body.data?.find((c) => c.id) ?? body.data?.[0];
  return withPosts?.id;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runScenario({ name, url, headers, connections }) {
  const result = await autocannon({
    url,
    headers,
    connections,
    amount: AMOUNT_PER_SCENARIO,
    pipelining: 1,
  });
  return {
    name,
    url,
    connections,
    amount: AMOUNT_PER_SCENARIO,
    timestamp: new Date().toISOString(),
    ...gitInfo(),
    scenario,
    stats: {
      durationSeconds: result.duration,
      requests: {
        total: result.requests.total,
        average: result.requests.average,
        mean: result.requests.mean,
      },
      throughputBytesPerSec: result.throughput.average,
      latencyMs: {
        average: result.latency.average,
        p50: result.latency.p50,
        p75: result.latency.p75,
        p90: result.latency.p90,
        p97_5: result.latency.p97_5,
        p99: result.latency.p99,
        min: result.latency.min,
        max: result.latency.max,
      },
      errors: result.errors,
      timeouts: result.timeouts,
      non2xx: result.non2xx,
      statusCodeStats: result.statusCodeStats,
    },
  };
}

async function main() {
  console.log(`[bench] scenario=${scenario} baseUrl=${BASE_URL}`);
  const token = await login();
  const authHeaders = { Authorization: `Bearer ${token}` };
  const sampleChallengeId = await pickSampleChallengeId(token);
  if (!sampleChallengeId) {
    console.warn('[bench] No challenge found to use for workout-posts/mosaic — that endpoint will be skipped.');
  }

  const endpoints = [
    { name: 'exercises-list', url: `${BASE_URL}/exercises`, headers: {} },
    { name: 'exercises-categories', url: `${BASE_URL}/exercises/categories`, headers: {} },
    { name: 'exercises-muscle-regions', url: `${BASE_URL}/exercises/muscle-regions`, headers: {} },
    { name: 'challenges-list', url: `${BASE_URL}/challenges`, headers: {} },
    { name: 'workout-logs-list', url: `${BASE_URL}/workout-logs`, headers: authHeaders },
    ...(sampleChallengeId
      ? [
          {
            name: 'workout-posts-mosaic',
            url: `${BASE_URL}/workout-posts/mosaic?challengeId=${sampleChallengeId}`,
            headers: authHeaders,
          },
        ]
      : []),
  ];

  const allResults = [];
  for (const endpoint of endpoints) {
    for (const connections of CONCURRENCY_LEVELS) {
      process.stdout.write(
        `[bench] ${endpoint.name} @ concurrency=${connections} (${AMOUNT_PER_SCENARIO} requests)... `,
      );
      const result = await runScenario({ ...endpoint, connections });
      console.log(
        `avg=${result.stats.latencyMs.average.toFixed(2)}ms p95≈${result.stats.latencyMs.p97_5.toFixed(2)}ms errors=${result.stats.errors} non2xx=${result.stats.non2xx}`,
      );
      allResults.push(result);

      const fileName = `${endpoint.name}__c${connections}.json`;
      fs.writeFileSync(path.join(outDir, fileName), JSON.stringify(result, null, 2));

      await sleep(PAUSE_BETWEEN_SCENARIOS_MS);
    }
  }

  fs.writeFileSync(
    path.join(outDir, '_all-results.json'),
    JSON.stringify(allResults, null, 2),
  );
  console.log(`[bench] Done. Raw results written to ${outDir}`);
}

main().catch((err) => {
  console.error('[bench] Failed:', err);
  process.exit(1);
});
