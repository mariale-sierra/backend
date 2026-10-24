-- 2026-10-23-01-refresh-tokens.sql
-- B4: sesiones con access token corto (15 min) + refresh token opaco y rotativo.
--
-- Dos tablas:
--
-- * refresh_token_families: UNA fila por sesión (un login en un dispositivo).
--   Es la única fuente de verdad del estado de la sesión: su id es el `sid`
--   que viaja en el access token, expires_at es el vencimiento deslizante (el
--   del token vigente) y revoked_at/revoke_reason dicen si se cerró.
--   JwtAuthGuard y la rotación consultan esta fila.
--
-- * refresh_tokens: cada refresh token emitido de una familia. Nunca se
--   guarda el token: solo su SHA-256 en hex (token_hash). El token tiene 256
--   bits aleatorios, así que un hash rápido sin sal basta. Al rotar, el viejo
--   queda con replaced_by = id del nuevo; presentar uno ya rotado (reuso)
--   revoca la familia. revoked_at/revoke_reason de cada token replican, para
--   auditoría, la revocación de su familia (se escriben en la misma
--   transacción).
--
-- Concurrencia (corrección post-auditoría B4-02-F01): rotar y revocar se
-- serializan sobre la fila de la familia. La rotación la toma con
-- SELECT ... FOR UPDATE ANTES de bloquear el token, y la revocación es un
-- UPDATE de esa misma fila, así que nunca se solapan: una revocación
-- confirmada alcanza también al token que una rotación concurrente acababa de
-- crear. Todo camino bloquea primero la familia y después sus tokens (sin
-- deadlocks por orden inverso).
--
-- Borrado: ON DELETE CASCADE desde users y desde la familia. Las familias
-- vencidas y los tokens vencidos los borra un @Cron diario
-- (RefreshTokensService.deleteExpired).
--
-- Esta migración se corrigió en su sitio antes de aplicarse en cualquier base
-- compartida (solo se había aplicado en bases locales desechables de B4).

CREATE TABLE IF NOT EXISTS havit.refresh_token_families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES havit.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  CONSTRAINT refresh_token_families_revoke_reason_check
    CHECK (revoke_reason IS NULL OR revoke_reason IN ('logout', 'reuse', 'account')),
  CONSTRAINT refresh_token_families_revoked_consistency_check
    CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);

-- Borrado en cascada desde users.
CREATE INDEX IF NOT EXISTS idx_refresh_token_families_user
  ON havit.refresh_token_families (user_id);

-- La limpieza diaria de familias vencidas.
CREATE INDEX IF NOT EXISTS idx_refresh_token_families_expires_at
  ON havit.refresh_token_families (expires_at);

CREATE TABLE IF NOT EXISTS havit.refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES havit.users(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES havit.refresh_token_families(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  replaced_by UUID REFERENCES havit.refresh_tokens(id) ON DELETE SET NULL,
  CONSTRAINT refresh_tokens_revoke_reason_check
    CHECK (revoke_reason IS NULL OR revoke_reason IN ('logout', 'reuse', 'account'))
);

-- Búsqueda del token presentado.
CREATE UNIQUE INDEX IF NOT EXISTS uq_refresh_tokens_token_hash
  ON havit.refresh_tokens (token_hash);

-- Revocar todos los tokens de una familia y el borrado en cascada desde ella.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family
  ON havit.refresh_tokens (family_id);

-- ON DELETE SET NULL de replaced_by: sin índice, cada token borrado por la
-- limpieza recorrería la tabla entera buscando quién lo referencia.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_replaced_by
  ON havit.refresh_tokens (replaced_by);

-- Borrado en cascada desde users.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user
  ON havit.refresh_tokens (user_id);

-- La limpieza diaria de tokens vencidos.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at
  ON havit.refresh_tokens (expires_at);
