-- 2026-10-13-01-user-suspension.sql
-- Suspensión temporal de actividad como penalización de moderación.
--
-- * users.suspended_until: mientras sea > now() el usuario puede leer, pero no
--   publicar, comentar, escribir ni reportar (SuspensionGuard). NULL = sin suspensión.
-- * user_penalties.suspension_hours: cuántas horas de suspensión llevó la falta
--   (fijo por motivo del reporte, ver REPORT_REASON_SUSPENSION_HOURS), para auditoría.
-- * índice parcial para que "lo que yo reporté" (ocultarlo al reportante mientras
--   se revisa) no escanee content_reports completa en cada lectura.

ALTER TABLE havit.users
  ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ;

ALTER TABLE havit.user_penalties
  ADD COLUMN IF NOT EXISTS suspension_hours INT;

CREATE INDEX IF NOT EXISTS idx_content_reports_reporter_target_active
  ON havit.content_reports (reporter_id, target_type, target_id)
  WHERE status <> 'dismissed';
