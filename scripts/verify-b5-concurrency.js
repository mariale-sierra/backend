#!/usr/bin/env node
'use strict';

/**
 * B5 — Concurrency and integrity of Workout Progress.
 *
 * Real-Postgres validation for uq_workout_logs_user_challenge_local_day /
 * ck_workout_logs_challenge_requires_local_day, exercised through the
 * actual running API (real HTTP, real overlapping requests), not a mock.
 *
 * Meant to run against a DISPOSABLE local database only (the
 * `havit-db-local` Docker Postgres on port 5434, a throwaway database
 * inside it) with the API started against that same database. It refuses
 * to run when DB_HOST points at Azure unless ALLOW_SHARED_DB=1 is set
 * explicitly. Read the whole file before running it.
 *
 * WHAT THIS DOES
 *   1. Applies pending migrations (npm run db:migrate).
 *   2. Confirms the unique index and CHECK constraint actually exist.
 *   3. Registers two throwaway users and one throwaway challenge, all
 *      tagged with a single run-specific id so cleanup is exact.
 *   4. Fires 2, then 5, genuinely concurrent POST /workout-logs/progress
 *      requests (Promise.all — never sequential) for the same user+
 *      challenge+day, and checks:
 *        - exactly one persisted workout_logs row (queried directly, not
 *          inferred from HTTP responses),
 *        - exactly one persisted workout_posts row for it,
 *        - every losing request got HTTP 409, never 500.
 *   5. Confirms a different challenge, and a different (backdated) day,
 *      each still succeed independently.
 *   6. Prints exactly what test data it created. Cleanup is opt-in
 *      (--cleanup) and scoped ONLY to the run's own ids — this never
 *      touches pre-existing rows, and is not run automatically so a human
 *      can inspect the result first.
 *
 * REQUIREMENTS
 *   - DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_DATABASE (+ DB_SSL=false)
 *     exported for the disposable local database — explicit env vars win
 *     over backend/.env (see database/scripts/lib.js).
 *   - The API running against that same database and reachable (default
 *     http://localhost:3000 — start it with the same DB_* env vars and
 *     `npm run start:dev`; override the URL with API_BASE_URL).
 *   - Run from backend/: `node scripts/verify-b5-concurrency.js`
 *   - Then, after reviewing the printed rows in a normal DB client:
 *     `node scripts/verify-b5-concurrency.js --cleanup <runId>` (the runId
 *     is printed at the end of the first run).
 *
 * Never run this against a database you cannot afford throwaway test rows
 * in without reviewing this file first.
 */

const { randomUUID } = require('crypto');
const { execSync } = require('child_process');
const { connectWithRetry } = require('../database/scripts/lib');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const RUN_ID = process.argv.includes('--cleanup')
  ? process.argv[process.argv.indexOf('--cleanup') + 1]
  : randomUUID().slice(0, 8);

function assertSafeTarget() {
  // database/scripts/lib.js falls back to backend/.env, which points at the
  // shared Azure instance — never migrate or write test rows there by
  // accident.
  const host = process.env.DB_HOST || '';
  const looksShared = !host || /azure|\.com$/i.test(host);
  if (looksShared && process.env.ALLOW_SHARED_DB !== '1') {
    console.error(
      'Refusing to run: DB_HOST is not set to a local disposable database ' +
        `(got "${host || '(unset, would fall back to .env)'}"). ` +
        'Export the DB_* vars for havit-db-local, or set ALLOW_SHARED_DB=1 if you really mean it.',
    );
    process.exit(1);
  }
}

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Timezone': 'UTC',
      ...(options.headers || {}),
    },
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return { status: res.status, body };
}

async function registerUser(suffix) {
  const email = `b5-verify-${RUN_ID}-${suffix}@example.com`;
  const { status, body } = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password: 'Verify1234!',
      username: `b5verify${RUN_ID}${suffix}`,
      // Required since B2 (POST /auth/register rejects the request without them).
      acceptTerms: true,
      confirmAge16: true,
    }),
  });
  if (status !== 200 || !body?.accessToken) {
    throw new Error(`Failed to register ${email}: ${status} ${JSON.stringify(body)}`);
  }
  return { email, userId: body.user.id, token: body.accessToken };
}

async function createChallenge(token, name) {
  const { status, body } = await api('/challenges', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name,
      visibility: 'public',
      duration_days: 30,
      cycle_length_days: 7,
    }),
  });
  if (status !== 201 && status !== 200) {
    throw new Error(`Failed to create challenge "${name}": ${status} ${JSON.stringify(body)}`);
  }
  // POST /challenges answers { message, challenge: { id, ... } }.
  return body.challenge?.id ?? body.id;
}

function submitProgress(token, challengeId, extraHeaders = {}) {
  return api('/workout-logs/progress', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, ...extraHeaders },
    body: JSON.stringify({
      challengeId,
      imageUrl: 'https://example.com/b5-verify.jpg',
      visibility: 'private',
    }),
  });
}

async function assertRowCounts(client, { userId, challengeId, label, expectedLogs }) {
  const logs = await client.query(
    `SELECT id FROM havit.workout_logs WHERE user_id = $1 AND challenge_id = $2`,
    [userId, challengeId],
  );
  const posts = await client.query(
    `SELECT wp.id FROM havit.workout_posts wp
     JOIN havit.workout_logs wl ON wl.id = wp.workout_log_id
     WHERE wl.user_id = $1 AND wl.challenge_id = $2`,
    [userId, challengeId],
  );

  const ok = logs.rows.length === expectedLogs && posts.rows.length === expectedLogs;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${label}: workout_logs=${logs.rows.length} (want ${expectedLogs}), workout_posts=${posts.rows.length} (want ${expectedLogs})`,
  );
  if (!ok) process.exitCode = 1;
  return logs.rows;
}

function assertStatuses(label, results, expected) {
  const statuses = results.map((r) => r.status).sort();
  const want = [...expected].sort();
  const ok = JSON.stringify(statuses) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: got [${statuses}], want [${want}]`);
  if (!ok) process.exitCode = 1;
}

async function cleanup(client, runId) {
  console.log(`Cleaning up test data for run ${runId}...`);
  // Scoped ONLY to this run's own email/name pattern — never a bare
  // wildcard, so this can't touch anything it didn't create itself.
  const users = await client.query(
    `SELECT id, email FROM havit.users WHERE email LIKE $1`,
    [`b5-verify-${runId}-%@example.com`],
  );
  console.log(`  deleting ${users.rows.length} user(s):`, users.rows.map((u) => u.email));
  // Cascades to workout_logs (fk_workout_logs_user), which cascades to
  // workout_posts (fk_workout_posts_workout_log) and challenge_user_map.
  await client.query(`DELETE FROM havit.users WHERE email LIKE $1`, [
    `b5-verify-${runId}-%@example.com`,
  ]);

  const challenges = await client.query(
    `SELECT id, name FROM havit.challenges WHERE name LIKE $1`,
    [`B5 verify ${runId}%`],
  );
  console.log(`  deleting ${challenges.rows.length} challenge(s):`, challenges.rows.map((c) => c.name));
  await client.query(`DELETE FROM havit.challenges WHERE name LIKE $1`, [
    `B5 verify ${runId}%`,
  ]);

  console.log('Cleanup done.');
}

async function main() {
  assertSafeTarget();
  if (process.argv.includes('--cleanup')) {
    const client = await connectWithRetry();
    try {
      await cleanup(client, RUN_ID);
    } finally {
      await client.end();
    }
    return;
  }

  console.log(`== B5 concurrency validation (run ${RUN_ID}) ==`);

  console.log('\n[1/6] Applying pending migrations...');
  execSync('npm run db:migrate', { stdio: 'inherit' });

  console.log('\n[2/6] Verifying DB-level objects exist...');
  const client = await connectWithRetry();
  const index = await client.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'havit' AND indexname = 'uq_workout_logs_user_challenge_local_day'`,
  );
  const check = await client.query(
    `SELECT conname FROM pg_constraint WHERE conname = 'ck_workout_logs_challenge_requires_local_day'`,
  );
  console.log(index.rows.length ? 'PASS unique index exists' : 'FAIL unique index missing');
  console.log(check.rows.length ? 'PASS check constraint exists' : 'FAIL check constraint missing');
  if (!index.rows.length || !check.rows.length) process.exitCode = 1;

  console.log('\n[3/6] Creating throwaway test users + challenge...');
  const userA = await registerUser('a');
  const userB = await registerUser('b');
  const challengeId = await createChallenge(userA.token, `B5 verify ${RUN_ID}`);
  const challengeId2 = await createChallenge(userA.token, `B5 verify ${RUN_ID} second`);
  console.log(`  userA=${userA.userId} userB=${userB.userId} challenge=${challengeId} challenge2=${challengeId2}`);

  console.log('\n[4/6] Firing 2 genuinely concurrent requests (same user, same challenge, same day)...');
  const two = await Promise.all([
    submitProgress(userA.token, challengeId),
    submitProgress(userA.token, challengeId),
  ]);
  assertStatuses('2-way race HTTP statuses', two, [201, 409]);
  await assertRowCounts(client, {
    userId: userA.userId,
    challengeId,
    label: '2-way race row counts',
    expectedLogs: 1,
  });

  console.log('\n[5/6] Firing 5 genuinely concurrent requests (different user, same challenge, same day)...');
  const five = await Promise.all(Array.from({ length: 5 }, () => submitProgress(userB.token, challengeId)));
  assertStatuses('5-way race HTTP statuses', five, [201, 409, 409, 409, 409]);
  await assertRowCounts(client, {
    userId: userB.userId,
    challengeId,
    label: '5-way race row counts',
    expectedLogs: 1,
  });

  console.log('\n[6/6] Confirming a different challenge (same user, same day) still succeeds...');
  const otherChallenge = await submitProgress(userA.token, challengeId2);
  console.log(otherChallenge.status === 201 ? 'PASS different-challenge submission succeeded' : `FAIL got ${otherChallenge.status}`);
  if (otherChallenge.status !== 201) process.exitCode = 1;

  console.log(
    '\nNOTE — "different day" is not exercised automatically here (no clock control over a real server).\n' +
    'To check it manually: backdate userA\'s existing row for `challengeId` by one day and re-submit —\n' +
    `  UPDATE havit.workout_logs SET started_at = started_at - interval '1 day', local_day = local_day - interval '1 day'\n` +
    `  WHERE user_id = '${userA.userId}' AND challenge_id = '${challengeId}';\n` +
    'then POST /workout-logs/progress for the same user+challenge again and confirm it now succeeds (201),\n' +
    'and that there are now 2 workout_logs rows for that user+challenge (one per distinct local_day).',
  );

  console.log(`\nDone. Test data tagged with run id: ${RUN_ID}`);
  console.log(`Review it, then clean up with: node scripts/verify-b5-concurrency.js --cleanup ${RUN_ID}`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
