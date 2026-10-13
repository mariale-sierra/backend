-- B11 (Sprint 9) — datos SINTÉTICOS para el ensayo de restore.
-- Solo para una base desechable creada con `npm run db:migrate` sobre un
-- Postgres local/aislado. Nunca contra Azure ni una base compartida.
-- Determinista (ids derivados de md5), sin datos reales. Ver
-- B11-CONFIABILIDAD-BACKUPS-INTEGRACIONES.md, sección 3.
SET search_path TO havit;
BEGIN;
INSERT INTO users (id, username, email, password_hash)
SELECT md5('u'||g)::uuid, 'drill_user_'||g, 'drill_user_'||g||'@example.invalid', 'not-a-real-hash'
FROM generate_series(1,200) g;
INSERT INTO user_profiles (user_id, display_name, preferred_language)
SELECT md5('u'||g)::uuid, 'Drill User '||g, 'es' FROM generate_series(1,200) g;
INSERT INTO challenges (id, created_by_user_id, name, visibility, duration_days, cycle_length_days)
SELECT md5('c'||g)::uuid, md5('u'||g)::uuid, 'Drill challenge '||g,
       (CASE WHEN g % 4 = 0 THEN 'private' ELSE 'public' END)::challenge_visibility_enum, 30, 7
FROM generate_series(1,20) g;
INSERT INTO challenge_user_map (challenge_id, user_id, role, status)
SELECT md5('c'||g)::uuid, md5('u'||g)::uuid, 'owner', 'active' FROM generate_series(1,20) g;
INSERT INTO challenge_user_map (challenge_id, user_id, role, status)
SELECT md5('c'||((u % 20)+1))::uuid, md5('u'||u)::uuid, 'participant', 'active'
FROM generate_series(21,200) u;
INSERT INTO routines (name) SELECT 'Drill routine '||g FROM generate_series(1,30) g;
INSERT INTO workout_logs (user_id, challenge_id, started_at, ended_at, status, local_day)
SELECT md5('u'||u)::uuid, md5('c'||((u % 20)+1))::uuid,
       timestamp '2026-09-01 08:00' + (d||' days')::interval,
       timestamp '2026-09-01 08:45' + (d||' days')::interval,
       'completed', date '2026-09-01' + d
FROM generate_series(21,200) u, generate_series(0,9) d;
INSERT INTO workout_posts (workout_log_id, user_id, image_url, caption, visibility)
SELECT wl.id, wl.user_id, 'https://drill.invalid/'||wl.id||'.jpg', 'drill post '||wl.id,
       (CASE WHEN wl.id % 3 = 0 THEN 'public' WHEN wl.id % 3 = 1 THEN 'followers' ELSE 'private' END)::post_visibility_enum
FROM workout_logs wl WHERE wl.id % 4 <> 0;
INSERT INTO workout_post_comments (workout_post_id, user_id, comment_text)
SELECT p.id, md5('u'||((row_number() over (order by p.id)) % 200 + 1))::uuid, 'drill comment'
FROM workout_posts p ORDER BY p.id LIMIT 1000;
INSERT INTO workout_post_likes (workout_post_id, user_id)
SELECT p.id, md5('u'||((row_number() over (order by p.id)) % 200 + 1))::uuid
FROM workout_posts p ORDER BY p.id LIMIT 1000;
INSERT INTO user_follows (follower_user_id, followed_user_id)
SELECT md5('u'||g)::uuid, md5('u'||((g % 200)+1))::uuid FROM generate_series(1,200) g;
INSERT INTO direct_conversations (id) SELECT md5('dc'||g)::uuid FROM generate_series(1,50) g;
INSERT INTO direct_conversation_members (direct_conversation_id, user_id)
SELECT md5('dc'||g)::uuid, md5('u'||g)::uuid FROM generate_series(1,50) g
UNION ALL
SELECT md5('dc'||g)::uuid, md5('u'||(g+100))::uuid FROM generate_series(1,50) g;
INSERT INTO direct_messages (direct_conversation_id, user_id, message_text)
SELECT md5('dc'||g)::uuid, md5('u'||(CASE WHEN m % 2 = 0 THEN g ELSE g+100 END))::uuid, 'drill message '||m
FROM generate_series(1,50) g, generate_series(1,10) m;
-- Filas en soft delete (B4): el ensayo también comprueba que ese estado sobrevive al restore.
UPDATE workout_posts SET is_active = false WHERE workout_log_id % 50 = 1;
UPDATE challenges SET is_active = false WHERE name = 'Drill challenge 20';
INSERT INTO direct_conversation_hidden_by (direct_conversation_id, user_id)
SELECT md5('dc'||g)::uuid, md5('u'||g)::uuid FROM generate_series(1,5) g;
COMMIT;
