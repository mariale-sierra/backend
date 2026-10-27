-- 2026-10-27-01-notification-type-challenge-reopened.sql
--
-- B11 (sprint 10): reabrir un reto ahora avisa a sus participantes, igual que
-- cerrarlo (challenge_closed). Mismo contrato que el catálogo de
-- 2026-10-05-01-notification-types.sql: `code` = NotificationTypeCode del
-- backend y clave i18n de la app. Sin fila en notification_preferences queda
-- activado para todos. ON CONFLICT lo hace seguro de re-ejecutar.

INSERT INTO havit.notification_types (code, name, description, category, user_configurable, is_active) VALUES
  ('challenge_reopened', 'Challenge reabierto', 'Reabrieron un challenge en el que participas', 'challenges', true, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  user_configurable = EXCLUDED.user_configurable;
