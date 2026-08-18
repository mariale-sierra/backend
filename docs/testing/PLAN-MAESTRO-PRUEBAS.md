# Plan Maestro de Pruebas — Havit Backend

> Documento vivo, compartido por todo el equipo. Cada integrante extiende la sección de **Plan de Pruebas** y **Resultados** correspondiente a su módulo. No existía documentación de testing previa en este repositorio — este documento se crea desde cero en el Sprint de B2 (Posts/Feed) y queda en `backend/docs/testing/` como ubicación de referencia para el resto de módulos.

---

## A. Plan Maestro de Pruebas

### Objetivo

Validar que las funcionalidades entregadas en cada sprint de Havit se comportan según lo especificado, antes de integrarlas a `development`, con evidencia real (no solo planificación) de qué se probó, cómo, y con qué resultado.

### Alcance

Este documento cubre el backend (`backend/`, NestJS + PostgreSQL). Cada módulo del backend contribuye su propia sección al Plan de Pruebas (tabla CP). Al momento de escribir esto:

- **Cubierto con pruebas automatizadas reales**: Auth, Challenges (parcial), Workout Log (parcial), Users/Perfil (parcial), **Posts/Feed (B2, completo)**.
- **Sin pruebas automatizadas todavía**: Followers, Uploads (R2), flujos de sistema end-to-end (CP-16, CP-17).
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
| CP-13 | Followers | Integración | Seguir a otro usuario | Dos usuarios diferentes | Se crea correctamente la relación de seguimiento | Media | Followers | ❌ No implementado (ni código ni tests) | Pendiente — módulo no iniciado, fuera de alcance de B2 |
| CP-14 | Followers | Integración | Dejar de seguir a un usuario | Relación de seguimiento existente | Se elimina correctamente la relación | Media | Followers | ❌ No implementado | Pendiente — fuera de alcance de B2 |
| CP-15 | Followers | Funcional | Intentar seguirse a sí mismo | Usuario intenta seguir su propio perfil | El sistema rechaza la operación | Media | Followers | ❌ No implementado | Pendiente — fuera de alcance de B2 |
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

---

## C. Resultados de pruebas ejecutadas — Sprint B2 (Posts/Feed)

Todas las filas de esta sección corresponden a comandos **realmente ejecutados** en esta sesión, contra el checkpoint `dfe47cb` + las pruebas agregadas en Fase 4. Ningún resultado fue inferido por lectura de código.

| Caso | Prueba ejecutada | Comando | Resultado obtenido | Estado | Evidencia |
|---|---|---|---|---|---|
| CP-01, CP-02 | Suite de Auth | `npm run test` | 5/5 tests de `auth.service.spec.ts` pasan | Aprobado | Ver salida de Jest, sección Verificación |
| CP-04 | Suite de Challenges (join) | `npm run test` | 4/4 tests de `joinChallenge` pasan | Aprobado | Ídem |
| CP-05, CP-06 | Suite de Workout Log (creación) | `npm run test` | 2/2 tests preexistentes de `createWorkout` pasan | Aprobado (parcial) | Ídem |
| CP-09 | `workout-log.service.spec.ts` → *"generating the WorkoutPost"* | `npx jest src/workout-log/workout-log.service.spec.ts` | 3/3 tests nuevos pasan | Aprobado | `✓ should call workoutPostsService.create with the submitted image, caption and visibility` |
| CP-10, CP-18, CP-19, CP-27 | `workout-posts.service.spec.ts` (`getFeed`) + `feed.controller.spec.ts` | `npx jest src/workout-posts/` | 10/10 + 7/7 tests pasan | Aprobado | Ver salida completa, sección Verificación |
| CP-11, CP-12 | Suite de Users/Perfil | `npm run test` | 15/15 tests de `users.service.spec.ts` pasan | Aprobado | Ídem |
| CP-13, CP-14, CP-15 | — | — | No existe código ni test que ejecutar | No ejecutado | N/A — módulo no implementado |
| CP-16, CP-17 | — | — | No existe `*.e2e-spec.ts` | No ejecutado | N/A — pendiente de infraestructura de e2e |
| CP-20, CP-21, CP-22, CP-23 | `workout-posts.service.spec.ts` (`getUserPosts`) + `workout-posts.controller.spec.ts` | `npx jest src/workout-posts/` | 7/7 + 6/6 tests pasan | Aprobado | Ídem |
| CP-24, CP-25 | `pagination.util.spec.ts` | `npx jest src/workout-posts/pagination.util.spec.ts` | 18/18 tests pasan | Aprobado | Ídem |
| CP-26 | — | Verificado por diseño (decoradores `class-validator`), no por test dedicado | — | No ejecutado (ver limitación) | — |
| CP-28 | `workout-log.service.spec.ts` → *"generating the WorkoutPost"* | `npx jest src/workout-log/workout-log.service.spec.ts` | 3/3 (mismos tests que CP-09) | Aprobado | Ídem |
| Suite completa | Todos los tests del backend | `npm run test` | **15 suites, 145 tests — todos pasan** | Aprobado | Ver salida completa, sección Verificación |

### Espacio para otros integrantes

> Agregar aquí, en filas nuevas siguiendo el mismo formato, los resultados de:
> - **Perfil** (CP-11/CP-12 a nivel de endpoint HTTP completo, estadísticas agregadas).
> - **Followers** (CP-13, CP-14, CP-15) — una vez exista el módulo.
> - **Integración final** / **Sistema** (CP-16, CP-17) — requiere decidir la estrategia de e2e (DB de prueba real vs. mocks extendidos) antes de poder ejecutarse.
> - **Uploads/Progreso** (CP-07).
> - **Challenges** (CP-03, CP-08).

---

## Caso pendiente de decisión de producto

**Escenario: Challenge privado + `WorkoutPost` con `visibility='public'`.**

La regla de Feed implementada en B2 es exactamente:

```
post.visibility = 'public' AND post.moderation_status = 'approved'
```

Esta regla **no considera** `challenge.visibility`. En consecuencia, un post marcado `public` cuyo `workout_log` pertenece a un challenge `private` (invite-only) **sí aparece hoy en `/feed`** y en `/workout-posts/user/:userId` de otro usuario — potencialmente revelando el nombre y la existencia de un challenge privado a usuarios que no son miembros.

Esto no es un bug de implementación: es exactamente lo que el diseño técnico cerrado en la Fase 2/3 especifica ("Feed = `public` + `approved`, sin excepciones"). Se identificó como riesgo en la auditoría de Fase 3 (hallazgo F8) y **no se resolvió unilateralmente**, por instrucción explícita de no modificar la lógica de negocio durante la fase de pruebas.

**Qué debería definirse antes de convertir esto en un caso de aceptación definitivo:**
1. ¿Un post `public` debe heredar la visibilidad de su challenge (es decir, "público" significa "público entre los miembros del challenge", no "público en toda la app")?
2. Si la respuesta es sí, ¿el Feed debería hacer `JOIN` contra `challenges.visibility` y excluir los challenges privados, o debería ser el propio usuario quien no pueda elegir `visibility='public'` al postear en un challenge privado (validación en la creación, no en la lectura)?
3. ¿Esta regla debe aplicar también a `GET /workout-posts/user/:userId` (posts públicos de otro usuario), no solo al Feed global?

No se implementó ninguna de estas opciones — se documenta como decisión de producto pendiente.
