/**
 * B3 notification catalog — the codes seeded in
 * database/seeds/2026-10-05-01-notification-types.sql. Adding a type means:
 * a seed row, a code here, its copy below, and its i18n text + navigation
 * in the app (frontend services/notifications/notificationRoutes.ts).
 */
export const NOTIFICATION_TYPE_CODES = [
  'new_follower',
  'post_reaction',
  'post_comment',
  'direct_message',
  'space_message',
  'space_join_request',
  'space_join_response',
  'challenge_invite',
  'challenge_invite_response',
  'challenge_join_request',
  'challenge_join_response',
  'challenge_participant_joined',
  'challenge_closed',
  'challenge_removed',
  'report_resolved',
  'content_hidden',
] as const;
export type NotificationTypeCode = (typeof NOTIFICATION_TYPE_CODES)[number];

export const NOTIFICATION_CATEGORIES = [
  'social',
  'messages',
  'challenges',
  'spaces',
  'moderation',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/**
 * What a notification points at — always the screen it opens, not the
 * event: a comment points at its post, a join request at its challenge or
 * space, a message at its conversation.
 */
export type NotificationEntityType =
  | 'workout_post'
  | 'direct_message'
  | 'space'
  | 'user_follow'
  | 'challenge'
  | 'direct_conversation'
  | 'challenge_invite'
  | 'content_report'
  | 'user';

export type NotificationLanguage = 'es' | 'en';

interface Copy {
  title: string;
  body: string;
}

/**
 * Generic copy, stored as the in-app fallback text and sent as the push
 * text. Deliberately never contains names, challenge titles or anything a
 * user wrote: the API is plain HTTP and APNs/FCM see the push payload (B2
 * handoff §2.6). The app renders its own localized text from the type code
 * and loads the details through the authenticated inbox.
 */
export const NOTIFICATION_COPY: Record<
  NotificationTypeCode,
  Record<NotificationLanguage, Copy>
> = {
  new_follower: {
    es: { title: 'Nuevo seguidor', body: 'Alguien empezó a seguirte.' },
    en: { title: 'New follower', body: 'Someone started following you.' },
  },
  post_reaction: {
    es: {
      title: 'Nueva reacción',
      body: 'Alguien reaccionó a tu publicación.',
    },
    en: { title: 'New reaction', body: 'Someone reacted to your post.' },
  },
  post_comment: {
    es: { title: 'Nuevo comentario', body: 'Alguien comentó tu publicación.' },
    en: { title: 'New comment', body: 'Someone commented on your post.' },
  },
  direct_message: {
    es: { title: 'Nuevo mensaje', body: 'Tienes un mensaje nuevo.' },
    en: { title: 'New message', body: 'You have a new message.' },
  },
  space_message: {
    es: {
      title: 'Actividad en un espacio',
      body: 'Hay mensajes nuevos en uno de tus espacios.',
    },
    en: {
      title: 'Space activity',
      body: 'There are new messages in one of your spaces.',
    },
  },
  space_join_request: {
    es: {
      title: 'Solicitud de ingreso',
      body: 'Alguien quiere unirse a tu espacio.',
    },
    en: { title: 'Join request', body: 'Someone wants to join your space.' },
  },
  space_join_response: {
    es: {
      title: 'Solicitud respondida',
      body: 'Respondieron tu solicitud a un espacio.',
    },
    en: {
      title: 'Request answered',
      body: 'Your request to join a space was answered.',
    },
  },
  challenge_invite: {
    es: { title: 'Nueva invitación', body: 'Te invitaron a un challenge.' },
    en: { title: 'New invite', body: 'You were invited to a challenge.' },
  },
  challenge_invite_response: {
    es: {
      title: 'Invitación respondida',
      body: 'Respondieron una invitación que enviaste.',
    },
    en: { title: 'Invite answered', body: 'An invite you sent was answered.' },
  },
  challenge_join_request: {
    es: {
      title: 'Solicitud de ingreso',
      body: 'Alguien quiere unirse a tu challenge.',
    },
    en: {
      title: 'Join request',
      body: 'Someone wants to join your challenge.',
    },
  },
  challenge_join_response: {
    es: {
      title: 'Solicitud respondida',
      body: 'Respondieron tu solicitud a un challenge.',
    },
    en: {
      title: 'Request answered',
      body: 'Your request to join a challenge was answered.',
    },
  },
  challenge_participant_joined: {
    es: {
      title: 'Nuevo participante',
      body: 'Alguien se unió a tu challenge.',
    },
    en: { title: 'New participant', body: 'Someone joined your challenge.' },
  },
  challenge_closed: {
    es: {
      title: 'Challenge cerrado',
      body: 'Se cerró un challenge en el que participas.',
    },
    en: {
      title: 'Challenge closed',
      body: 'A challenge you are in was closed.',
    },
  },
  challenge_removed: {
    es: {
      title: 'Saliste de un challenge',
      body: 'El creador te removió de un challenge.',
    },
    en: {
      title: 'Removed from a challenge',
      body: 'The creator removed you from a challenge.',
    },
  },
  report_resolved: {
    es: {
      title: 'Reporte revisado',
      body: 'Revisamos un reporte que enviaste.',
    },
    en: { title: 'Report reviewed', body: 'We reviewed a report you sent.' },
  },
  content_hidden: {
    es: {
      title: 'Contenido ocultado',
      body: 'Ocultamos contenido tuyo tras una revisión.',
    },
    en: {
      title: 'Content hidden',
      body: 'Some of your content was hidden after a review.',
    },
  },
};

export function notificationCopy(
  code: NotificationTypeCode,
  language: string | null | undefined,
): Copy {
  const lang: NotificationLanguage = language === 'en' ? 'en' : 'es';
  return NOTIFICATION_COPY[code][lang];
}
