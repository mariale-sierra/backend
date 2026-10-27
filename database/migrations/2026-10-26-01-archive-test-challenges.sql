-- 2026-10-26-01-archive-test-challenges.sql
-- Limpieza para la entrega final (Sprint 10): archiva los retos de prueba que se
-- crearon durante el desarrollo (sin categoría, nombres y contenido de prueba) y
-- oculta las fotos de progreso publicadas en ellos. Los retos por defecto los crea
-- después la cuenta oficial @havit con scripts/seed-default-challenges.js.
--
-- Todo es borrado suave, el mismo mecanismo del borrado propio (B4):
-- * challenges.is_active = false: el reto deja de existir para toda lectura
--   (Explorar, Mis retos, detalle), pero challenge_user_map, solicitudes e
--   historial de entrenamientos se conservan.
-- * workout_posts.is_active = false: la foto deja de salir en el feed, el mosaico
--   y los perfiles.
--
-- Se puede revertir con UPDATE ... SET is_active = true sobre las mismas filas.
-- Seguro de volver a correr: nunca toca los retos de @havit (los retos por
-- defecto), y lo que ya está archivado no cambia.

UPDATE havit.challenges c
SET is_active = false
WHERE c.is_active = true
  AND c.created_by_user_id IS DISTINCT FROM (
    SELECT u.id FROM havit.users u WHERE LOWER(u.username) = 'havit' LIMIT 1
  );

UPDATE havit.workout_posts p
SET is_active = false
FROM havit.workout_logs wl
JOIN havit.challenges c ON c.id = wl.challenge_id
WHERE p.workout_log_id = wl.id
  AND p.is_active = true
  AND c.is_active = false;
