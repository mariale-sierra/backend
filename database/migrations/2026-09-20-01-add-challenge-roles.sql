-- 2026-09-20-01-add-challenge-roles.sql
-- Bloque 1 (Challenges, admin/owner/participante):
--
-- 1. Admin global de plataforma no existía en ningún lado — se agrega como
--    un boolean simple en users, mismo estilo que el ya existente is_active
--    (que ya es el patrón real de "soft-deactivate" del proyecto: banear un
--    usuario reusa is_active = false, nunca un DELETE).
-- 2. challenges no tenía columna de estado — se necesita para que un admin
--    pueda "cerrar" un challenge. Mismo estilo de string libre que ya usa
--    challenge_user_map.status ('active'/'left'/'completed'), no un enum de
--    Postgres.
-- 3. challenge_join_requests: hoy POST /challenges/:id/join une inmediato
--    sin importar visibility. Para que el owner de un challenge PRIVADO
--    tenga derecho de admisión (aceptar/negar) hace falta una solicitud
--    pendiente de aprobación — mismo shape/reasoning que
--    havit.space_join_requests (2026-09-02-01-spaces-join-requests-and-
--    activity-category.sql), que ya resuelve el mismo problema para spaces.
-- 4. workout_post_tagged_users: para que el owner pueda crear un post
--    conjunto taggeando participantes. Sin confirmación (decisión de
--    producto) — mismo shape que workout_post_likes (composite PK, sin
--    columna de estado), no el de challenge_join_requests.

ALTER TABLE havit.users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE havit.challenges
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'open';

DO $$
BEGIN
  CREATE TYPE havit.challenge_join_request_status_enum AS ENUM (
    'pending',
    'approved',
    'rejected',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS havit.challenge_join_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  challenge_id UUID NOT NULL,
  user_id UUID NOT NULL,
  status havit.challenge_join_request_status_enum NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP,
  responded_by_user_id UUID,
  CONSTRAINT fk_challenge_join_requests_challenge
    FOREIGN KEY (challenge_id) REFERENCES havit.challenges (id) ON DELETE CASCADE,
  CONSTRAINT fk_challenge_join_requests_user
    FOREIGN KEY (user_id) REFERENCES havit.users (id) ON DELETE CASCADE,
  CONSTRAINT fk_challenge_join_requests_responded_by
    FOREIGN KEY (responded_by_user_id) REFERENCES havit.users (id) ON DELETE SET NULL
);
COMMENT ON TABLE havit.challenge_join_requests IS 'Solicitudes de ingreso a challenges privados, pendientes de aprobacion del owner.';

-- Misma razón que uq_space_join_request_pending: evita que una carrera entre
-- dos "solicitar unión" del mismo usuario cree dos filas pendientes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_challenge_join_request_pending
  ON havit.challenge_join_requests (challenge_id, user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_challenge_join_requests_challenge_id
  ON havit.challenge_join_requests (challenge_id);

CREATE TABLE IF NOT EXISTS havit.workout_post_tagged_users (
  workout_post_id UUID NOT NULL,
  user_id UUID NOT NULL,
  tagged_by_user_id UUID NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workout_post_id, user_id),
  CONSTRAINT fk_workout_post_tagged_users_post
    FOREIGN KEY (workout_post_id) REFERENCES havit.workout_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_workout_post_tagged_users_user
    FOREIGN KEY (user_id) REFERENCES havit.users (id) ON DELETE CASCADE,
  CONSTRAINT fk_workout_post_tagged_users_tagged_by
    FOREIGN KEY (tagged_by_user_id) REFERENCES havit.users (id) ON DELETE CASCADE
);
COMMENT ON TABLE havit.workout_post_tagged_users IS 'Usuarios taggeados por el owner del challenge en un post conjunto. Sin confirmacion del taggeado (decision de producto).';
