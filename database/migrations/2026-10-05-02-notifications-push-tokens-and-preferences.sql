-- 2026-10-05-02-notifications-push-tokens-and-preferences.sql
--
-- B3 (notificaciones), esquema:
--  1. notifications.related_entity_id BIGINT -> VARCHAR(64): posts,
--     challenges, usuarios, espacios y conversaciones usan UUID; las
--     invitaciones y los reportes usan ids numéricos. La tabla estaba vacía
--     (ningún código escribía en ella); el USING solo cubre filas a mano.
--  2. notifications.data JSONB: ids extra que la app necesita para navegar
--     (p. ej. challengeId de una invitación). Nunca texto de usuario.
--  3. Índice parcial para deduplicar notificaciones no leídas del mismo
--     evento (doble tap, ráfagas de mensajes).
--  4. notification_types.category / user_configurable: agrupan los tipos en
--     las categorías que ve el usuario en Preferencias; los tipos con
--     user_configurable = false (acciones de moderación sobre tu contenido)
--     no se pueden apagar en la bandeja.
--  5. device_push_tokens: un token Expo por dispositivo, único globalmente
--     (si otro usuario inicia sesión en el mismo teléfono, el token se
--     reasigna).
--  6. notification_preferences: opt-out por usuario y tipo; sin fila =
--     todo habilitado.
-- Los tipos en sí se siembran en seeds/2026-10-05-01-notification-types.sql.
-- Idempotente: IF NOT EXISTS / guardas en todo.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'havit' AND table_name = 'notifications'
      AND column_name = 'related_entity_id' AND data_type = 'bigint'
  ) THEN
    ALTER TABLE havit.notifications
      ALTER COLUMN related_entity_id TYPE VARCHAR(64)
      USING related_entity_id::text;
  END IF;
END $$;

ALTER TABLE havit.notifications
  ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_notifications_unread_dedup
  ON havit.notifications (recipient_user_id, notification_type_id, related_entity_id)
  WHERE is_read = false AND is_active = true;

ALTER TABLE havit.notification_types
  ADD COLUMN IF NOT EXISTS category VARCHAR(30) NOT NULL DEFAULT 'social',
  ADD COLUMN IF NOT EXISTS user_configurable BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS havit.device_push_tokens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES havit.users(id) ON DELETE CASCADE,
  token VARCHAR(255) NOT NULL,
  platform VARCHAR(16) NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_device_push_tokens_token UNIQUE (token)
);
CREATE INDEX IF NOT EXISTS idx_device_push_tokens_user_active
  ON havit.device_push_tokens (user_id) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS havit.notification_preferences (
  user_id UUID NOT NULL REFERENCES havit.users(id) ON DELETE CASCADE,
  notification_type_id BIGINT NOT NULL REFERENCES havit.notification_types(id) ON DELETE CASCADE,
  in_app_enabled BOOLEAN NOT NULL DEFAULT true,
  push_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_type_id)
);
