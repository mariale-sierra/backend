-- B6 performance work — synthetic fixture data for LOCAL benchmarking only.
--
-- This is NOT an official database/seeds/*.sql file (it is not run by
-- npm run db:migrate and is not tracked in havit.schema_migrations). It exists
-- purely so GET /challenges, /workout-logs, /workout-posts/* have a realistic
-- number of rows to benchmark against on a disposable local Postgres instance.
--
-- NEVER run this against the shared Azure database. It is meant to run only
-- against a local database created for B6 benchmarking (see
-- performance/README.md), and performance/scripts/run-benchmark.js refuses to
-- run at all unless DB_HOST resolves to localhost/127.0.0.1 as a safety net —
-- apply this same care if you ever run this file by hand with psql.
--
-- Idempotent-ish: safe to re-run (uses a fixed random seed and ON CONFLICT
-- DO NOTHING / guards), but intended to run once against a freshly migrated
-- local database.

BEGIN;

SELECT setseed(0.42);

-- 500 synthetic users + profiles
INSERT INTO havit.users (username, email, password_hash, is_active)
SELECT
  'bench_user_' || g,
  'bench_user_' || g || '@havit.bench',
  '$2b$10$Ht61e9ROpWJEXo7UXTje7.jXuJGo5d1L3R1JNXLUk01rcMnWSdqcG', -- same hash as the testuser seed
  TRUE
FROM generate_series(1, 500) AS g
ON CONFLICT (username) DO NOTHING;

INSERT INTO havit.user_profiles (user_id, display_name, preferred_language, is_private)
SELECT u.id, 'Bench User ' || substring(u.username from 12), 'en', FALSE
FROM havit.users u
WHERE u.username LIKE 'bench_user_%'
ON CONFLICT (user_id) DO NOTHING;

-- 300 synthetic challenges, owned by random bench users
WITH bench_users AS (
  SELECT id, row_number() OVER (ORDER BY id) AS rn
  FROM havit.users WHERE username LIKE 'bench_user_%'
),
user_count AS (SELECT count(*) AS n FROM bench_users)
INSERT INTO havit.challenges (created_by_user_id, name, description, visibility, duration_days, cycle_length_days, status)
SELECT
  (SELECT id FROM bench_users WHERE rn = ((g % (SELECT n FROM user_count)) + 1)),
  'Bench Challenge ' || g,
  'Synthetic challenge generated for B6 local load testing.',
  (ARRAY['public','public','public','private']::havit.challenge_visibility_enum[])[1 + floor(random() * 4)::int],
  (ARRAY[7, 14, 21, 30])[1 + floor(random() * 4)::int],
  (ARRAY[3, 4, 7])[1 + floor(random() * 3)::int],
  (ARRAY['open','open','open','closed']::havit.challenge_status_enum[])[1 + floor(random() * 4)::int]
FROM generate_series(1, 300) AS g;

-- Membership: each bench challenge gets 5-40 random active members
WITH bench_challenges AS (
  SELECT c.id AS challenge_id
  FROM havit.challenges c
  JOIN havit.users u ON u.id = c.created_by_user_id
  WHERE u.username LIKE 'bench_user_%'
),
bench_users AS (
  SELECT id FROM havit.users WHERE username LIKE 'bench_user_%'
)
INSERT INTO havit.challenge_user_map (challenge_id, user_id, role, status)
SELECT bc.challenge_id, bu.id, 'participant'::havit.challenge_user_role_enum, 'active'::havit.challenge_user_status_enum
FROM bench_challenges bc
CROSS JOIN LATERAL (
  SELECT id FROM bench_users ORDER BY random() LIMIT (5 + floor(random() * 36)::int)
) bu
ON CONFLICT (challenge_id, user_id) DO NOTHING;

-- ~20k workout logs spread across bench users/challenges over the last 90 days
WITH bench_challenges AS (
  SELECT c.id AS challenge_id
  FROM havit.challenges c
  JOIN havit.users u ON u.id = c.created_by_user_id
  WHERE u.username LIKE 'bench_user_%'
),
members AS (
  SELECT cum.challenge_id, cum.user_id
  FROM havit.challenge_user_map cum
  JOIN bench_challenges bc ON bc.challenge_id = cum.challenge_id
)
INSERT INTO havit.workout_logs (user_id, challenge_id, started_at, ended_at, status)
SELECT
  m.user_id,
  m.challenge_id,
  ts,
  ts + (interval '1 minute' * (20 + floor(random() * 40)::int)),
  'completed'::havit.workout_log_status_enum
FROM members m
CROSS JOIN LATERAL (
  SELECT now() - (interval '1 day' * floor(random() * 90)::int)
              - (interval '1 minute' * floor(random() * 1440)::int) AS ts
  FROM generate_series(1, 3 + floor(random() * 5)::int)
) t(ts)
LIMIT 20000;

-- Workout posts for ~35% of the workout logs just created (1 post per log, per the unique FK)
WITH candidate_logs AS (
  SELECT wl.id AS workout_log_id, wl.user_id
  FROM havit.workout_logs wl
  JOIN havit.users u ON u.id = wl.user_id
  WHERE u.username LIKE 'bench_user_%'
  ORDER BY wl.id
)
INSERT INTO havit.workout_posts (workout_log_id, user_id, image_url, caption, visibility, is_active, moderation_status)
SELECT
  workout_log_id,
  user_id,
  'https://bench.havit.dev/fixtures/' || workout_log_id || '.jpg',
  'Bench fixture post',
  (ARRAY['public','public','followers']::havit.post_visibility_enum[])[1 + floor(random() * 3)::int],
  TRUE,
  'approved'::havit.workout_posts_moderation_status_enum
FROM candidate_logs
WHERE random() < 0.35
ON CONFLICT (workout_log_id) DO NOTHING;

COMMIT;

-- Summary
SELECT 'users' AS table_name, count(*) FROM havit.users WHERE username LIKE 'bench_user_%'
UNION ALL SELECT 'challenges', count(*) FROM havit.challenges c JOIN havit.users u ON u.id = c.created_by_user_id WHERE u.username LIKE 'bench_user_%'
UNION ALL SELECT 'challenge_user_map', count(*) FROM havit.challenge_user_map cum JOIN havit.challenges c ON c.id = cum.challenge_id JOIN havit.users u ON u.id = c.created_by_user_id WHERE u.username LIKE 'bench_user_%'
UNION ALL SELECT 'workout_logs', count(*) FROM havit.workout_logs wl JOIN havit.users u ON u.id = wl.user_id WHERE u.username LIKE 'bench_user_%'
UNION ALL SELECT 'workout_posts', count(*) FROM havit.workout_posts wp JOIN havit.users u ON u.id = wp.user_id WHERE u.username LIKE 'bench_user_%';
