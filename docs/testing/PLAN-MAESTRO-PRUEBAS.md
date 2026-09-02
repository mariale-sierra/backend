# Plan Maestro de Pruebas — Havit Backend

> Documento vivo, compartido por todo el equipo. Cada integrante extiende la sección de **Plan de Pruebas** y **Resultados** correspondiente a su módulo. No existía documentación de testing previa en este repositorio — este documento se creó desde cero en el Sprint de B2 (Posts/Feed) y queda en `backend/docs/testing/` como ubicación de referencia para el resto de módulos. **Actualizado post-B2**: se cerró el módulo de Followers (con pruebas), se resolvió la decisión de producto pendiente sobre challenges privados (hallazgo F8) y se consolidó en este documento la cobertura real de Badges e Invitaciones, que ya existía en el repo pero nunca se había registrado aquí.

---

## A. Plan Maestro de Pruebas

### Objetivo

Validar que las funcionalidades entregadas en cada sprint de Havit se comportan según lo especificado, antes de integrarlas a `development`, con evidencia real (no solo planificación) de qué se probó, cómo, y con qué resultado.

### Alcance

Este documento cubre el backend (`backend/`, NestJS + PostgreSQL). Cada módulo del backend contribuye su propia sección al Plan de Pruebas (tabla CP). Al momento de escribir esto:

- **Cubierto con pruebas automatizadas reales**: Auth, Challenges (parcial), Workout Log (parcial), Users/Perfil (parcial), **Posts/Feed (B2, completo)**, **Followers (completo)**, **Badges (completo)**, **Challenge Invites (completo)**, **Privacidad de posts en challenges privados / F8 (completo)**, **Chats / Mensajería directa 1:1 (completo a nivel unitario, ver limitaciones)**.
- **Sin pruebas automatizadas todavía**: Uploads (R2), lectura/consulta de un challenge individual y `getProgress`/`getProgressSummary` (CP-03, CP-08), flujos de sistema end-to-end (CP-16, CP-17).
- Frontend, infraestructura (Docker/CI) y pruebas manuales de UI quedan fuera de este documento — pertenecen a los repos `frontend/`/`raiz/` y a la guía manual de cada feature.

### Estrategia

| Nivel | Qué valida | Herramienta |
|---|---|---|
| Unitaria | Un método/función aislado, con dependencias (repos, servicios) mockeadas | Jest + `@nestjs/testing` |
| Funcional | El comportamiento observable de un endpoint/servicio ante una entrada dada (incluye reglas de negocio: visibilidad, moderación, ownership) | Jest, mockeando la capa de persistencia |
| Integración | La colaboración real entre 2+ componentes del backend (ej. `WorkoutLogService` → `WorkoutPostsService`) | Jest, con los colaboradores reales instanciados vía `TestingModule` y solo el repositorio/DB mockeado |
| Sistema | Un flujo de negocio completo cruzando módulos (ej. Challenge → Workout → Foto → Post → Feed) | Pendiente: requiere `*.e2e-spec.ts` contra una base de datos real o de prueba — no implementado todavía en ningún módulo (`test/jest-e2e.json` existe pero no hay specs) |
| Manual | Verificación humana end-to-end contra el backend corriendo (local o Azure) | Guía manual reproducible (ver documento de guía de B2 como referencia de formato) |

### Criterios de prueba

Un caso de prueba (`CP-XX`) se considera **ejecutable** cuando:
1. Tiene una entrada y un resultado esperado sin ambigüedad.
2. No depende de una decisión de producto sin resolver (si depende, se documenta como tal y no se ejecuta como caso de aceptación).
3. Puede evaluarse con las herramientas ya disponibles en el repo (Jest + mocks, o el backend corriendo localmente/Azure).

Un caso se considera **evaluado** solo cuando se ejecutó realmente (`npm run test`, `npx jest <archivo>`, o una request real documentada) y se registró su resultado en la sección de Resultados — nunca por inspección de código únicamente.

### Criterios de aceptación

Una funcionalidad se considera **aprobada** cuando:
- Todos sus CP de prioridad Alta están en estado `Aprobado`.
- La suite completa de Jest pasa (`npm run test`), sin debilitar ni eliminar pruebas existentes.
- `npm run build` no tiene errores.
- El lint dirigido a los archivos del módulo no introduce errores nuevos respecto al baseline del repo.
- No quedan bugs conocidos sin documentar en la sección de Riesgos del módulo.

Los CP de prioridad Media pueden quedar `No ejecutado` para un sprint dado si pertenecen a un módulo que otro integrante todavía no entrega, siempre que quede explícito en la tabla.

---

## B. Plan de Pruebas

### Casos base oficiales (CP-01 – CP-17)

| ID | Funcionalidad | Tipo | Prueba | Condiciones/Entrada | Resultado esperado | Prioridad | Módulo | Cobertura automatizada | Estado (este sprint) |
|---|---|---|---|---|---|---|---|---|---|
| CP-01 | Autenticación | Funcional | Iniciar sesión con credenciales válidas | Usuario registrado y credenciales correctas | El usuario inicia sesión y accede a la aplicación | Alta | Auth | ✅ `src/auth/auth.service.spec.ts` → *"should issue a JWT containing sub/email/username on successful login"* (nivel unitario del service, no HTTP end-to-end) | Ejecutado — Aprobado |
| CP-02 | Autenticación | Funcional | Iniciar sesión con credenciales incorrectas | Contraseña o datos incorrectos | El sistema rechaza el inicio de sesión | Alta | Auth | ✅ `auth.service.spec.ts` → *"should reject login when the email does not exist"*, *"...when the password does not match"* | Ejecutado — Aprobado |
| CP-03 | Challenges | Funcional | Consultar información de un challenge | Challenge existente | Se muestra correctamente la información del challenge | Alta | Challenges | ❌ Sin cobertura — `challenges.service.spec.ts` no tiene ningún test de `findOne`/lectura de challenge | Pendiente — para integrante de Challenges |
| CP-04 | Challenges | Integración | Unirse a un challenge | Usuario autenticado y challenge disponible | El usuario queda registrado como participante | Alta | Challenges | ✅ `challenges.service.spec.ts` → describe `joinChallenge` (4 tests) | Ejecutado — Aprobado |
| CP-05 | Workout | Integración | Registrar un workout | Usuario participando en un challenge | El workout queda registrado correctamente | Alta | Workout Log | ⚠️ Parcial — `workout-log.service.spec.ts` → describe `createWorkout` cubre el guard de "un progreso por día" y que el `userId` viene del JWT, pero no ejercita la creación real de ejercicios/sets desde una rutina | Ejecutado — Aprobado (parcial, ver limitación) |
| CP-06 | Workout Log | Integración | Guardar el progreso de un workout | Workout iniciado | Se almacena correctamente la actividad realizada | Alta | Workout Log | ⚠️ Misma cobertura parcial que CP-05 | Ejecutado — Aprobado (parcial) |
| CP-07 | Progreso | Integración | Subir fotografía como evidencia | Workout realizado e imagen válida | La imagen se almacena y queda asociada al progreso correspondiente | Alta | Uploads | ❌ Sin cobertura — no existe `uploads.service.spec.ts`; el flujo real de subida a R2 no se testea | Pendiente — para integrante de Uploads/Progreso |
| CP-08 | Progreso | Sistema | Actualizar progreso después de completar actividad | Workout y evidencia registrados | El progreso del usuario se actualiza y se muestra en el challenge | Alta | Challenges | ❌ Sin cobertura — `getProgress`/`getProgressSummary` no tienen tests | Pendiente — para integrante de Challenges |
| CP-09 | Posts | Integración | Generar publicación desde el progreso | Workout/progreso registrado | Se genera una publicación asociada correctamente al usuario y actividad | Alta | **Posts (B2)** | ✅ `workout-log.service.spec.ts` → describe *"generating the WorkoutPost (CP-09 / CP-28)"* — **agregado en este sprint**: las pruebas previas mockeaban `workoutPostsService.create` pero nunca verificaban con qué datos se llamaba; ese hueco quedó cerrado (ver sección de bugs/gaps) | Ejecutado — Aprobado |
| CP-10 | Feed | Funcional | Consultar publicaciones | Usuario autenticado y posts existentes | Se muestran las publicaciones correspondientes | Alta | **Feed (B2)** | ✅ `workout-posts.service.spec.ts` (describe `getFeed`, 10 tests) + `feed.controller.spec.ts` (7 tests) | Ejecutado — Aprobado |
| CP-11 | Perfil | Funcional | Consultar perfil propio | Usuario autenticado | Se muestran información, estadísticas, progreso y publicaciones | Media | Users | ⚠️ Parcial — `users.service.spec.ts` → describe `getMyProfile` cubre datos de perfil; no cubre "estadísticas/progreso/publicaciones" agregadas en un solo response (ese agregado no existe como endpoint único hoy) | Ejecutado — Aprobado (alcance parcial) |
| CP-12 | Perfil | Funcional | Consultar perfil de otro usuario | Usuario existente | Se muestra únicamente la información disponible de ese usuario | Media | Users | ✅ `users.service.spec.ts` → describe `getPublicProfile` (3 tests: perfil privado oculta bio, perfil público expone bio, nunca expone email) | Ejecutado — Aprobado |
| CP-13 | Followers | Integración | Seguir a otro usuario | Dos usuarios diferentes | Se crea correctamente la relación de seguimiento; si ya existía una relación inactiva (unfollow previo), se reactiva en vez de duplicar; una carrera de duplicado a nivel DB (23505) se traduce a 409, no a 500 | Media | Followers | ✅ `follows.service.spec.ts` → describe `follow` (6 tests); `follows.controller.spec.ts` → *"should follow a user on behalf of the authenticated caller, never the path param as the follower"* | Ejecutado — Aprobado |
| CP-14 | Followers | Integración | Dejar de seguir a un usuario | Relación de seguimiento existente | Se marca `is_active = false` (soft-delete, no se borra la fila); `404` si no había relación activa | Media | Followers | ✅ `follows.service.spec.ts` → describe `unfollow` (2 tests); `follows.controller.spec.ts` → *"should unfollow a user on behalf of the authenticated caller"* | Ejecutado — Aprobado |
| CP-15 | Followers | Funcional | Intentar seguirse a sí mismo | Usuario intenta seguir su propio perfil | El sistema rechaza la operación con `400 BadRequestException`, sin tocar la base de datos | Media | Followers | ✅ `follows.service.spec.ts` → *"should reject following yourself before hitting the database"* (verifica además que `userRepo.findOne` nunca se llama) | Ejecutado — Aprobado |
| CP-16 | Sistema | Sistema | Validar flujo completo de progreso | Challenge → Workout → Foto → Post | Todo el progreso queda registrado y visible correctamente | Alta | Cruza módulos | ❌ Sin cobertura automatizada — no existe ningún `*.e2e-spec.ts` en el repo (`test/jest-e2e.json` existe pero sin specs) | Pendiente — requiere entorno con DB real; ver guía manual de B2 como verificación parcial del tramo Post→Feed |
| CP-17 | Sistema | Sistema | Validar flujo social de una publicación | Post → Perfil → Feed | La publicación aparece correctamente en los diferentes módulos | Alta | Cruza módulos (Perfil pendiente) | ❌ Sin cobertura automatizada, y depende parcialmente de Perfil/Followers (no implementados) | Pendiente — bloqueado en parte por Followers/Perfil Social |

### Casos agregados para B2 — Posts/Feed (CP-18 en adelante)

Justificación general: CP-09 y CP-10 son los únicos casos base que tocan Posts/Feed, pero son demasiado amplios para capturar las reglas de negocio específicas que la Fase 3 (auditoría) confirmó como críticas — visibilidad, moderación, paginación y los límites exactos de "posts por usuario". Los siguientes casos agrupan comportamientos relacionados (no hay un CP por cada `assert` individual).

| ID | Funcionalidad | Tipo | Prueba | Condiciones/Entrada | Resultado esperado | Prioridad | Cobertura automatizada | Estado |
|---|---|---|---|---|---|---|---|---|
| CP-18 | Feed | Funcional | Regla de visibilidad y moderación del Feed | Posts con las 4 combinaciones de `visibility` × las variantes de `moderation_status` | Solo aparecen posts `visibility='public' AND moderation_status='approved'`; ninguna combinación con `private`, `followers`, `pending` o `rejected` aparece, sin excepción para el propio autor, y el filtro nunca se degrada silenciosamente | Alta | `workout-posts.service.spec.ts` → *"should filter unconditionally on visibility='public' AND moderation_status='approved'"*, *"should never bypass moderation/visibility for the post owner"* | Ejecutado — Aprobado |
| CP-19 | Feed | Funcional | Contrato de respuesta y orden | `GET /feed` con posts existentes | El body es exactamente `FeedPostContract[]` (array plano, snake_case, sin `visibility`/`moderation_status` expuestos), ordenado `created_at DESC, id DESC`, sin `likes_count`/`activity_type` poblados | Alta | `workout-posts.service.spec.ts` → *"should map rows to the exact FeedPostContract field names"*, *"should never populate activity_type"*; `feed.controller.spec.ts` → *"should return the plain posts array, not an envelope"* | Ejecutado — Aprobado |
| CP-20 | Posts por usuario | Integración | Consultar mis propias publicaciones | `userId` de la ruta === usuario autenticado | Mismo comportamiento que `/workout-posts/mine` (todas las visibilidades/moderación propias), ahora paginado | Alta | `workout-posts.service.spec.ts` → *"self-view: should use the owner-bypass filter, matching /mine"* | Ejecutado — Aprobado |
| CP-21 | Posts por usuario | Integración | Consultar publicaciones públicas de otro usuario | `userId` de la ruta ≠ usuario autenticado | Solo devuelve `visibility='public' AND moderation_status='approved'` de ese usuario, sin bypass posible, sin depender de Followers ni de `is_private` | Alta | `workout-posts.service.spec.ts` → *"other-view: should require visibility='public' AND moderation_status='approved' unconditionally, with no owner bypass"*, *"...the visibility/moderation predicate is static regardless of cursor/limit input"* | Ejecutado — Aprobado |
| CP-22 | Posts por usuario | Funcional | Usuario inexistente o inactivo | UUID válido pero sin usuario activo asociado | `404 NotFoundException('User not found')` | Media | `workout-posts.service.spec.ts` → *"should throw NotFoundException when the target user does not exist or is inactive"*, *"should only look up active users"* | Ejecutado — Aprobado |
| CP-23 | Posts por usuario | Funcional | Usuario válido sin publicaciones | Usuario existente, cero posts | `200 OK` con `[]`, sin header `X-Next-Cursor` | Media | `workout-posts.service.spec.ts` → *"should return [] for an existing user with no posts"* | Ejecutado — Aprobado |
| CP-24 | Paginación | Unitaria | Cursor opaco — codificación/decodificación | `created_at` + `id` (numérico y UUID) | Round-trip exacto; `id` nunca se interpreta como número; fecha normalizada a ISO-8601 canónico | Alta | `pagination.util.spec.ts` → describe `encodeCursor / decodeCursor round-trip` (4 tests) + `decodeCursor — normalization` | Ejecutado — Aprobado |
| CP-25 | Paginación | Funcional | Cursor inválido | Base64 corrupto, JSON incompleto, campo faltante, `id` vacío, fecha no parseable, payload no-objeto | `400 BadRequestException('cursor inválido')` en todos los casos, sin excepción no controlada | Alta | `pagination.util.spec.ts` → describe `decodeCursor — hostile input` (10 casos vía `it.each` + 2 adicionales) | Ejecutado — Aprobado |
| CP-26 | Paginación | Funcional | Límites de `limit` | `limit` en los bordes válidos (no probado contra HTTP real, ver limitación) | `limit=1` y `limit=50` son válidos; `0`, `51` y no-enteros son rechazados por el `ValidationPipe` global | Media | ⚠️ No hay test directo del `ValidationPipe` en este sprint — el comportamiento se apoya en decoradores (`@IsInt`, `@Min(1)`, `@Max(50)`) ya usados y probados en otros DTOs de este mismo repo, no se duplicó ese test | No ejecutado — cubierto por diseño/precedente, no por un test nuevo (ver limitación) |
| CP-27 | Paginación | Integración | Patrón `LIMIT limit+1` y `X-Next-Cursor` | Página intermedia vs. última página | Con más filas que `limit`, se recorta a `limit` y se genera `nextCursor` desde la última fila realmente devuelta (no la de lookahead); con exactamente `limit` o menos filas, no hay `nextCursor` y no se setea el header | Alta | `workout-posts.service.spec.ts` → *"should request limit+1 rows..."*, *"should not return a next cursor on the last page"*, *"should build the next cursor from the last row actually returned..."*; `feed.controller.spec.ts`/`workout-posts.controller.spec.ts` → *"should set/not set X-Next-Cursor..."* | Ejecutado — Aprobado |
| CP-28 | Posts | Integración | Visibilidad `public` se propaga end-to-end | `POST /workout-logs/progress` (o `/challenges/progress`) con `visibility: 'public'` | El `WorkoutPost` generado recibe `visibility: 'public'` (y por defecto `'private'` si se omite); posts en día de descanso no generan post | Alta | `workout-log.service.spec.ts` → describe *"generating the WorkoutPost (CP-09 / CP-28)"* (3 tests, agregados en este sprint) | Ejecutado — Aprobado |

**Limitaciones explícitas de esta batería** (para que quien la lea no la sobre-interprete):
- Todo lo anterior es **prueba unitaria/de integración con mocks** (repos y `DataSource` mockeados, sin PostgreSQL real) — no reemplaza una verificación contra la base de datos real de Azure, que no estuvo disponible en ningún momento de las Fases 1–4 de B2.
- CP-26 no tiene un test de Jest dedicado en este sprint porque el comportamiento de `@Min`/`@Max`/`@IsInt` del `ValidationPipe` global ya es un patrón probado por el propio framework y usado sin tests dedicados en otros DTOs de este repo; se verifica manualmente en la guía (sección de Errores).
- Los índices SQL (`idx_workout_posts_public_feed`, `idx_workout_posts_user_timeline`) y las migraciones no tienen prueba automatizada — no es posible probarlos sin una instancia real de Postgres. Quedan validados solo estáticamente (Fase 3).

### Casos agregados — Resolución de F8, privacidad de challenges privados (CP-29 en adelante)

Justificación: la sección **"Caso pendiente de decisión de producto"** (más abajo) documentaba el hallazgo F8 como bloqueado a la espera de una decisión de producto. Esa decisión ya se tomó (ver esa misma sección para el texto completo de la respuesta) y se implementó en dos capas, tal como se pidió: validación en escritura y filtro en lectura como segunda capa de defensa, aplicado de forma consistente a todos los endpoints que exponen posts.

| ID | Funcionalidad | Tipo | Prueba | Condiciones/Entrada | Resultado esperado | Prioridad | Cobertura automatizada | Estado |
|---|---|---|---|---|---|---|---|---|
| CP-29 | Posts | Funcional | Un post no puede volverse público global desde un challenge privado (escritura) | `POST /workout-logs/progress` con `visibility: 'public'` sobre un challenge cuyo `visibility = 'private'` | El `WorkoutPost` se guarda con `visibility: 'private'` (downgrade automático y silencioso, no se rechaza el envío completo del progreso); si el challenge es público, se respeta `'public'`; si no se pide `'public'` o el workout no tiene `challengeId`, no se consulta el challenge | Alta | `workout-log.service.spec.ts` → describe *"downgrading visibility for private-challenge posts (CP-29)"* (4 tests) | Ejecutado — Aprobado |
| CP-30 | Feed | Funcional | Un post de un challenge privado nunca aparece en el Feed global (lectura, sin excepción) | Post `visibility='public'` + `moderation_status='approved'` cuyo challenge es `private` | El post no aparece en `GET /feed`, sin excepción — ni para el propio autor, ni para miembros del challenge (el Feed no tiene contexto de viewer para hacer esa excepción) | Alta | `workout-posts.service.spec.ts` → *"should exclude posts whose challenge is private, unconditionally (CP-30)"* | Ejecutado — Aprobado |
| CP-31 | Posts por usuario | Funcional | Un post de un challenge privado no se filtra por el perfil de otro usuario, salvo para miembros del challenge | `GET /workout-posts/user/:userId` con `userId` ≠ viewer, post `visibility='public'` cuyo challenge es `private` | El post no aparece para un viewer que no es miembro del challenge (ni siquiera si el post en sí es `'public'`); si el viewer es miembro activo del challenge (`challenge_user_map`), o es el propio autor, sí lo ve | Alta | `workout-posts.service.spec.ts` → *"other-view: should exclude posts from a private challenge unless the viewer is a member (CP-31)"* | Ejecutado — Aprobado |

**Notas de implementación (para que la tabla sea trazable al código):**
- Escritura: `WorkoutLogService.resolvePostVisibility()` en [workout-log.service.ts](../../src/workout-log/workout-log.service.ts) — se ejecuta dentro de `createWorkout()`, antes de llamar a `WorkoutPostsService.create()`.
- Lectura: `WorkoutPostsService.challengePrivacyFilter()` en [workout-posts.service.ts](../../src/workout-posts/workout-posts.service.ts) — reutilizado por `getFeed()`, `getUserPosts()` (vía `fetchPaginatedPhotos()`) y `getChallengePhotos()`/`getUserPhotos()` (vía `fetchPhotos()`), para que la regla no dependa de qué endpoint la lea.
- El filtro de lectura es intencionalmente redundante con el de escritura: cubre posts creados antes de este fix y el caso en que un challenge se vuelve privado después de que ya existían posts públicos asociados.
- **Gap conocido, fuera de alcance de este cierre**: `WorkoutPostsService.findMosaicByChallenge()` (`GET /workout-posts/mosaic`) no aplica ningún filtro de `visibility` (ni siquiera el básico `'public'`/`'private'` de un post, mucho menos el de challenge) — es un problema preexistente y más amplio que F8, no cubierto aquí. Se recomienda una revisión aparte.
- **Gap conocido, fuera de alcance de este cierre**: no existe ningún guard de membresía en `GET /challenges/:id` — cualquier usuario autenticado puede leer los metadatos de un challenge privado si conoce su ID, independientemente de este fix (que solo protege *posts*, no el propio challenge). Se recomienda una revisión aparte de autorización en `ChallengesController`.

### Casos agregados — Badges y Challenge Invites (CP-32 en adelante)

Estos dos módulos ya tenían pruebas reales en el repo (`badges.service.spec.ts`, `challenge-invites.service.spec.ts`) pero nunca se habían registrado en este documento porque se escribieron fuera del ciclo de B2. Se consolidan aquí para que la tabla de CP refleje el estado real del repositorio, no solo lo entregado en el sprint de Posts/Feed.

| ID | Funcionalidad | Tipo | Prueba | Condiciones/Entrada | Resultado esperado | Prioridad | Cobertura automatizada | Estado |
|---|---|---|---|---|---|---|---|---|
| CP-32 | Badges | Funcional | Cálculo de badges de actividad al vuelo | Historial de workouts/challenges del usuario | Badges de conteo de workouts y de challenges completados marcados correctamente ganados/no ganados según umbral, con progreso capado al objetivo; racha (`streak`) calculada desde días consecutivos completados hasta hoy, tolerando que el día de hoy aún no tenga workout registrado | Media | `badges.service.spec.ts` → describe `getMyBadges` (5 tests) | Ejecutado — Aprobado |
| CP-33 | Badges | Funcional | Badges de otro usuario respetan privacidad de perfil | `GET` badges de `userId` ajeno, perfil público/privado, viewer seguidor/no seguidor/dueño | Perfil público: lista completa sin chequear seguidores; perfil privado: `[]` si el viewer no sigue activamente, lista completa si sí sigue o si el viewer es el dueño | Media | `badges.service.spec.ts` → describe `getUserBadges` (5 tests) | Ejecutado — Aprobado |
| CP-34 | Challenge Invites | Integración | Crear invitación a un challenge | Emisor es creador o miembro activo del challenge, destinatario válido y no miembro | Se crea invitación `pending`; se rechaza auto-invitación, challenge inexistente, destinatario inexistente/inactivo, emisor sin permiso, destinatario ya miembro activo, invitación pendiente duplicada; carrera de índice único (23505) se traduce a 409 | Alta | `challenge-invites.service.spec.ts` → describe `create` (8 tests) | Ejecutado — Aprobado |
| CP-35 | Challenge Invites | Integración | Aceptar/rechazar/cancelar invitación | Invitación `pending` existente | Aceptar agrega la membresía y marca la invitación en una sola transacción (reactivando membresía inactiva si existía); solo el destinatario puede aceptar/rechazar, solo el emisor puede cancelar; se rechaza aceptar una invitación ya procesada, expirada, o inexistente | Alta | `challenge-invites.service.spec.ts` → describe `accept` (6 tests), `decline` (3 tests), `cancel` (3 tests) | Ejecutado — Aprobado |
| CP-36 | Challenge Invites | Funcional | Listar invitaciones | Usuario con invitaciones enviadas/recibidas | `listPendingReceived`/listados de enviadas y recibidas están correctamente delimitados por `sender`/`recipient`, y el de pendientes solo devuelve `status='pending'` | Media | `challenge-invites.service.spec.ts` → describe `listing` (3 tests) | Ejecutado — Aprobado |

### Casos agregados — Chats / Mensajería directa 1:1 (CP-37 en adelante)

Justificación: nuevo módulo (`src/chats/`), sin CP base previo. Usa las tablas `direct_conversations`/`direct_conversation_members`/`direct_messages`, ya definidas en el init-schema (sección "9. MENSAJERÍA PRIVADA") pero sin ningún módulo del backend leyéndolas o escribiéndolas hasta ahora; se agregó únicamente `read_at` vía migración aditiva (`2026-09-01-01-add-direct-messages-read-status.sql`).

| ID | Funcionalidad | Tipo | Prueba | Condiciones/Entrada | Resultado esperado | Prioridad | Cobertura automatizada | Estado |
|---|---|---|---|---|---|---|---|---|
| CP-37 | Chats | Integración | Iniciar o reabrir una conversación 1:1 | Dos usuarios válidos y activos | Si no existe conversación entre ambos, se crea con exactamente los dos participantes; si ya existe, se reutiliza en vez de duplicarla | Alta | `chats.service.spec.ts` → describe `findOrCreateDirectConversation` (2 de 4 tests) | Ejecutado — Aprobado |
| CP-38 | Chats | Funcional | Rechazar conversación inválida | `recipientUserId` = el propio usuario, o un usuario inexistente/inactivo | `400 BadRequestException` al intentar conversar consigo mismo (sin consultar la base de datos); `404 NotFoundException` si el destinatario no existe o está inactivo | Alta | mismo describe (2 de 4 tests) | Ejecutado — Aprobado |
| CP-39 | Chats | Funcional | Listar mis conversaciones | Usuario con 0, 1 o varias conversaciones | `[]` sin conversaciones; ordenadas por actividad más reciente (último mensaje, no la fecha de creación de la conversación); una conversación cuyo otro participante ya no existe (cuenta eliminada) se omite en silencio en vez de romper el listado completo | Alta | `chats.service.spec.ts` → describe `listConversations` (3 tests) | Ejecutado — Aprobado |
| CP-40 | Chats | Funcional | Control de acceso a una conversación ajena | Usuario que no es participante intenta listar/enviar mensajes o marcar como leída una conversación | `404 NotFoundException` en los tres casos — mismo código que "conversación inexistente", para no revelarle a alguien fuera de la conversación que el id sí existe | Alta | describe `listMessages`/`sendMessage`/`markConversationRead` (1 test de acceso por método) | Ejecutado — Aprobado |
| CP-41 | Chats | Funcional | Paginación de mensajes | Conversación con más mensajes que el `limit` pedido | Mensajes en orden cronológico (más antiguo primero), recortados a `limit`, con `nextBefore` apuntando al id más antiguo de la página cuando hay más filas; `nextBefore = null` en la última página | Alta | describe `listMessages` (2 tests) | Ejecutado — Aprobado |
| CP-42 | Chats | Funcional | Marcar conversación como leída | Conversación con mensajes propios y del otro participante | Solo se actualizan los mensajes del OTRO participante (`user_id != caller`); los propios nunca se tocan | Media | describe `markConversationRead` (1 test, verifica la cláusula `andWhere('user_id != :userId', ...)`) | Ejecutado — Aprobado |
| CP-43 | Chats | Funcional | Enviar un mensaje | Usuario participante envía contenido válido | El mensaje se persiste asociado al remitente y a la conversación correctos | Alta | describe `sendMessage` (2 tests) | Ejecutado — Aprobado |

**Riesgos y decisiones explícitamente NO tomadas en este cierre** (para que no se confundan con omisiones):
- **Edición y borrado de mensajes**: no implementados. La tabla `direct_messages` ya trae una columna `is_active` (aparentemente pensada para soft-delete), pero ningún endpoint la expone ni la modifica — se deja en `true` siempre. Requiere una decisión de producto antes de implementarse (¿quién puede borrar/editar, hay ventana de tiempo, se notifica al otro participante?).
- **Moderación de contenido**: `ChatsService.sendMessage()` no llama a ningún servicio de moderación. La Moderation API que construye Esteban (Bloque 4) no existe todavía en este repositorio (sin rama ni PR al momento de este cierre), así que no había contrato con el que integrar sin arriesgarse a duplicar lógica de validación. El punto de integración queda documentado como comentario directamente sobre `sendMessage()` en [chats.service.ts](../../src/chats/chats.service.ts).
- **Grupal / Spaces**: fuera de alcance de este módulo. El esquema de `direct_conversation_members` (tabla intermedia participante↔conversación) se eligió deliberadamente compatible con una futura extensión grupal, pero el grupal real vive en las tablas `spaces`/`space_members`/`space_messages`, ya existentes mas no tocadas aquí.
- **Migración no ejecutada contra la base real**: igual que el resto de este documento (ver limitaciones de la batería B2), esta sesión no tuvo credenciales de la base de datos de Azure disponibles — `2026-09-01-01-add-direct-messages-read-status.sql` no se corrió contra ningún Postgres real, solo se validó por lectura (SQL aditivo con `IF NOT EXISTS`, mismo patrón que las migraciones previas del repo). Se aplicará automáticamente en el próximo `npm run db:migrate` (arranque de contenedor o `docker compose up`).
- **Condición de carrera de baja probabilidad**: dos solicitudes simultáneas de "iniciar conversación" entre el mismo par de usuarios, la primera vez que se escriben, podrían en teoría crear dos conversaciones en vez de reutilizar una — documentado como limitación aceptada en el propio doc-comment de `findOrCreateDirectConversation()`, no cubierto por un test (requeriría un test de concurrencia real, no de mocks).

### Casos agregados — Spaces (CP-44 en adelante)

Justificación: nuevo módulo (`src/spaces/`), sin CP base previo. El init-schema ya traía `spaces`/`space_members` completos (sección "8. SPACES / CHATS GRUPALES") pero sin ningún módulo leyéndolos ni escribiéndolos hasta ahora — ver la nota de CP-37/`direct_conversation_members` arriba, que scopeaba deliberadamente el grupal fuera de Chats. Se agregó `activity_category_id` (FK a `exercise_categories`, reutilizando la taxonomía de challenges para el picker de "Activity Color" del wireframe 47C) y la tabla `space_join_requests` (flujo de solicitud/aprobación para spaces privados, wireframes 47C/47E) vía `2026-09-02-01-spaces-join-requests-and-activity-category.sql`. `space_messages` (mensajería dentro de un space, wireframe 47B) queda explícitamente fuera de este cierre — ver Pendientes/Bloqueos en el reporte de entrega.

| ID | Funcionalidad | Tipo | Prueba | Condiciones/Entrada | Resultado esperado | Prioridad | Cobertura automatizada | Estado |
|---|---|---|---|---|---|---|---|---|
| CP-44 | Spaces | Integración | Crear space | Usuario autenticado, payload válido | Se crea el space y, en la misma transacción, se agrega al usuario como miembro activo con rol `owner`; una `activityCategoryId` inexistente se rechaza antes de abrir la transacción | Alta | `spaces.service.spec.ts` → describe `create` (2 tests) | Ejecutado — Aprobado |
| CP-45 | Spaces | Funcional | Consultar spaces | Space público/privado, viewer miembro/no miembro/con solicitud pendiente | `GET /spaces`/`GET /spaces/:id` anotan `isMember`, `role` y `hasPendingRequest` correctamente para el usuario autenticado; space inexistente o inactivo devuelve 404 | Alta | describe `findOne` (4 tests) | Ejecutado — Aprobado |
| CP-46 | Spaces | Funcional | Editar/eliminar space — permisos | Usuario que no es el owner intenta editar o eliminar | `403 ForbiddenException` en ambos casos; el owner sí puede editar campos parciales y eliminar (soft delete vía `is_active = false`) | Alta | describe `update / remove — ownership` (3 tests) | Ejecutado — Aprobado |
| CP-47 | Spaces | Integración | Unirse a un space | Space público vs. privado, usuario sin relación previa | Público: ingreso instantáneo (`status: 'joined'`, fila activa en `space_members` con rol `member`); privado: crea una solicitud `pending` en `space_join_requests` (`status: 'requested'`), sin tocar `space_members` | Alta | describe `join` (5 tests) | Ejecutado — Aprobado |
| CP-48 | Spaces | Funcional | Unión/solicitud duplicada | Usuario ya miembro activo intenta unirse de nuevo; usuario con solicitud pendiente vuelve a solicitar | `409 ConflictException` en ambos casos, sin insertar una segunda fila (respaldado a nivel de BD por el índice único parcial `uq_space_join_request_pending`, mismo patrón que `uq_challenge_invite_pending`) | Alta | mismo describe `join` (parte de los 5 tests) | Ejecutado — Aprobado |
| CP-49 | Spaces | Funcional | Salir de un space | Miembro regular vs. owner | Un miembro regular puede salir (desactiva su membresía); el owner NO puede salir (`409 ConflictException`, debe eliminar el space en su lugar); usuario sin membresía activa recibe 404 | Alta | describe `leave` (3 tests) | Ejecutado — Aprobado |
| CP-50 | Spaces | Funcional | Participantes de un space | Space existente con miembros activos | Devuelve solo miembros activos con datos públicos (id/username/displayName/profileImageUrl/role/joinedAt), nunca el `User` completo; space inexistente devuelve 404 | Media | describe `listMembers` (2 tests) | Ejecutado — Aprobado |
| CP-51 | Spaces | Integración | Solicitudes de ingreso — listar y responder | Owner vs. no-owner; solicitud pendiente vs. ya procesada | Solo el owner puede listar (`403` para cualquier otro) y responder; aprobar agrega/reactiva la membresía (rol `member`) en la misma transacción que marca la solicitud `approved`; rechazar marca `rejected` sin tocar `space_members`; responder una solicitud ya procesada devuelve `409`; solicitud inexistente devuelve `404` | Alta | describe `listJoinRequests` (2 tests) y `respondToJoinRequest` (6 tests) | Ejecutado — Aprobado |
| CP-52 | Spaces | Funcional | Delegación del controller | Cada endpoint de `SpacesController` | Cada acción usa `user.sub` (JWT) como actor — nunca un campo del body/param — mismo patrón verificado en `chats.controller.spec.ts`/`follows.controller.spec.ts`; `listMembers` no requiere el usuario autenticado como argumento (el chequeo de owner vive en las acciones que sí lo requieren) | Media | `spaces.controller.spec.ts` (12/12 tests) | Ejecutado — Aprobado |

**Resultados de ejecución:**

| Casos | Archivo / comando | Resultado | Estado | Evidencia |
|---|---|---|---|---|
| CP-44 – CP-51 | `spaces.service.spec.ts` | `npx jest src/spaces/spaces.service.spec.ts` | 26/26 tests pasan | Aprobado | Cubre create/findAll/findOne/update/remove/join/leave/listMembers/listJoinRequests/respondToJoinRequest |
| CP-52 | `spaces.controller.spec.ts` | `npx jest src/spaces/spaces.controller.spec.ts` | 12/12 tests pasan | Aprobado | Verifica delegación con `user.sub` en cada acción |
| Lint dirigido | `eslint src/spaces` | `npx eslint "src/spaces/**/*.ts"` | Sin errores ni warnings | Aprobado | — |
| Build completo | `nest build` | `npm run build` | Sin errores | Aprobado | — |
| Suite completa (con Spaces) | Todos los tests del backend | `npm run test` | **28 suites, 387 tests — todos pasan** (349 previos + 38 nuevos de Spaces) | Aprobado | Ver salida completa del comando |

**No ejecutado en esta sesión** (mismo motivo que Chats — sin `.env`/credenciales de la base de datos de Azure en este sandbox):
- Aplicar `2026-09-02-01-spaces-join-requests-and-activity-category.sql` con `npm run db:migrate` contra la base real.
- Cualquier prueba de integración/sistema end-to-end (`POST /spaces`, `POST /spaces/:id/join`, etc. contra un servidor real) — mismo gap ya documentado para Chats/CP-16/CP-17.

**Riesgos y decisiones explícitamente NO tomadas en este cierre:**
- **Mensajería dentro de un space** (`space_messages`, wireframe 47B "Space thread"): fuera de alcance — no está en la lista de funcionalidades del Sprint 8 para este bloque (crear/consultar/ingresar/participantes) y su UI vive en los wireframes numerados "Chats-4xx". Ver Pendientes/Bloqueos.
- **Rol `admin`**: el enum `space_member_role_enum` ya soporta `owner`/`admin`/`member`, pero ningún wireframe de este cierre muestra una acción para promover a un miembro a `admin` ni permisos diferenciados para ese rol — solo `owner` tiene acciones de gestión en este cierre.
- **Límite máximo de participantes**: no hay ninguna regla de negocio definida (ni en el Sprint 8 ni en los wireframes) — no se agregó ningún constraint que lo simule.

---

## C. Resultados de pruebas ejecutadas

La primera tabla corresponde al Sprint B2 (Posts/Feed) original — comandos ejecutados contra el checkpoint `dfe47cb`. La segunda tabla ("Actualización post-B2") corresponde a esta sesión: cierre de Followers, resolución de F8 y consolidación de Badges/Invitaciones. En ambos casos, todas las filas son comandos **realmente ejecutados**; ningún resultado fue inferido por lectura de código.

### C.1 — Sprint B2 (Posts/Feed)

| Caso | Prueba ejecutada | Comando | Resultado obtenido | Estado | Evidencia |
|---|---|---|---|---|---|
| CP-01, CP-02 | Suite de Auth | `npm run test` | 5/5 tests de `auth.service.spec.ts` pasan | Aprobado | Ver salida de Jest, sección Verificación |
| CP-04 | Suite de Challenges (join) | `npm run test` | 4/4 tests de `joinChallenge` pasan | Aprobado | Ídem |
| CP-05, CP-06 | Suite de Workout Log (creación) | `npm run test` | 2/2 tests preexistentes de `createWorkout` pasan | Aprobado (parcial) | Ídem |
| CP-09 | `workout-log.service.spec.ts` → *"generating the WorkoutPost"* | `npx jest src/workout-log/workout-log.service.spec.ts` | 3/3 tests nuevos pasan | Aprobado | `✓ should call workoutPostsService.create with the submitted image, caption and visibility` |
| CP-10, CP-18, CP-19, CP-27 | `workout-posts.service.spec.ts` (`getFeed`) + `feed.controller.spec.ts` | `npx jest src/workout-posts/` | 10/10 + 7/7 tests pasan | Aprobado | Ver salida completa, sección Verificación |
| CP-11, CP-12 | Suite de Users/Perfil | `npm run test` | 15/15 tests de `users.service.spec.ts` pasan | Aprobado | Ídem |
| CP-13, CP-14, CP-15 | — | — | No existía código ni test que ejecutar en B2 | No ejecutado (B2) — ver C.2 | Cerrado en la actualización post-B2 |
| CP-16, CP-17 | — | — | No existe `*.e2e-spec.ts` | No ejecutado | N/A — pendiente de infraestructura de e2e |
| CP-20, CP-21, CP-22, CP-23 | `workout-posts.service.spec.ts` (`getUserPosts`) + `workout-posts.controller.spec.ts` | `npx jest src/workout-posts/` | 7/7 + 6/6 tests pasan | Aprobado | Ídem |
| CP-24, CP-25 | `pagination.util.spec.ts` | `npx jest src/workout-posts/pagination.util.spec.ts` | 18/18 tests pasan | Aprobado | Ídem |
| CP-26 | — | Verificado por diseño (decoradores `class-validator`), no por test dedicado | — | No ejecutado (ver limitación) | — |
| CP-28 | `workout-log.service.spec.ts` → *"generating the WorkoutPost"* | `npx jest src/workout-log/workout-log.service.spec.ts` | 3/3 (mismos tests que CP-09) | Aprobado | Ídem |
| Suite completa (checkpoint B2) | Todos los tests del backend | `npm run test` | 15 suites, 145 tests — todos pasan | Aprobado | Ver salida completa, sección Verificación |

### C.2 — Actualización post-B2 (Followers, F8, Badges, Invites)

| Caso | Prueba ejecutada | Comando | Resultado obtenido | Estado | Evidencia |
|---|---|---|---|---|---|
| CP-13, CP-14, CP-15 | `follows.service.spec.ts` + `follows.controller.spec.ts` | `npx jest src/follows/` | 14/14 + 4/4 tests pasan | Aprobado | `follow` (6), `unfollow` (2), `listFollowers/listFollowing` (2), `getCounts` (1), `isActiveFollower` (2) + 4 tests de controller |
| CP-29 | `workout-log.service.spec.ts` → *"downgrading visibility for private-challenge posts (CP-29)"* | `npx jest src/workout-log/workout-log.service.spec.ts` | 4/4 tests nuevos pasan | Aprobado | `✓ should downgrade visibility to 'private' when requesting 'public' on a private challenge`, `✓ should keep 'public' when the challenge is public`, `✓ should not downgrade or query the challenge when the requested visibility is not public`, `✓ should not query the challenge when the workout has no challengeId` |
| CP-30 | `workout-posts.service.spec.ts` → *"should exclude posts whose challenge is private, unconditionally (CP-30)"* | `npx jest src/workout-posts/workout-posts.service.spec.ts` | 1/1 test nuevo pasa | Aprobado | Verifica que la SQL de `getFeed()` contiene `c.visibility != 'private'` |
| CP-31 | `workout-posts.service.spec.ts` → *"other-view: should exclude posts from a private challenge unless the viewer is a member (CP-31)"* | `npx jest src/workout-posts/workout-posts.service.spec.ts` | 1/1 test nuevo pasa | Aprobado | Verifica el `EXISTS` contra `challenge_user_map cum_viewer` en la SQL de `getUserPosts()` |
| CP-32, CP-33 | `badges.service.spec.ts` | `npx jest src/badges/` | 10/10 tests pasan | Aprobado | `getMyBadges` (5), `getUserBadges` (5) |
| CP-34, CP-35, CP-36 | `challenge-invites.service.spec.ts` | `npx jest src/challenge-invites/` | 23/23 tests pasan | Aprobado | `create` (8), `accept` (6), `decline` (3), `cancel` (3), `listing` (3) |
| Suite completa (actual) | `npm run build` + Todos los tests del backend | `npm run build && npm run test` | Build sin errores. **18 suites, 190 tests — todos pasan** | Aprobado | Ver salida completa, sección Verificación |

**Nota sobre pruebas modificadas (no solo agregadas):** dos pruebas preexistentes de `workout-posts.service.spec.ts` (`getUserPosts`, casos "no owner bypass") afirmaban que la SQL de un viewer no-dueño nunca contenía el fragmento `OR p.user_id`. El nuevo filtro de CP-31 introduce legítimamente ese fragmento (para que el propio autor nunca se oculte su post a sí mismo), así que esa aserción genérica dejó de ser válida como estaba escrita. Se reemplazó por dos aserciones más específicas (`not.toContain('moderation_status = ANY')` y `not.toContain("p.visibility != 'private'")`) que siguen probando lo que realmente importaba (que no vuelve el bypass de moderación/visibilidad del dueño), sin quedar acopladas a un fragmento de SQL que ahora tiene un motivo legítimo para existir. Ninguna prueba se debilitó ni se eliminó — se corrigió una aserción que había quedado demasiado amplia.

### C.3 — Chats / Mensajería directa 1:1

| Caso | Prueba ejecutada | Comando | Resultado obtenido | Estado | Evidencia |
|---|---|---|---|---|---|
| CP-37, CP-38 | `chats.service.spec.ts` → describe `findOrCreateDirectConversation` | `npx jest src/chats/chats.service.spec.ts` | 4/4 tests pasan | Aprobado | `✓ should reject starting a conversation with yourself...`, `✓ should throw NotFoundException when the recipient does not exist...`, `✓ should create a new conversation with exactly the two participants...`, `✓ should return the existing conversation instead of creating a duplicate` |
| CP-39 | `chats.service.spec.ts` → describe `listConversations` | `npx jest src/chats/chats.service.spec.ts` | 3/3 tests pasan | Aprobado | `✓ should return an empty array...`, `✓ should sort conversations by most recent activity...`, `✓ should silently skip a conversation whose other participant no longer exists` |
| CP-40, CP-41 | `chats.service.spec.ts` → describe `listMessages` | `npx jest src/chats/chats.service.spec.ts` | 3/3 tests pasan | Aprobado | `✓ should throw NotFoundException when the caller is not a participant`, `✓ should return messages oldest-first and a nextBefore cursor...`, `✓ should return nextBefore null on the last page` |
| CP-40, CP-43 | `chats.service.spec.ts` → describe `sendMessage` | `npx jest src/chats/chats.service.spec.ts` | 2/2 tests pasan | Aprobado | `✓ should throw NotFoundException when the caller is not a participant`, `✓ should persist the message tied to the sender and conversation` |
| CP-40, CP-42 | `chats.service.spec.ts` → describe `markConversationRead` | `npx jest src/chats/chats.service.spec.ts` | 2/2 tests pasan | Aprobado | `✓ should throw NotFoundException when the caller is not a participant`, `✓ should only mark the other participant's messages as read...` |
| CP-37 – CP-43 (delegación del controller) | `chats.controller.spec.ts` | `npx jest src/chats/chats.controller.spec.ts` | 5/5 tests pasan | Aprobado | Verifica que cada acción usa `user.sub` (JWT) como actor, nunca un parámetro de ruta, mismo patrón que `follows.controller.spec.ts` |
| Lint dirigido | `eslint src/chats` | `npx eslint src/chats` | Sin errores ni warnings nuevos | Aprobado | — |
| Build completo | `nest build` | `npm run build` | Sin errores | Aprobado | — |
| Suite completa (con Chats) | Todos los tests del backend | `npm run test` | **20 suites, 209 tests — todos pasan** (190 previos + 19 nuevos de Chats) | Aprobado | Ver salida completa arriba |

**No ejecutado en esta sesión** (requiere entorno con la base de datos real de Azure, no disponible aquí — sin archivo `.env`/credenciales en este sandbox):
- Aplicar `2026-09-01-01-add-direct-messages-read-status.sql` con `npm run db:migrate` contra la base real.
- Cualquier prueba de integración/sistema end-to-end (`POST /chats/conversations`, `GET /chats/conversations`, etc. contra un servidor real) — no existe infraestructura de e2e en el repo (mismo gap ya documentado para CP-16/CP-17).

### Espacio para otros integrantes

> Agregar aquí, en filas nuevas siguiendo el mismo formato, los resultados de:
> - **Integración final** / **Sistema** (CP-16, CP-17) — requiere decidir la estrategia de e2e (DB de prueba real vs. mocks extendidos) antes de poder ejecutarse.
> - **Uploads/Progreso** (CP-07).
> - **Challenges** (CP-03, CP-08).

---

## F8 — Challenge privado + `WorkoutPost` con `visibility='public'` (RESUELTO)

**Escenario:** la regla de Feed implementada en B2 es exactamente `post.visibility = 'public' AND post.moderation_status = 'approved'`, sin considerar `challenge.visibility`. Un post marcado `public` cuyo `workout_log` pertenece a un challenge `private` (invite-only) aparecía en `/feed` y en `/workout-posts/user/:userId` de otro usuario, revelando el nombre y la existencia de un challenge privado a usuarios que no son miembros. Se identificó en la auditoría de Fase 3 (hallazgo F8) y quedó documentado aquí como decisión de producto pendiente, sin resolverse unilateralmente durante B2.

**Decisión de producto (respuesta recibida):**

> No haría que `public` signifique "solo miembros del challenge". Son dos conceptos distintos: `challenges.visibility` controla quién puede acceder/unirse al challenge, mientras que `workout_posts.visibility` controla quién puede ver la publicación. Mezclarlos hace ambigua la lógica.
>
> Para un challenge privado, sí pondría una restricción: sus publicaciones no deberían poder convertirse en contenido público global. La validación principal debe hacerse al crear/actualizar el post. Si el challenge es privado, backend debe rechazar `visibility = public` o asignar automáticamente una visibilidad restringida. Además, aunque validen en escritura, también recomiendo filtrar en lectura como segunda capa de seguridad. No confiaría únicamente en que el dato se guardó correctamente.
>
> La misma regla debe aplicar a cualquier endpoint que exponga publicaciones, incluyendo `GET /workout-posts/user/:userId`. Si una publicación proviene de un challenge privado, alguien sin acceso al challenge no debería descubrirla entrando al perfil del usuario. La autorización debería ser consistente sin importar desde qué pantalla se consulta.

**Implementación (ver CP-29/30/31 arriba):**
1. `challenges.visibility` y `workout_posts.visibility` se mantuvieron como conceptos independientes — no hay ningún "public = solo miembros del challenge" en ningún lado del código.
2. Capa de escritura: `WorkoutLogService.resolvePostVisibility()` — si el challenge es `private` y se pidió `visibility: 'public'`, se asigna automáticamente `'private'` (opción "auto-asignar visibilidad restringida" de las dos que planteó la decisión; se prefirió sobre rechazar todo el envío de progreso porque este endpoint guarda imagen + ejercicios + post en una sola operación, y una publicación demasiado visible no debería tirar abajo el registro del entrenamiento).
3. Capa de lectura (segunda capa, independiente de que la escritura haya fallado o el post sea anterior a este fix): `WorkoutPostsService.challengePrivacyFilter()`, aplicado a `getFeed()`, `getUserPosts()` y `getChallengePhotos()`/`getUserPhotos()` por igual, para que la regla no dependa del endpoint.
4. `GET /workout-posts/user/:userId` queda explícitamente cubierto (CP-31): un viewer que no es miembro del challenge no ve el post aunque sea `'public'`; un miembro activo del challenge (o el propio autor) sí.

**Gaps identificados pero fuera de alcance de este cierre** (quedan como riesgo documentado, no como bug de F8): `GET /workout-posts/mosaic` no filtra por visibilidad en absoluto (ni la del post ni la del challenge), y no existe ningún guard de membresía en `GET /challenges/:id`. Ver notas de implementación en la sección de CP-29/30/31.
