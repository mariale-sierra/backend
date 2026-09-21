-- 2026-09-22-01-free-repdb-slugs-held-by-legacy-exercises.sql
--
-- Real, confirmed bug (2026-09-22, found while auditing every exercise): 12 of the 601 RepDB exercises
-- are missing from the live catalog (589 active, not 601) — and they are the most basic ones: Squat,
-- Bench Press, Deadlift, Barbell Row, Bicep Curl, Hip Thrust, Lat Pulldown, Leg Press, Tricep Pushdown,
-- Kettlebell Swing, Battle Ropes and Running.
--
-- Cause: the 27 hand-seeded exercises this catalog started with (deactivated by
-- 2026-09-03-11-deactivate-legacy-manual-exercises.sql, never deleted) already own those 12 slugs, and
-- exercises.slug is UNIQUE. The RepDB importer inserts new exercises with slug = the RepDB id, so for
-- these 12 the INSERT hit exercises_slug_key, was caught per-exercise, counted as "skipped", and the
-- exercise was silently never imported.
--
-- Fix: give the inactive legacy rows a "-legacy" slug so the RepDB versions can take the real one.
-- Nothing else about a legacy row changes: it keeps its id, so every routine / workout log that
-- references it is untouched (those FKs are ON DELETE RESTRICT and point at the id, not the slug).
--
-- After this is deployed, run the importer ONCE to bring the 12 in (it is idempotent, and now also
-- writes each exercise's reviewed metrics):
--   cd backend && npm run db:import:repdb
--
-- Scope / safety: only inactive source='manual' rows, only these 12 slugs, and only when the
-- "-legacy" slug is free. Re-running is a no-op.

UPDATE havit.exercises AS e
SET slug = e.slug || '-legacy'
WHERE e.source = 'manual'
  AND e.is_active = false
  AND e.slug IN (
    'barbell-row',
    'battle-ropes',
    'bench-press',
    'bicep-curl',
    'deadlift',
    'hip-thrust',
    'kettlebell-swing',
    'lat-pulldown',
    'leg-press',
    'running',
    'squat',
    'tricep-pushdown'
  )
  AND NOT EXISTS (
    SELECT 1 FROM havit.exercises AS taken WHERE taken.slug = e.slug || '-legacy'
  );
