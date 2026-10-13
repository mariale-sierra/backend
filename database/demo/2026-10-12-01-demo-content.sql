-- 2026-10-12-01-demo-content.sql
-- Demo content so Feed / Search / Profile / badges don't look empty (Sprint 9, B12).
--
-- NOT part of init/migrations/seeds: it is never run on boot or deploy. Run it
-- by hand against a dev database only:   npm run db:demo
-- Idempotent - safe to re-run (users/challenges are keyed by username / fixed id,
-- logs by the 'demo-seed' marker in workout_logs.notes).
--
-- Accounts: demo_ana, demo_luis, demo_sofia, demo_marco, demo_valeria
-- Password for all of them: TestHavit123!  (same bcrypt hash as the testuser seed)
-- Images are picsum.photos placeholders.

SET search_path = havit, public;

-- users + profiles
INSERT INTO users (username, email, password_hash, is_active, terms_accepted_at, terms_version, age_confirmed_at)
SELECT v.username, v.username || '@havit.dev',
       '$2b$10$Ht61e9ROpWJEXo7UXTje7.jXuJGo5d1L3R1JNXLUk01rcMnWSdqcG',
       TRUE, now(), 'demo', now()
FROM (VALUES ('demo_ana'), ('demo_luis'), ('demo_sofia'), ('demo_marco'), ('demo_valeria')) AS v(username)
ON CONFLICT (username) DO NOTHING;

INSERT INTO user_profiles (user_id, display_name, bio, preferred_language, is_private, profile_image_url)
SELECT u.id, v.display_name, v.bio, 'es', FALSE,
       'https://picsum.photos/seed/havit-avatar-' || v.username || '/300/300'
FROM (VALUES
  ('demo_ana',     'Ana Torres',    'Corro por las mañanas y entreno fuerza por las tardes.'),
  ('demo_luis',    'Luis Herrera',  'Calistenia, bici y mucho café.'),
  ('demo_sofia',   'Sofía Ramírez', 'Yoga y movilidad todos los días.'),
  ('demo_marco',   'Marco Vidal',   'Volviendo al gimnasio paso a paso.'),
  ('demo_valeria', 'Valeria Núñez', 'Natación y trail running.')
) AS v(username, display_name, bio)
JOIN users u ON u.username = v.username
ON CONFLICT (user_id) DO NOTHING;

-- follows (everyone follows ana; a few cross-follows)
INSERT INTO user_follows (follower_user_id, followed_user_id)
SELECT f.id, t.id
FROM (VALUES
  ('demo_luis','demo_ana'), ('demo_sofia','demo_ana'), ('demo_marco','demo_ana'), ('demo_valeria','demo_ana'),
  ('demo_ana','demo_luis'), ('demo_ana','demo_sofia'), ('demo_luis','demo_sofia'),
  ('demo_valeria','demo_luis'), ('demo_marco','demo_sofia'), ('demo_sofia','demo_valeria')
) AS p(follower, followed)
JOIN users f ON f.username = p.follower
JOIN users t ON t.username = p.followed
ON CONFLICT DO NOTHING;

-- challenges
INSERT INTO challenges (id, created_by_user_id, name, description, visibility, duration_days, cycle_length_days)
SELECT v.id::uuid, u.id, v.name, v.description, 'public', v.duration_days, 7
FROM (VALUES
  ('de000000-0000-4000-8000-000000000001', 'demo_ana',   'Reto 30 días de running', 'Sal a correr, aunque sea 20 minutos. Comparte tu progreso con #running.', 30),
  ('de000000-0000-4000-8000-000000000002', 'demo_sofia', 'Movilidad diaria',        '15 minutos de movilidad y yoga cada día. #yoga #movilidad',               21),
  ('de000000-0000-4000-8000-000000000003', 'demo_luis',  'Calistenia desde cero',   'Dominadas, fondos y flexiones con progresión semanal. #calistenia',       28),
  ('de000000-0000-4000-8000-000000000004', 'demo_marco', 'Vuelta al gimnasio',      'Tres sesiones por semana durante un mes. #fuerza',                        28)
) AS v(id, owner, name, description, duration_days)
JOIN users u ON u.username = v.owner
ON CONFLICT (id) DO NOTHING;

INSERT INTO challenge_user_map (challenge_id, user_id, role, status)
SELECT c.id, u.id, m.role::challenge_user_role_enum, m.status::challenge_user_status_enum
FROM (VALUES
  ('de000000-0000-4000-8000-000000000001', 'demo_ana',     'owner',       'completed'),
  ('de000000-0000-4000-8000-000000000001', 'demo_valeria', 'participant', 'active'),
  ('de000000-0000-4000-8000-000000000001', 'demo_luis',    'participant', 'active'),
  ('de000000-0000-4000-8000-000000000002', 'demo_sofia',   'owner',       'active'),
  ('de000000-0000-4000-8000-000000000002', 'demo_ana',     'participant', 'completed'),
  ('de000000-0000-4000-8000-000000000002', 'demo_marco',   'participant', 'active'),
  ('de000000-0000-4000-8000-000000000003', 'demo_luis',    'owner',       'active'),
  ('de000000-0000-4000-8000-000000000003', 'demo_marco',   'participant', 'active'),
  ('de000000-0000-4000-8000-000000000004', 'demo_marco',   'owner',       'active')
) AS m(challenge_id, username, role, status)
JOIN challenges c ON c.id = m.challenge_id::uuid
JOIN users u ON u.username = m.username
ON CONFLICT (challenge_id, user_id) DO NOTHING;

-- completed workouts + posts
-- ana: 12 consecutive days ending today (first/five/ten workouts + 7-day streak,
-- 2 completed challenges); luis: 6 days, sofia: 3, valeria: 1, marco: none
-- (so every badge state - earned, in progress, locked - is visible).
DO $$
DECLARE
  rec RECORD;
  log_id BIGINT;
  captions TEXT[] := ARRAY[
    'Primera salida de la semana #running', 'Día de piernas #fuerza', 'Movilidad para cerrar el día #movilidad',
    'Dos más y llego a la meta #running #reto', 'Calentando hombros #calistenia', 'Yoga al amanecer #yoga',
    'Otro día, otro kilómetro #running', 'Constancia ante todo #constancia', 'Sin excusas #fuerza',
    'Descanso activo y estiramientos #movilidad', 'Casi ahí #running', 'Último día de la racha #constancia'
  ];
BEGIN
  FOR rec IN
    SELECT u.id AS user_id, u.username, g.n
    FROM (VALUES ('demo_ana', 12), ('demo_luis', 6), ('demo_sofia', 3), ('demo_valeria', 1)) AS t(username, cnt)
    JOIN users u ON u.username = t.username
    CROSS JOIN LATERAL generate_series(0, t.cnt - 1) AS g(n)
  LOOP
    IF EXISTS (
      SELECT 1 FROM workout_logs
      WHERE user_id = rec.user_id AND notes = 'demo-seed'
        AND started_at::date = (current_date - rec.n)
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO workout_logs (user_id, challenge_id, started_at, ended_at, status, notes, local_day)
    VALUES (
      rec.user_id,
      CASE rec.username
        WHEN 'demo_luis' THEN 'de000000-0000-4000-8000-000000000003'::uuid
        WHEN 'demo_sofia' THEN 'de000000-0000-4000-8000-000000000002'::uuid
        ELSE 'de000000-0000-4000-8000-000000000001'::uuid
      END,
      (current_date - rec.n) + time '08:00', (current_date - rec.n) + time '08:45',
      'completed', 'demo-seed', current_date - rec.n
    )
    RETURNING id INTO log_id;

    INSERT INTO workout_posts (workout_log_id, user_id, image_url, caption, visibility, moderation_status)
    VALUES (
      log_id, rec.user_id,
      'https://picsum.photos/seed/havit-' || rec.username || '-' || rec.n || '/800/1000',
      captions[1 + ((rec.n + length(rec.username)) % array_length(captions, 1))],
      'followers', 'approved'
    );
  END LOOP;
END $$;

-- hashtags for the demo posts (same rule as the backend parser)
INSERT INTO hashtags (tag)
SELECT DISTINCT lower(r.m[2])
FROM workout_posts p
JOIN workout_logs l ON l.id = p.workout_log_id AND l.notes = 'demo-seed'
CROSS JOIN LATERAL regexp_matches(p.caption, '(^|[^[:alnum:]_&#])#([[:alnum:]_]+)', 'g') AS r(m)
ON CONFLICT (tag) DO NOTHING;

INSERT INTO workout_post_hashtags (workout_post_id, hashtag_id)
SELECT DISTINCT p.id, h.id
FROM workout_posts p
JOIN workout_logs l ON l.id = p.workout_log_id AND l.notes = 'demo-seed'
CROSS JOIN LATERAL regexp_matches(p.caption, '(^|[^[:alnum:]_&#])#([[:alnum:]_]+)', 'g') AS r(m)
JOIN hashtags h ON h.tag = lower(r.m[2])
ON CONFLICT DO NOTHING;

-- a few likes so the "who reacted" row has faces
INSERT INTO workout_post_likes (workout_post_id, user_id)
SELECT p.id, u.id
FROM workout_posts p
JOIN workout_logs l ON l.id = p.workout_log_id AND l.notes = 'demo-seed'
JOIN users u ON u.username IN ('demo_luis', 'demo_sofia', 'demo_marco', 'demo_valeria')
            AND u.id <> p.user_id
WHERE abs(hashtext(p.id::text)::bigint + hashtext(u.username)) % 3 = 0
ON CONFLICT DO NOTHING;
