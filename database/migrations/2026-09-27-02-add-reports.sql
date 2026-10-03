-- 2026-09-27-02-add-reports.sql
-- Sprint 8, Bloque 2 (Emily) — moderación manual: reportes, revisión por admin y
-- penalizaciones básicas. Aplica SOLO a workout_posts (foto/caption) y a sus
-- workout_post_comments. Chats y spaces quedan fuera a propósito.
--
-- 1) Estado "oculto por moderación" en posts y comentarios. Es independiente de
--    workout_posts.moderation_status (moderación automática por IA de la foto) y
--    de workout_post_comments.is_active (borrado propio del autor): un admin
--    oculta contenido sin pisar ninguno de esos dos flujos.
-- 2) havit.content_reports: un reporte de un usuario sobre un post o comentario,
--    con estado pending -> dismissed | actioned y campos de auditoría de la
--    resolución (quién, cuándo, qué acción, nota).
-- 3) havit.user_penalties: penalización básica ("strike") contra el autor del
--    contenido. Se eligió tabla y no un contador en users para conservar el
--    historial/auditoría (qué contenido, qué reporte, qué admin) y para que la
--    restricción UNIQUE (target_type, target_id) impida penalizar dos veces el
--    mismo contenido aunque se resuelvan varios reportes o se reintente la
--    petición.

ALTER TABLE havit.workout_posts
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS hidden_reason TEXT;

ALTER TABLE havit.workout_post_comments
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS hidden_reason TEXT;

CREATE TABLE IF NOT EXISTS havit.content_reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- 'post' -> workout_posts.id (UUID); 'comment' -> workout_post_comments.id
  -- (BIGINT). Se guarda como TEXT porque los dos ids tienen tipos distintos; el
  -- backend valida existencia y formato antes de insertar.
  target_type VARCHAR(16) NOT NULL,
  target_id TEXT NOT NULL,
  -- Autor del contenido al momento del reporte (a quién se penaliza).
  target_owner_id UUID NOT NULL,
  reporter_id UUID NOT NULL,
  reason VARCHAR(32) NOT NULL,
  details TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  resolution_action VARCHAR(16),
  resolution_note TEXT,
  resolved_by UUID,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_content_reports_target_type
    CHECK (target_type IN ('post', 'comment')),
  CONSTRAINT chk_content_reports_reason
    CHECK (reason IN ('spam', 'harassment', 'hate_speech', 'nudity', 'violence', 'self_harm', 'other')),
  CONSTRAINT chk_content_reports_status
    CHECK (status IN ('pending', 'dismissed', 'actioned')),
  CONSTRAINT chk_content_reports_resolution_action
    CHECK (resolution_action IS NULL OR resolution_action IN ('dismiss', 'hide')),
  CONSTRAINT fk_content_reports_reporter
    FOREIGN KEY (reporter_id) REFERENCES havit.users (id) ON DELETE CASCADE,
  CONSTRAINT fk_content_reports_target_owner
    FOREIGN KEY (target_owner_id) REFERENCES havit.users (id) ON DELETE CASCADE,
  CONSTRAINT fk_content_reports_resolved_by
    FOREIGN KEY (resolved_by) REFERENCES havit.users (id) ON DELETE SET NULL
);
COMMENT ON TABLE havit.content_reports IS 'Reportes de usuarios sobre workout posts y sus comentarios (Sprint 8, Bloque 2).';

-- Un mismo usuario no puede tener dos reportes pendientes del mismo contenido.
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_reports_pending_per_reporter
  ON havit.content_reports (reporter_id, target_type, target_id)
  WHERE status = 'pending';

-- Cola de revisión del admin (pendientes, más antiguos primero) y resolución en
-- cascada de todos los reportes pendientes de un mismo contenido.
CREATE INDEX IF NOT EXISTS idx_content_reports_status_id
  ON havit.content_reports (status, id);
CREATE INDEX IF NOT EXISTS idx_content_reports_target
  ON havit.content_reports (target_type, target_id);

CREATE TABLE IF NOT EXISTS havit.user_penalties (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL,
  report_id BIGINT NOT NULL,
  target_type VARCHAR(16) NOT NULL,
  target_id TEXT NOT NULL,
  penalty_type VARCHAR(16) NOT NULL DEFAULT 'strike',
  reason TEXT,
  issued_by UUID,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_user_penalties_type CHECK (penalty_type IN ('strike')),
  CONSTRAINT uq_user_penalties_target UNIQUE (target_type, target_id),
  CONSTRAINT fk_user_penalties_user
    FOREIGN KEY (user_id) REFERENCES havit.users (id) ON DELETE CASCADE,
  CONSTRAINT fk_user_penalties_report
    FOREIGN KEY (report_id) REFERENCES havit.content_reports (id) ON DELETE CASCADE,
  CONSTRAINT fk_user_penalties_issued_by
    FOREIGN KEY (issued_by) REFERENCES havit.users (id) ON DELETE SET NULL
);
COMMENT ON TABLE havit.user_penalties IS 'Penalizaciones básicas (strikes) al autor de contenido reportado y ocultado (Sprint 8, Bloque 2).';

CREATE INDEX IF NOT EXISTS idx_user_penalties_user_id
  ON havit.user_penalties (user_id);
