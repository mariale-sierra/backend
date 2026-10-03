# Handoff B1 + B2 → B3 (Notificaciones)

Documento para quien (persona o LLM) tome **B3: notificaciones in-app + push**. Resume lo que B1 y B2 dejaron hecho, las reglas del repo, el estado real del código de notificaciones y las trampas que ya encontramos. Fecha: 2026-10-03. Todo lo descrito está en `development` de `backend/` y `frontend/` (no en `main`).

> Ojo con el nombre: en comentarios y commits viejos, "B3" a veces se refiere a la **moderación automática de texto** (ver `docs/moderacion-automatica.md`). El B3 de este documento es la línea de **notificaciones**.

---

## 0. Reglas del proyecto que hay que respetar (de `CLAUDE.md`)

- `Havit/` **no es un monorepo**: `backend/`, `frontend/` y `raiz/` son tres repos Git independientes. Entra al repo exacto antes de cualquier comando Git.
- Antes de tocar archivos: `git status`, `git fetch --prune`, revisa ramas y PRs abiertos, y confirma que nadie hizo ya lo mismo. Hoy hay una rama sin mergear en ambos repos, `feature/challenge-roles` (administración de challenges); revísala si tu trabajo toca challenges, join requests o baneos.
- Se trabaja **directo en `development`** (rama de integración). Nunca commit/push a `main`; pasar a `main` requiere confirmación explícita del usuario.
- Commits **en español, minúsculas, cortos**, sin ninguna atribución a IA (nada de `Co-authored-by`, "Generated with…", etc.).
- Cambios de base de datos: **solo** `npm run db:new -- migration <nombre>` (archivo SQL en `backend/database/migrations/`), idempotente. No uses migraciones TypeORM ni `synchronize`. El contenedor del backend aplica las migraciones al arrancar.
- Frontend: no agregues dependencias salvo que la tarea lo pida (B3 sí lo pide para push, ver §5), usa el cliente `services/api.ts` único, tokens de `constants/theme.ts`, y textos en `i18n/resources/en.ts` **y** `es.ts`.
- **Nunca** corras migraciones, escaneos ni pruebas destructivas contra la base de Azure (`pg-havit-dev-01`) desde tu máquina. Para pruebas con SQL real crea una base desechable en el Postgres local de Docker (`havit-db-local`, puerto 5434), aplica las migraciones ahí y bórrala al terminar.

---

## 1. Qué dejó B1 (escalabilidad)

Fuente completa: `backend/performance/B1-*.md`. Resumen:

- **PgBouncer** (`raiz/docker-compose.yml`): opt-in con `DB_POOL_HOST`/`DB_POOL_PORT`. **En la VM no está corriendo hoy** (solo `havit-backend`); el backend conecta directo a Azure. Azure tiene `max_connections = 50` (≈35 útiles). `DB_POOL_SIZE` por instancia = 10.
- **Redis**: `RedisCacheService` (`src/cache/`) con `getOrSet`, `getVersion`/`bumpVersion` por namespace, fail-open si Redis falla. Cachea `GET /challenges` (20 s) y `GET /workout-logs` por usuario (15 s). Throttler respaldado en Redis si hay `REDIS_URL`.
- **Paginación por cursor** (breaking change): `GET /challenges` y `GET /workout-logs` devuelven páginas (default 20, máx 50); el siguiente cursor viene en el header `X-Next-Cursor`; se pide con `?cursor=`. Util en `src/common/pagination.util.ts` y `cursor-pagination-query.dto.ts`. **B2 le agregó validación del tipo de id del cursor** (`decodeCursor(cursor, 'uuid' | 'integer')`): un cursor con id inválido responde 400, no 500.
- Pendientes de B1 que siguen abiertos: el frontend no recorre cursores (muestra solo la primera página), re-benchmark de `workout-logs` con datos reales, throttler en multi-instancia, validar PgBouncer contra Azure real.

**Para B3:** si la bandeja de notificaciones se pagina, **reusa exactamente ese patrón** (`X-Next-Cursor`, `CursorPaginationQueryDto`, `decodeCursor`). Nota: `notifications.id` es `BIGINT`, usa `idKind = 'integer'`. Si cacheas conteos de no leídas, usa `bumpVersion` por usuario como en `workout-log:user:<id>`.

---

## 2. Qué dejó B2 (seguridad y legal)

Fuente completa: `backend/docs/security/B2-SEGURIDAD-Y-LEGAL.md`. Verificado en el servidor real (ZAP final: 0 fallos, 0 avisos).

- **Cabeceras** (`src/config/security-headers.ts`, un solo `helmet()` en `main.ts`): CSP estricta (`default-src 'none'`, sin `unsafe-inline`; solo `/api-docs` la relaja), Permissions-Policy, COEP `require-corp`, COOP/CORP `same-origin`, `Cache-Control: no-store` en toda la API. `GET /` responde JSON.
- **Visibilidad**: `GET /workout-posts/mosaic` ahora aplica el mismo filtro que Feed/perfiles (`postVisibilityFilter()` + `challengePrivacyFilter()` en `workout-posts.service.ts`). **Cualquier lectura nueva de posts debe reusar esos filtros**; una notificación nunca debe revelar un post al que el destinatario no tiene acceso.
- **T&C y edad 16+**: `POST /auth/register` exige `acceptTerms: true` y `confirmAge16: true`. Se guarda `terms_accepted_at`, `terms_version`, `age_confirmed_at`. Versión vigente en `src/auth/terms-version.ts`. `POST /auth/accept-terms` y `requires_terms_acceptance` en `GET /users/me` cubren cuentas existentes. Frontend: checkboxes en `register.tsx`, `app/(auth)/legal.tsx`, `app/accept-terms.tsx`, textos en `constants/legal/legalDocs.ts`.
- **Eliminación de cuenta** (`src/users/account-deletion.service.ts`): `POST/GET/DELETE /users/me/deletion-request`; 30 días de gracia; cron horario purga y anonimiza; auditoría en `havit.account_deletion_audit` (sin FK a `users`). Frontend: `app/profile/delete-account.tsx`.
- **Bugs que ZAP encontró y se corrigieron**: cursor con id no-UUID (500) y paginación no numérica en `/exercises/muscles/:code` (500).

**Lo que B2 implica directamente para B3:**

1. La purga de cuenta ejecuta `DELETE FROM notifications WHERE recipient_user_id = …` y `UPDATE notifications SET actor_user_id = NULL WHERE actor_user_id = …`. **Si agregas tablas nuevas con datos por usuario (tokens push, preferencias), añádelas a la lista `purgeTables` de `AccountDeletionService.purgeAccount()`**, o quedarán datos personales de usuarios eliminados. Los tokens de push en particular deben borrarse al eliminar la cuenta y al cerrar sesión.
2. Un usuario con eliminación pendiente (`deletion_requested_at` no nulo) está oculto para los demás: **no le generes ni le envíes notificaciones push mientras esté pendiente**, y no generes notificaciones cuyo actor esté eliminado/pendiente.
3. El actor puede ser `NULL` (cuenta eliminada): la UI debe tolerarlo ("Usuario eliminado").
4. **CSP/COEP no afecta a la app móvil** (no es navegador), pero sí a cualquier cliente web. No expongas contenido de usuarios en respuestas cacheables: la API ya manda `no-store`.
5. Si agregas endpoints, decláralos con `@ApiBearerAuth()` y DTOs completos: el `ValidationPipe` global usa `forbidNonWhitelisted`.
6. El tráfico sigue siendo **HTTP sin TLS** (`http://20.63.84.1:3000`). No pongas datos sensibles en el cuerpo de las notificaciones push (los proveedores APNs/FCM los pueden ver); usa títulos genéricos y deja el detalle para cuando la app abra la bandeja.

---

## 3. Estado real del código de notificaciones (lo que **ya existe**)

Verificado en el repo el 2026-10-03:

**Base de datos** (`database/init/2026-07-07-00-init-schema.sql`, tablas 36 y 37):

```
notification_types(id BIGINT PK, code VARCHAR(100) UNIQUE, name, description, is_active)
notifications(id BIGINT PK, recipient_user_id UUID → users ON DELETE CASCADE,
              actor_user_id UUID → users ON DELETE SET NULL,
              notification_type_id BIGINT → notification_types,
              related_entity_type notification_related_entity_type_enum NOT NULL,
              related_entity_id BIGINT NULL, title VARCHAR(255), body TEXT,
              is_read BOOLEAN DEFAULT false, created_at, is_active BOOLEAN DEFAULT true)
-- índice: (recipient_user_id, is_read, created_at DESC)
-- enum related_entity_type: 'workout_post','direct_message','space','user_follow','challenge'
```

**Backend:** no existe módulo, entidad, controlador ni servicio de notificaciones (`grep` no encuentra nada fuera de `account-deletion.service.ts`). **No hay seed** de `notification_types` (la tabla está vacía).

**Frontend:** `app/notifications.tsx` es un **placeholder** (solo muestra `placeholders.notifications`); está registrada como modal en `app/_layout.tsx`. Hay un punto rojo de "notificación" en el header de `app/(tabs)/profile.tsx`. **No existe** `expo-notifications` ni `expo-device` en `package.json`.

### Trampas del esquema que B3 debe resolver con una migración

1. **`related_entity_id` es `BIGINT`, pero `workout_posts.id`, `challenges.id` y `users.id` son UUID.** Solo `direct_messages`/ids numéricos caben. Hay que cambiarlo (por ejemplo a `TEXT`, o agregar `related_entity_uuid UUID` y exigir uno de los dos). Decídelo antes de escribir código.
2. **El enum `related_entity_type` no cubre** challenge invites, join requests, reportes ni comentarios/reacciones (que cuelgan de un post). Agrega valores con `ALTER TYPE … ADD VALUE IF NOT EXISTS` (fuera de transacción si tu versión de Postgres lo exige; revisa cómo lo manejó `migrate.js`, que corre cada archivo en una transacción).
3. **No hay tabla de dispositivos ni de preferencias.** Necesitas migraciones para `device_push_tokens` (user_id, token, plataforma, última vez visto, índice único por token) y preferencias por categoría (por ejemplo `notification_preferences(user_id, notification_type_id, enabled)` con default habilitado).

---

## 4. Puntos del backend donde nacen los eventos (para el paso "Generar eventos")

Todos existen hoy y son candidatos a emitir una notificación (hazlo en el mismo flujo/transacción cuando sea posible, y que un fallo al notificar **nunca** rompa la acción principal):

| Evento | Dónde |
|---|---|
| Nuevo seguidor | `src/follows/follows.service.ts` (follow) |
| Reacción / like | `src/workout-posts/workout-post-reactions.service.ts` |
| Comentario | `src/workout-posts/workout-post-comments.service.ts` |
| Mensaje directo / de espacio | `src/chats/chats.service.ts`, `src/spaces/spaces.service.ts` |
| Invitación a challenge (recibida/aceptada/rechazada) | `src/challenge-invites/` |
| Solicitud de ingreso a challenge o espacio y su respuesta | `src/challenges/challenges.service.ts`, `src/spaces/` |
| Reporte resuelto / contenido ocultado / strike | `src/workout-posts/workout-post-reports.service.ts` |
| Challenge cerrado / participante removido / baneo | `challenges.service.ts`, `users.service.ts` (`banUser`) |

Cuidados: no te notifiques a ti mismo (actor = destinatario); no notifiques por contenido oculto (`is_hidden`) ni a quien bloqueó/fue eliminado; respeta visibilidad (usa los filtros de B2); evita notificaciones duplicadas por doble tap (hay un precedente de race condition en `workout-log`, ver `uq_workout_logs_user_challenge_local_day`); agrupa o limita ráfagas (ej. 50 likes).

---

## 5. Lo que falta en push (infraestructura que no es solo código)

- `expo-notifications` (+ `expo-device`, `expo-constants` ya está) y **build nativo** (EAS / development build): las notificaciones push **no funcionan en Expo Go** en Android/iOS recientes.
- Credenciales: **FCM** (Firebase) para Android y **APNs** (cuenta de Apple Developer) para iOS; o usar el servicio de push de Expo, que las enmascara pero igual necesita configurarlas en EAS. Decide cuál antes de empezar.
- El backend envía por la API HTTP de Expo (`https://exp.host/--/api/v2/push/send`) o FCM directo; hace falta manejar **recibos/errores** (tokens inválidos `DeviceNotRegistered` → borrarlos).
- Permisos: pedir en un momento con contexto (no al abrir la app), manejar "denegado" (explicar y llevar a Ajustes) y no volver a pedir en bucle.
- Navegación desde push: el payload debe llevar `type` + id (`challengeId`, `postId`, `conversationId`, `spaceId`, `userId`) y la app debe mapearlo a las rutas de `expo-router` existentes (`/challenge/[id]`, `/messaging/[conversationId]`, `/profile/[userId]`, `/invitations`, etc.). Cubre los tres estados: app en foreground, background y cerrada.
- Probar en **dispositivo real** Android e iOS; en simulador iOS no llegan push remotos.
- El tráfico API es HTTP sin TLS: otra razón para no poner datos privados en el texto del push.

---

## 6. Convenciones de pruebas y entorno

- Backend: `npx jest` (Jest 27). Tests con `ts-jest`; para SQL real hay specs de integración **omitidos salvo que definas** `B2_TEST_DB_URL` (ver `account-deletion.integration.spec.ts` y `workout-posts-mosaic.integration.spec.ts`). Úsalos como plantilla; apunta solo a una base desechable.
- Estado de la suite al cerrar B2: 722 pasan; **2 fallos preexistentes** en `workout-posts.service.spec.ts` (moderación desactivada temporalmente, `2026-09-08-02`). No son de B1/B2.
- Si `ioredis` falta en tu `node_modules`: `npm install` en `backend/`.
- Frontend: `npx jest`; 1717 pasan; **1 suite falla de antes**: `app/(tabs)/__tests__/index.test.tsx` (falta el mock de AsyncStorage). Typecheck con `npx tsc --noEmit` tiene errores preexistentes (tests y algunos módulos); compara contra la línea base, no esperes 0.
- Producción de desarrollo: VM `havit-vm` con `docker-compose` **v1** (con guion), el backend corre con `start:dev` dentro del contenedor `havit-backend`, la base es Azure Postgres `pg-havit-dev-01`. El cron de `@nestjs/schedule` ya funciona ahí (la purga de cuentas corrió a las 05:00).
- Herramienta de escaneo: ZAP desde la VM (`ghcr.io/zaproxy/zaproxy:stable`, `--network host`); reportes en `~/zap/` (pendiente copiarlos a `backend/docs/security/zap/`).

---

## 7. Qué sigue abierto y no es de B3 (para que no lo hagas por error ni lo pierdas)

- **HTTPS en la API** (infra). Prioridad alta antes de usuarios reales.
- **Revisión del abogado** de `docs/legal/Havit-Politicas-Legales-BORRADOR.docx` y llenado de `[campos]`; mantener `constants/legal/legalDocs.ts` idéntico y subir `CURRENT_TERMS_VERSION` si cambian. **Si B3 envía notificaciones push, la política de privacidad debe mencionar el tratamiento de tokens de dispositivo y los proveedores (Expo/Firebase/Apple); avisa para actualizarla.**
- Confirmar el plazo de 30 días de eliminación (`ACCOUNT_DELETION_GRACE_DAYS`).
- Pasar `development` → `main` (solo con confirmación del usuario).
- Frontend de B1: recorrer cursores en las listas paginadas.

---

## 8. Sugerencia de orden para B3 (respecto a la lista de la tarea)

1. Decidir tipo de `related_entity_id` y ampliar enum (migración) + seed de `notification_types` + tablas `device_push_tokens` y de preferencias. Actualizar `purgeTables` de la eliminación de cuenta.
2. Módulo backend `notifications`: listar paginado, contador de no leídas, marcar una/todas como leídas, preferencias (GET/PATCH). Tests, incluyendo visibilidad y "no notificarse a sí mismo".
3. Emisores de eventos (§4), con una función central `NotificationsService.notify(...)` que respete preferencias y nunca lance.
4. Pantalla `app/notifications.tsx` real (lista, leído/no leído, navegación a la entidad) + pantalla de preferencias + badge en el header.
5. Push: `expo-notifications`, registro/baja de token (también al cerrar sesión), envío desde el backend con manejo de recibos, permisos y navegación desde el toque.
6. Pruebas en dispositivo real Android/iOS (foreground, background, cerrada) y documentación en `backend/docs/` (formato de `B1-*.md` / `B2-*.md`).
