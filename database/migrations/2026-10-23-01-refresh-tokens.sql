-- 2026-10-23-01-refresh-tokens.sql
-- B4: sesiones con access token corto (15 min) + refresh token opaco y rotativo.
--
-- * Cada fila es UN refresh token emitido. Nunca se guarda el token: solo su
--   SHA-256 en hex (token_hash). El token tiene 256 bits aleatorios, así que un
--   hash rápido sin sal basta (no es una contraseña que se pueda adivinar).
-- * family_id agrupa la cadena de rotaciones de un mismo login (= una sesión de
--   un dispositivo). Es el `sid` que viaja en el access token.
-- * Rotación: al usar un token se emite otro en la misma familia y el viejo
--   queda con replaced_by = id del nuevo. La "cabeza" de la familia es la única
--   fila con replaced_by IS NULL.
-- * Revocación: logout o reuso de un token ya rotado ponen revoked_at (y el
--   motivo) en TODAS las filas de la familia. Una sesión está viva si su cabeza
--   no está revocada ni vencida (lo consulta JwtAuthGuard).
-- * ON DELETE CASCADE: si alguna vez se borra el usuario, sus sesiones también.
-- * Las filas vencidas las borra un @Cron diario (RefreshTokensService).

CREATE TABLE IF NOT EXISTS havit.refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES havit.users(id) ON DELETE CASCADE,
  family_id UUID NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  replaced_by UUID REFERENCES havit.refresh_tokens(id) ON DELETE SET NULL,
  CONSTRAINT refresh_tokens_revoke_reason_check
    CHECK (revoke_reason IS NULL OR revoke_reason IN ('logout', 'reuse', 'account'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_refresh_tokens_token_hash
  ON havit.refresh_tokens (token_hash);

-- La comprobación del guard ("¿la cabeza de esta familia sigue viva?").
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_head
  ON havit.refresh_tokens (family_id)
  WHERE replaced_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user
  ON havit.refresh_tokens (user_id);

-- La limpieza diaria de vencidos.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at
  ON havit.refresh_tokens (expires_at);
