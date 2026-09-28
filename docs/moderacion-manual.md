# Moderación manual: reportes y penalizaciones (Sprint 8, Bloque 2)

Alcance: **solo** `workout_posts` (foto/caption) y sus `workout_post_comments`. Chats (`src/chats`) y spaces (`src/spaces`) quedan fuera a propósito.
Es la capa humana encima de la moderación automática: `ModerationService` (foto, OpenAI, `MODERATION_GATE_ENABLED=true`) y la moderación automática de texto de B3 no se tocan.

## Esquema (`database/migrations/2026-09-27-02-add-reports.sql`)

| Objeto | Para qué |
|---|---|
| `workout_posts.is_hidden / hidden_at / hidden_reason` | Oculto por admin. Independiente de `moderation_status` (IA). |
| `workout_post_comments.is_hidden / hidden_at / hidden_reason` | Oculto por admin. Independiente de `is_active` (borrado del autor). |
| `havit.content_reports` | Reporte: `target_type` (`post`/`comment`), `target_id` (TEXT: UUID o BIGINT), `target_owner_id`, `reporter_id`, `reason`, `details`, `status` (`pending`/`dismissed`/`actioned`) y auditoría (`resolution_action`, `resolution_note`, `resolved_by`, `resolved_at`). Índice único parcial: un reporte pendiente por usuario y contenido. |
| `havit.user_penalties` | Strike al autor. `UNIQUE (target_type, target_id)`. |

**Decisión: tabla de penalizaciones, no un campo en `users`.** Guarda el historial (qué contenido, qué reporte, qué admin, cuándo), el conteo se calcula con `COUNT(*)`, y la restricción única impide penalizar dos veces el mismo contenido. Un contador en `users` no deja auditoría y no se puede hacer idempotente sin otra tabla.

## Endpoints (`src/workout-posts/workout-post-reports.*`)

| Método | Ruta | Acceso | Notas |
|---|---|---|---|
| POST | `/reports` | JWT | `{ targetType, targetId, reason, details? }`. 400 id mal formado / contenido propio, 403 post privado ajeno, 404 no existe / oculto / borrado, 409 ya lo reportaste. |
| GET | `/reports/pending?after&limit` | `AdminGuard` (B1) | Más antiguos primero, keyset por id. Incluye vista previa del contenido y strikes del autor. |
| PATCH | `/reports/:id/resolve` | `AdminGuard` (B1) | `{ action: 'dismiss' \| 'hide', penalize?, note? }`. `penalize` solo con `hide`. 404 no existe, 409 ya resuelto. |

## Resolución atómica e idempotente

Todo en una sola transacción (`dataSource.transaction`): fila del reporte bloqueada `FOR UPDATE` y debe seguir `pending` → ocultar contenido → `INSERT … ON CONFLICT (target_type, target_id) DO NOTHING` del strike → cerrar los demás reportes pendientes del mismo contenido (`actioned`, nota "Resuelto junto con el reporte #N") → actualizar el reporte con condición `status='pending'`. Si algo falla, no queda nada a medias. Un reintento responde 409 y nunca crea otro strike.

## Lecturas que excluyen contenido oculto

`WorkoutPostsService`: `fetchPhotos`, `fetchPaginatedPhotos` (perfil/galería), `getFeed`, `findMosaicByChallenge`. `WorkoutPostCommentsService`/`WorkoutPostReactionsService`: un post oculto responde 404; `list`/`getCountsForPosts` filtran comentarios ocultos. El autor tampoco ve su contenido ocultado.

## Frontend

- `components/reports/ReportReasonSheet.tsx`: selector de motivo (bandera en `FeedPostCard` y en cada `CommentRow` ajeno). Éxito con `useErrorNotificationStore().showSuccess`; errores ya los muestra el interceptor de `services/api.ts`.
- `app/profile/moderation.tsx`: cola de admin (entrada con ícono de escudo en el perfil, solo si `useIsAdmin()`), con confirmación antes de descartar/ocultar/ocultar + strike.

## Pruebas

`src/workout-posts/workout-post-reports.service.spec.ts` (store en memoria con las dos restricciones únicas y rollback de transacción): flujo completo, cascada, descarte, reintento, rollback, targets inválidos, DTOs y guards.
