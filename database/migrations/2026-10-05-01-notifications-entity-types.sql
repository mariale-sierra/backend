-- 2026-10-05-01-notifications-entity-types.sql
--
-- B3 (notificaciones): amplía notification_related_entity_type_enum.
--
-- related_entity_type/related_entity_id apuntan SIEMPRE al recurso al que
-- navega la notificación (no al evento que la originó): un comentario o una
-- reacción apuntan al post, una solicitud de ingreso apunta al challenge o
-- espacio, un mensaje apunta a la conversación. Por eso solo hacen falta
-- estos valores nuevos:
--   direct_conversation -> /messaging/:conversationId
--   challenge_invite    -> /invitations
--   content_report      -> sin navegación (resultado de moderación)
--   user                -> /profile/:userId (nuevo seguidor)
--
-- Solo agrega valores: ALTER TYPE ... ADD VALUE no puede usarse en la misma
-- transacción que inserta filas con el valor nuevo (ver
-- 2026-08-16-01-add-public-post-visibility.sql), así que este archivo no
-- hace nada más. Los valores no se pueden quitar después: no agregar
-- valores "por si acaso".

ALTER TYPE havit.notification_related_entity_type_enum ADD VALUE IF NOT EXISTS 'direct_conversation';
ALTER TYPE havit.notification_related_entity_type_enum ADD VALUE IF NOT EXISTS 'challenge_invite';
ALTER TYPE havit.notification_related_entity_type_enum ADD VALUE IF NOT EXISTS 'content_report';
ALTER TYPE havit.notification_related_entity_type_enum ADD VALUE IF NOT EXISTS 'user';
