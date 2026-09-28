# Moderación automática de texto (Sprint 8, Bloque 3)

Capa **automática y preventiva**: el texto se valida con OpenAI **antes de guardarse**. La moderación manual y reactiva (reportes y penalizaciones de B2) está en [`moderacion-manual.md`](./moderacion-manual.md) y no se modifica aquí.

## Servicio

`src/openai/moderation.service.ts`, que es el mismo `ModerationService` que ya moderaba las fotos. No hay un segundo cliente de OpenAI.

| Método | Qué hace |
|---|---|
| `validateWorkoutImage(imageUrl, caption?)` | Sin cambios: foto + caption, en el cron asíncrono de `WorkoutPostsService`. |
| `validateText(text \| text[])` | **Nuevo.** Solo texto, modelo `omni-moderation-latest`, devuelve `{ flagged, flaggedCategories }` (mismo shape). Varios textos van en **una sola llamada**: queda marcado si cualquiera lo está, y las categorías se juntan sin duplicados. Los textos vacíos o solo espacios se ignoran; si no queda nada, no se llama a la API. |
| `assertTextAllowed(text \| text[])` | **Nuevo.** Llama a `validateText()` y, si el texto está marcado, lanza el error estándar de abajo. Es lo que usan los services. |

## Dónde se aplica (síncrono, antes de guardar)

| Contenido | Punto de integración | Campos | Momento |
|---|---|---|---|
| Crear challenge (`POST /challenges`) | `ChallengesService.create()` | `name`, `description`, `instructions` | Antes de abrir la transacción, así no queda una conexión a la BD abierta esperando a OpenAI. |
| Editar challenge (`PATCH /challenges/:id`) | `ChallengesService.update()` | Solo los campos de texto presentes en el DTO | Después del chequeo de dueño y antes de `save`. |
| Comentar un post (`POST /workout-posts/:postId/comments`) | `WorkoutPostCommentsService.create()` | `content` | Después del 404/403/`is_hidden` y antes de `save`. |
| Editar perfil (`PATCH /users/me/profile`) | `UsersService.updateProfile()` | `bio` (si viene y no está vacía; una bio vacía la borra y no se modera) | Antes de escribir cualquier campo del perfil. |

**Decisión: moderación síncrona.** El texto es liviano y la cuenta de OpenAI ya no tiene rate-limit, así que no se replica el cron de las fotos. El usuario recibe el veredicto en la misma respuesta.

**Decisión: fail-closed.** Si OpenAI no responde (red, API key, error del proveedor), se devuelve `503` y **no se guarda nada**. Es el mismo comportamiento que ya tenía `validateWorkoutImage()`: no se publica contenido que no se pudo validar.

## Formato de error

Es el mismo shape global de `HttpExceptionFilter` que ya lee el interceptor del frontend (`services/api.ts`):

```json
{ "statusCode": 400, "error": "Bad Request",
  "message": "Tu contenido no cumple con las normas de la comunidad",
  "code": "CONTENT_REJECTED", "timestamp": "…", "path": "…" }
```

`CONTENT_REJECTED` se agregó a `ErrorCode` (`src/common/constants/error-code.enum.ts`). El frontend lo traduce con i18n (`common.errors.contentRejectedTitle/Message`, en es y en) y lo muestra con el `errorNotificationStore` existente. Las categorías marcadas **no** se envían al cliente.

Si OpenAI falla: `503` con el mensaje `No se pudo validar el contenido en este momento…`.

## Fuera de alcance a propósito

- **Chats (`src/chats`, `send-message.dto.ts`) y spaces (`src/spaces`, `send-space-message.dto.ts`) NO se moderan.** Son mensajería en tiempo real, potencialmente privada entre usuarios. Moderarla (de forma automática o manual) es una decisión de producto y de privacidad que el equipo evaluará en un ticket aparte. **No agregues moderación ahí sin esa decisión**, aunque técnicamente sea una línea.
- **Caption de posts con foto:** ya se modera junto con la imagen en `validateWorkoutImage()` (cron). No se duplica aquí.
- **`display_name` del perfil:** no está en la lista de campos acordada para el Sprint 8.

## Limitación conocida: días de descanso y posts de solo texto

El documento del sprint pedía cubrir "un post de solo texto/rest-day sin imagen". Se revisó el flujo completo en `development` y **hoy ese texto nunca se persiste**:

- Frontend: `app/(add)/rest-day.tsx` envía solo `{ challengeId, isRestDay: true, visibility }`, sin caption. Ninguna pantalla envía `caption`.
- Backend: `WorkoutLogService.createWorkout()` solo crea un `workout_post` cuando `!isRestDay`. En un día de descanso, un `caption` que llegue por la API se descarta, y `workout_logs.notes` nunca se llena desde ese endpoint.
- BD: `workout_posts.image_url` es `NOT NULL`, así que no puede existir un post sin imagen.

Por eso **no se modificó** `workout-log.service.ts` (lógica de B5) ni se crearon migraciones. Si en el futuro se habilita guardar texto en días de descanso (un post de solo texto, o llenar `notes`), ese punto de guardado debe llamar a `moderationService.assertTextAllowed(texto)` antes de persistir.

## Pruebas

Ver `docs/testing/PLAN-MAESTRO-PRUEBAS.md`, casos CP-65 a CP-70.
