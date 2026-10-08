-- 2026-10-05-01-notification-types.sql
--
-- B3: catálogo de tipos de notificación. `code` es el contrato estable con
-- el backend (NotificationTypeCode) y con la app (textos i18n y
-- navegación); `category` agrupa los tipos en Preferencias.
-- ON CONFLICT DO UPDATE mantiene name/description/category al día si se
-- re-ejecuta, sin tocar ids (las preferencias y notificaciones los
-- referencian).

INSERT INTO havit.notification_types (code, name, description, category, user_configurable, is_active) VALUES
  ('new_follower',                 'Nuevo seguidor',            'Alguien empezó a seguirte',                          'social',     true,  true),
  ('post_reaction',                'Reacción',                  'Alguien reaccionó a tu publicación',                 'social',     true,  true),
  ('post_comment',                 'Comentario',                'Alguien comentó tu publicación',                     'social',     true,  true),
  ('direct_message',               'Mensaje directo',           'Nuevo mensaje en una conversación',                  'messages',   true,  true),
  ('space_message',                'Mensaje en espacio',        'Nuevo mensaje en un espacio del que eres miembro',   'messages',   true,  true),
  ('space_join_request',           'Solicitud a espacio',       'Alguien pidió unirse a tu espacio',                  'spaces',     true,  true),
  ('space_join_response',          'Respuesta de espacio',      'Respondieron tu solicitud a un espacio',             'spaces',     true,  true),
  ('challenge_invite',             'Invitación a challenge',    'Te invitaron a un challenge',                        'challenges', true,  true),
  ('challenge_invite_response',    'Respuesta a invitación',    'Respondieron tu invitación a un challenge',          'challenges', true,  true),
  ('challenge_join_request',       'Solicitud a challenge',     'Alguien pidió unirse a tu challenge',                'challenges', true,  true),
  ('challenge_join_response',      'Respuesta de challenge',    'Respondieron tu solicitud a un challenge',           'challenges', true,  true),
  ('challenge_participant_joined', 'Nuevo participante',        'Alguien se unió a tu challenge',                     'challenges', true,  true),
  ('challenge_closed',             'Challenge cerrado',         'Cerraron un challenge en el que participas',         'challenges', true,  true),
  ('challenge_removed',            'Removido de challenge',     'Te removieron de un challenge',                      'challenges', true,  true),
  ('report_resolved',              'Reporte revisado',          'Revisamos un reporte que hiciste',                   'moderation', true,  true),
  ('content_hidden',               'Contenido ocultado',        'Ocultamos contenido tuyo tras una revisión',         'moderation', false, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  user_configurable = EXCLUDED.user_configurable;
