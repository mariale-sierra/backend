-- 2026-10-13-02-disable-seeded-testuser.sql
-- Auditoría OWASP (H2): el seed 2026-07-21-01-test-user.sql creó en TODOS los entornos
-- (incluida producción) la cuenta testuser@havit.dev con una contraseña escrita en el repo.
-- Esta migración la deja inutilizable SIN borrarla: se desactiva (is_active = false: el login
-- y el JWT guard la rechazan) y se invalida su hash, pero solo si todavía tiene la contraseña
-- publicada (si alguien ya la cambió, no se toca). Es idempotente y reversible a mano.
-- El seed ahora vive en database/demo/ (npm run db:demo, solo para desarrollo).

UPDATE havit.users
SET is_active = FALSE,
    password_hash = '!disabled-by-security-audit'
WHERE email = 'testuser@havit.dev'
  AND password_hash = '$2b$10$Ht61e9ROpWJEXo7UXTje7.jXuJGo5d1L3R1JNXLUk01rcMnWSdqcG';
