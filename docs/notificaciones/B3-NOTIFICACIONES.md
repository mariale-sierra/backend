# B3 — Notificaciones in-app y push

Estado al 2026-10-05, en `development` de `backend/`, `frontend/` y `raiz/`. Continúa el handoff de B1/B2 (`git show da96998:docs/handoff/HANDOFF-B1-B2-PARA-B3.md`).

## 1. Arquitectura

```
acción (follow, like, mensaje...) ──► servicio de dominio guarda su cambio
                                       │
                                       └─ void notificationsService.notify({...})   (después del commit, sin await)
                                             │  reglas: self, actor/destinatario alcanzables (B2), preferencias, dedupe
                                             ├─ INSERT havit.notifications            (bandeja in-app)
                                             └─ ExpoPushService.send()                (si push habilitado y hay tokens)
                                                   └─ https://exp.host/--/api/v2/push/send ► FCM / APNs
app: GET /notifications ◄── bandeja · badge ◄── GET /notifications/unread-count
app: toque de push ► data {type, entityType, entityId, notificationId} ► ruta de expo-router
```

- **Un solo punto de entrada:** `NotificationsService.notify()` / `notifyMany()` (`src/notifications/notifications.service.ts`). Ningún módulo arma notificaciones por su cuenta.
- **Nunca rompe la acción principal:** `notify()` atrapa todo y devuelve `null`; los emisores lo llaman con `void` después de su propia escritura (o después del commit de su transacción). Los fan-out (mensajes de espacio, challenge cerrado) son `async` con `try/catch` propio. Probado con fallos de BD, de Expo y de red.
- `NotificationsModule` solo depende de sus tablas, `users` y (con `forwardRef`) `AuthModule`, así que cualquier módulo lo importa sin ciclos.

## 2. Base de datos

Migraciones (aplicadas por `npm run db:migrate`, probadas en una base desechable del Postgres local, nunca en Azure):

| Archivo | Qué hace |
|---|---|
| `migrations/2026-10-05-01-notifications-entity-types.sql` | Agrega `direct_conversation`, `challenge_invite`, `content_report`, `user` al enum `notification_related_entity_type_enum`. Archivo propio: un `ADD VALUE` no se puede usar en la misma transacción. |
| `migrations/2026-10-05-02-notifications-push-tokens-and-preferences.sql` | `notifications.related_entity_id` BIGINT → `VARCHAR(64)` (UUID e ids numéricos); `notifications.data JSONB`; índice parcial de dedupe; `notification_types.category` y `user_configurable`; tablas `device_push_tokens` y `notification_preferences`. |
| `seeds/2026-10-05-01-notification-types.sql` | Los 16 tipos (upsert por `code`). |

- `related_entity_type`/`related_entity_id` apuntan **al recurso que se abre**, no al evento: un comentario apunta al post, una solicitud al challenge/espacio, un mensaje a la conversación.
- `device_push_tokens`: `token` único global. Si otra cuenta inicia sesión en el mismo teléfono, el token se reasigna (upsert).
- `notification_preferences`: opt-out por usuario y tipo; **sin fila = todo habilitado**. La app trabaja por categoría y el backend aplica el cambio a todos los tipos de esa categoría.
- **Purga B2:** `AccountDeletionService.purgeAccount()` borra `device_push_tokens` y `notification_preferences` (además de lo que ya hacía con `notifications`). Lo cubre `account-deletion.integration.spec.ts` contra Postgres real.
- `notifications.created_at` es `timestamp` con microsegundos; el servicio lo fija desde la app con precisión de milisegundos para que el cursor (ms) no salte filas.

## 3. Endpoints (`@ApiTags('Notifications')`, JWT obligatorio)

| Método | Ruta | Notas |
|---|---|---|
| GET | `/notifications?cursor=&limit=` | Bandeja propia, más nuevas primero. Patrón B1: `CursorPaginationQueryDto`, `decodeCursor(…, 'integer')`, header `X-Next-Cursor`. Cursor inválido → 400. |
| GET | `/notifications/unread-count` | `{ count }` |
| PATCH | `/notifications/:id/read` | Solo propias; una ajena o inexistente → 404 (no confirma que exista); id no numérico → 400. |
| PATCH | `/notifications/read-all` | `{ updated }` |
| GET | `/notifications/preferences` | `[{ category, inAppEnabled, pushEnabled, inAppConfigurable }]` |
| PATCH | `/notifications/preferences` | `{ preferences: [{ category, inAppEnabled?, pushEnabled? }] }` |
| POST | `/notifications/push-tokens` | `{ token: "ExponentPushToken[…]", platform: "ios"\|"android" }`. Idempotente, refresca `last_seen_at`. |
| DELETE | `/notifications/push-tokens` | `{ token }`. Logout; solo borra tokens propios. |

## 4. Tipos y dónde se emiten

| Categoría | `code` | Destinatario | Emisor |
|---|---|---|---|
| social | `new_follower` | seguido | `FollowsService.follow` |
| social | `post_reaction` | autor del post | `WorkoutPostReactionsService.react` |
| social | `post_comment` | autor del post | `WorkoutPostCommentsService.create` (solo `commentId`, nunca el texto) |
| messages | `direct_message` | el otro miembro (conversación activa) | `ChatsService.sendMessage` |
| messages | `space_message` | miembros activos menos quien escribe | `SpacesService.sendMessage` |
| spaces | `space_join_request` / `space_join_response` | dueño / solicitante | `SpacesService.join` (privado) / `respondToJoinRequest` |
| challenges | `challenge_invite` | invitado | `ChallengeInvitesService.create` |
| challenges | `challenge_invite_response` | quien invitó | `accept` / `decline` |
| challenges | `challenge_join_request` / `challenge_join_response` | dueño / solicitante | `ChallengesService.joinChallenge` (privado) / `respondToChallengeJoinRequest` |
| challenges | `challenge_participant_joined` | dueño | `joinChallenge` (público) |
| challenges | `challenge_removed` | participante removido | `removeChallengeParticipant` |
| challenges | `challenge_closed` | dueño y participantes activos, sin actor | `closeChallenge` (admin) |
| moderation | `report_resolved` | cada reportante del contenido | `WorkoutPostReportsService.resolve` |
| moderation | `content_hidden` | autor del contenido ocultado (`strike` en data) | `resolve` con `hide` |

No se notifica: cancelar una invitación, dejar un challenge, el baneo (la cuenta baneada no puede entrar) ni un join público a un espacio (ruido).

## 5. Reglas de `notify()`

1. Actor = destinatario → nada.
2. Tipo inexistente o inactivo → nada.
3. Destinatario baneado (`is_active=false`), con eliminación pendiente o ya purgado → nada (B2). Igual si el **actor** está en ese estado: una cuenta oculta no genera eventos.
4. Preferencia in-app apagada → nada (ni push). Los tipos de la categoría `moderation` no se pueden apagar en la bandeja (`user_configurable=false`); su push sí.
5. **Dedupe:** si ya hay una no leída del mismo tipo sobre el mismo recurso, se refresca (fecha, actor) y no se vuelve a enviar push. Ráfagas de mensajes o varios likes = 1 notificación.
6. **Repetición:** mismo actor + mismo evento + mismo recurso en 10 min (`REPEAT_WINDOW_MS`) → nada (follow/unfollow/follow).
7. Se guarda un título/cuerpo genérico (español o inglés según `user_profiles.preferred_language`). La app arma su propio texto i18n con el `code`.

## 6. Privacidad

- Ni la bandeja ni el push llevan texto escrito por usuarios: ni el contenido de mensajes o comentarios, ni los detalles de un reporte ni nombres de challenges. El push solo lleva un texto genérico (“Tienes un mensaje nuevo”) y ids para navegar (`type`, `entityType`, `entityId`, `notificationId` y ids extra como `challengeId`). Motivo: la API sigue siendo HTTP sin TLS y APNs/FCM ven el payload.
- Los emisores de posts reutilizan las validaciones existentes: no hay notificación para posts ocultos o que el actor no puede ver (`loadReactablePost`/`loadCommentablePost` fallan antes). El destinatario siempre es dueño del post.
- Un actor con eliminación pendiente o purgado se devuelve como `actor: null` (la app muestra “Usuario eliminado”). En moderación nunca se revela qué admin actuó.
- Una conversación rechazada (soft-delete) no notifica a quien la rechazó.

## 7. Push (Expo)

- Backend: `ExpoPushService` (`src/notifications/expo-push.service.ts`). Usa `fetch` de Node 20 contra la API HTTP de Expo, en lotes de 100 y con timeout de 10 s. Si existe `EXPO_ACCESS_TOKEN`, lo manda como Bearer (solo hace falta si la cuenta de Expo tiene “enhanced push security”).
- **Tokens inválidos:** `DeviceNotRegistered` en el ticket → `is_active=false` de inmediato. Los tickets OK se guardan en memoria y un cron (cada 10 min) consulta los receipts y desactiva los que fallen. Si el proceso se reinicia, los tickets pendientes se pierden; solo retrasa la limpieza hasta el siguiente envío fallido. Verificado contra Expo real: un token inventado vuelve como `DeviceNotRegistered` y queda inactivo sin afectar la acción.
- Badge: cada push lleva `badge` = no leídas del destinatario.
- Frontend: `expo-notifications` y `expo-device` (~57). Archivos clave: `services/notifications/pushNotifications.ts`, `hooks/usePushNotifications.ts`, `hooks/usePushPermission.ts`, `services/notifications/notificationRoutes.ts`.
  - Permiso: nunca se pide al abrir la app. Se ofrece desde una tarjeta en la bandeja y en Configuración. Estado `blocked` (el SO ya no deja preguntar) → solo “Abrir ajustes”, así no hay bucles. “Ahora no” se recuerda.
  - Token: se registra o refresca al iniciar sesión (si ya hay permiso) y cuando el SO lo rota. En logout se borra del backend antes de cerrar la sesión (espera máxima de 3 s).
  - Toque: foreground y background por listener; app cerrada por `getLastNotificationResponse()`. La navegación espera a que el usuario pase login, términos y onboarding. Los ids del payload se validan antes de construir una ruta. Si una conversación ya no existe, muestra un aviso y lleva al inbox de mensajes.

## 8. Pruebas

Backend (`npx jest`): 813 tests, **807 pasan**, 4 omitidos (integraciones sin `B2_TEST_DB_URL`) y **2 fallas preexistentes** en `workout-posts.service.spec.ts` (moderación de imágenes desactivada, `2026-09-08-02`), ajenas a B3.
- `src/notifications/*.spec.ts` (47): creación, self, preferencias, tipo no configurable, destinatario o actor inactivo/pendiente/purgado, actor `NULL`, dedupe, ventana de repetición, error interno tragado, fallo de push, listado, cursor (y cursor inválido o UUID → 400), marcar una/ajena/todas, contador, preferencias, tokens (upsert, reasignación, borrado propio, validación del DTO), Expo (envío, lotes, `DeviceNotRegistered` en ticket y receipt, HTTP 500, red caída).
- Emisores, en las suites existentes: follows, reactions, comments, chats, spaces, invites, challenges, reports. Cada uno prueba que notifica a la persona correcta, que no notifica si la acción falla o se revierte, y que un fallo de notificación no rompe la acción.
- Integración real (Postgres desechable): `B2_TEST_DB_URL=… npx jest account-deletion.integration` verifica que la purga borra tokens, preferencias y notificaciones, y anonimiza al actor.
- E2E local (API + base desechable): follow, join, like y 3 DMs generan 4 notificaciones (los DMs colapsados en 1). Un usuario con eliminación pendiente no recibe nada. Expo real desactiva un token inválido.

Frontend (`npx jest`): 1791 pasan; la única suite que falla es `app/(tabs)/__tests__/index.test.tsx`, preexistente (falta el mock de AsyncStorage). `npx tsc --noEmit`: 4285 errores antes y después, **0 nuevos**.

## 9. Pendiente que no es código (requiere credenciales o hardware)

1. `eas init` en `frontend/` (escribe `extra.eas.projectId`; también vale la variable `EAS_PROJECT_ID`). Sin projectId la app no obtiene token y no rompe nada.
2. Credenciales en EAS: **FCM v1** (service account de Firebase, Android) y **APNs** (key de Apple Developer, iOS).
3. Development build (`eas build --profile development`): el push remoto no funciona en Expo Go para Android (SDK 53+), ni en simuladores iOS.
4. Pruebas en dispositivo real Android e iOS: foreground, background y app cerrada.
5. **Legal:** la política de privacidad debe mencionar los tokens de dispositivo y a Expo, Google (FCM) y Apple (APNs) como proveedores (handoff §7). Hay que avisar a quien mantiene `constants/legal/legalDocs.ts`.

## 10. Cómo probar

**In-app (ahora, sin credenciales):** levanta la API contra una base desechable del Postgres local (`havit-db-local`, puerto 5434) exportando `DB_HOST=127.0.0.1 DB_PORT=5434 DB_DATABASE=<desechable> DB_SSL=false …` y corre `npm run db:migrate` y `npm run start:dev`. Abre la app con `EXPO_PUBLIC_API_URL=http://localhost:3000 npx expo start --web` (o `npm run start:local` en teléfono). Con dos cuentas: B sigue a A, reacciona a un post de A y le escribe un DM. En A, la campana del Home muestra el punto; la bandeja lista las notificaciones, al tocar una se marca leída y abre la pantalla, “Marcar todo como leído” limpia el punto y los switches de Configuración se guardan en `havit.notification_preferences`.

**Push (con credenciales, en dispositivo real):**
1. `eas init`, cargar las credenciales FCM y APNs y correr `eas build --profile development --platform android|ios`. Instalar en el teléfono.
2. Iniciar sesión, abrir la bandeja, tocar “Activar” y aceptar el permiso. Comprobar en `havit.device_push_tokens` el token y la plataforma.
3. Con la app en **foreground**, desde otra cuenta seguir al usuario: aparece el banner y el punto se actualiza.
4. Con la app en **background**, enviar un DM: al tocar el push se abre esa conversación y la notificación queda leída.
5. Con la app **cerrada** (swipe away), invitarlo a un reto: al tocar el push la app abre en `/invitations`.
6. Denegar el permiso y volver a la bandeja: la tarjeta ofrece “Abrir ajustes” y no vuelve a aparecer el diálogo del sistema.
7. Cerrar sesión: el token desaparece de `device_push_tokens` y ya no llegan pushes.
8. Desinstalar la app y provocar una notificación: Expo responde `DeviceNotRegistered` y el token queda `is_active=false`.
