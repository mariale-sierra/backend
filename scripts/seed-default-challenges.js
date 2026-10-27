#!/usr/bin/env node
'use strict';

/**
 * Sprint 10 — creates the default challenges (scripts/default-challenges.js)
 * through the public API, as the official @havit account: the same path the app
 * takes (cover upload to R2 + moderation, routines built from the real exercise
 * catalog), so nothing is written to the database by hand.
 *
 * Usage (PowerShell, from backend/):
 *   $env:HAVIT_EMAIL = "..."; $env:HAVIT_PASSWORD = "..."
 *   $env:HAVIT_COVERS_DIR = "C:\ruta\a\portadas"
 *   node scripts/seed-default-challenges.js --dry-run   # validates only, creates nothing
 *   node scripts/seed-default-challenges.js             # creates them
 *
 * Optional: HAVIT_API_URL (default http://20.63.84.1:3000).
 *
 * Safe to re-run: a challenge the account already has with the same name is
 * skipped. The password is only sent to the API's own /auth/login, never logged.
 */

const fs = require('fs');
const path = require('path');
const DEFAULT_CHALLENGES = require('./default-challenges');

const API_URL = (process.env.HAVIT_API_URL || 'http://20.63.84.1:3000').replace(/\/+$/, '');
const EMAIL = process.env.HAVIT_EMAIL;
const PASSWORD = process.env.HAVIT_PASSWORD;
const COVERS_DIR = process.env.HAVIT_COVERS_DIR;
const DRY_RUN = process.argv.includes('--dry-run');

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // backend DEFAULT_UPLOAD_MAX_BYTES
const COVER_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const CATEGORY_CODE_TO_ACTIVITY = {
  strength: 'strength',
  'cardio-intense': 'cardioIntense',
  'cardio-low': 'cardioLow',
  flexibility: 'flexibility',
  'mind-body': 'mindBody',
  functional: 'functional',
};

class SeedError extends Error {}

async function api(method, route, { token, body } = {}) {
  const res = await fetch(`${API_URL}${route}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const message = data && typeof data === 'object' ? data.message : data;
    throw new SeedError(`${method} ${route} -> ${res.status}: ${JSON.stringify(message)}`);
  }
  return data;
}

function parseTime(value) {
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(value || '');
  if (!match) throw new SeedError(`invalid time "${value}" (use mm:ss)`);
  return { minutes: Number(match[1]), seconds: Number(match[2]) };
}

function findCover(slug) {
  if (!COVERS_DIR) throw new SeedError('set HAVIT_COVERS_DIR to the folder with the cover photos');
  for (const ext of Object.keys(COVER_TYPES)) {
    const file = path.join(COVERS_DIR, slug + ext);
    if (fs.existsSync(file)) {
      const size = fs.statSync(file).size;
      if (size > MAX_UPLOAD_BYTES) {
        throw new SeedError(`${path.basename(file)} is ${(size / 1048576).toFixed(1)} MB; the limit is 5 MB`);
      }
      return { file, size, type: COVER_TYPES[ext] };
    }
  }
  throw new SeedError(`no cover "${slug}.jpg/.png/.webp" in ${COVERS_DIR}`);
}

/** One catalog exercise, by exact (case-insensitive) name, with the metrics it tracks. */
const exerciseCache = new Map();
async function lookupExercise(token, name) {
  const key = name.toLowerCase();
  if (exerciseCache.has(key)) return exerciseCache.get(key);

  const query = new URLSearchParams({ search: name, pageSize: '50' });
  const list = await api('GET', `/exercises?${query}`, { token });
  const match = (list.data || []).find((e) => String(e.name).toLowerCase() === key);
  if (!match) throw new SeedError(`exercise "${name}" is not in the catalog`);

  const full = await api('GET', `/exercises/${match.id}/full`, { token });
  const exercise = {
    id: match.id,
    name: match.name,
    activityType: CATEGORY_CODE_TO_ACTIVITY[match.category?.code] || null,
    trackingMode: match.trackingMode,
    locations: (match.locations || []).map((l) => l.name),
    metrics: (full.metrics || []).map((m) => ({ code: m.code, valueType: m.valueType })),
  };
  exerciseCache.set(key, exercise);
  return exercise;
}

/** The challenge exercise payload, the same shape the app's create flow sends. */
function buildExercise(def, exercise, challenge) {
  const location =
    exercise.locations.find((l) => challenge.locations.includes(l)) || exercise.locations[0] || challenge.locations[0];
  const base = {
    name: exercise.name,
    location,
    // The exercise's own catalog category: the backend links the exercise to
    // whatever category is sent, so anything else would add a new relation to
    // the shared catalog.
    activity_type: exercise.activityType || challenge.activity,
  };

  if (def.sets) {
    if (exercise.trackingMode !== 'sets') {
      throw new SeedError(`"${def.name}" is a timed exercise in the catalog; give it a time, not sets`);
    }
    return {
      ...base,
      metric_type: 'strength',
      metrics: {
        kind: 'strength',
        sets: Array.from({ length: def.sets }, (_, i) => ({
          set_number: i + 1,
          reps: def.reps,
          rest_seconds: def.rest ?? 60,
        })),
      },
    };
  }

  const values = {};
  for (const metric of exercise.metrics) {
    if (metric.valueType === 'seconds' && def.time) values[metric.code] = parseTime(def.time);
    else if (metric.code === 'distance' && def.distance != null) values.distance = def.distance;
    else if (metric.code === 'reps' && def.reps != null) values.reps = def.reps;
  }
  if (Object.keys(values).length === 0) {
    throw new SeedError(
      `"${def.name}" tracks ${exercise.metrics.map((m) => m.code).join(', ') || 'nothing'}; none of them got a value`,
    );
  }
  return {
    ...base,
    metric_type: 'schema',
    metrics: { kind: 'schema', template_id: `exercise-${exercise.id}-metrics`, values },
  };
}

async function buildPayload(token, challenge) {
  const cycleDays = [];
  for (const [index, day] of challenge.days.entries()) {
    if (day.rest) {
      cycleDays.push({ day_number: index + 1, is_rest_day: true, routine_name: 'Rest day', routine_description: '', exercises: [] });
      continue;
    }
    const exercises = [];
    for (const def of day.exercises) {
      exercises.push(buildExercise(def, await lookupExercise(token, def.name), challenge));
    }
    cycleDays.push({
      day_number: index + 1,
      is_rest_day: false,
      routine_name: day.name,
      routine_description: day.description || '',
      exercises,
    });
  }

  return {
    name: challenge.name,
    description: challenge.description,
    visibility: 'public',
    duration_days: challenge.durationDays,
    cycle_length_days: challenge.days.length,
    categories: challenge.categories,
    locations: challenge.locations,
    cycle_days: cycleDays,
  };
}

/** Same three steps as the app: sign, PUT the exact bytes, keep the public URL. */
async function uploadCover(token, cover) {
  const signed = await api('POST', '/uploads/sign', { token, body: { fileType: cover.type, fileSize: cover.size } });
  const { signedUrl, publicUrl } = signed.data || signed;
  const put = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': cover.type, 'If-None-Match': '*' },
    body: fs.readFileSync(cover.file),
  });
  if (!put.ok) {
    const body = await put.text();
    const code = /<Code>([A-Za-z]+)<\/Code>/.exec(body)?.[1];
    throw new SeedError(`cover upload failed: ${put.status}${code ? ` (${code})` : ''}`);
  }
  return publicUrl;
}

async function main() {
  if (!EMAIL || !PASSWORD) throw new SeedError('set HAVIT_EMAIL and HAVIT_PASSWORD (the @havit account)');

  console.log(`API: ${API_URL}${DRY_RUN ? '  (dry run: nothing is created)' : ''}`);
  const login = await api('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  const token = login.accessToken;
  const username = login.user?.username;
  if (!token) throw new SeedError('login returned no accessToken');
  if (String(username).toLowerCase() !== 'havit') {
    throw new SeedError(`logged in as @${username}; the default challenges must belong to @havit`);
  }

  const mine = await api('GET', '/users/me/challenges', { token });
  const existing = new Set(
    [...(mine.active || []), ...(mine.completed || []), ...(mine.left || [])].map((c) => String(c.name).toLowerCase()),
  );

  let created = 0;
  for (const challenge of DEFAULT_CHALLENGES) {
    const label = `${challenge.name} (${challenge.activity}, ${challenge.durationDays} days)`;
    if (existing.has(challenge.name.toLowerCase())) {
      console.log(`= ${label}: already exists, skipped`);
      continue;
    }
    const cover = findCover(challenge.cover);
    const payload = await buildPayload(token, challenge);
    const exerciseCount = payload.cycle_days.reduce((n, d) => n + d.exercises.length, 0);

    if (DRY_RUN) {
      console.log(`✓ ${label}: ${payload.cycle_days.length}-day cycle, ${exerciseCount} exercises, cover ${path.basename(cover.file)}`);
      continue;
    }

    payload.imageUrl = await uploadCover(token, cover);
    await api('POST', '/challenges', { token, body: payload });
    created += 1;
    console.log(`+ ${label}: created (cover in review)`);
  }

  console.log(DRY_RUN ? '\nDry run OK: every exercise and cover was found.' : `\nDone: ${created} created.`);
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof SeedError ? error.message : error.stack || error}`);
  process.exit(1);
});
