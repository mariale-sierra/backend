# Guía manual — Posts/Feed (B2)

> Basada exclusivamente en código, DTOs, scripts y configuración reales de este repositorio (checkpoint `dfe47cb` + pruebas de Fase 4, sin commitear todavía). Todo dato que depende de tu entorno local/Azure y no puedo conocer aparece como `<PLACEHOLDER>` con instrucciones de cómo obtenerlo.

## Preparación

### Dependencias

```bash
cd backend
npm install
```

### Variables de entorno

No existe `backend/.env.example` en el repo (el `raiz/.env.example` existente tiene nombres de variable desactualizados/incorrectos — no lo uses como referencia). Las variables que el propio código lee son estas (`src/config/env.validation.ts` hace fallar el arranque si faltan las marcadas **requerida**):

| Variable | Requerida | Uso |
|---|---|---|
| `DB_HOST` | Sí | Postgres (Azure) |
| `DB_USERNAME` | Sí | Postgres |
| `DB_PASSWORD` | Sí | Postgres |
| `DB_DATABASE` | Sí | Postgres |
| `JWT_SECRET` | Sí | Firma de tokens |
| `DB_PORT` | No (default `5432`) | Postgres |
| `DB_SSL` | No (default `true`) | Poné `false` solo contra un Postgres local sin TLS |
| `PORT` | No (default `3000`) | Puerto HTTP |
| `OPENAI_API_KEY` | No, pero sin ella **ningún post pasa moderación** (ver nota abajo) | Moderación de imágenes |
| `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET_NAME`, `CLOUDFLARE_R2_PUBLIC_URL` | No, pero sin ellas `POST /uploads/sign` falla | Subida real de imágenes |
| `PHOTOS_INCLUDE_PENDING` | No | Solo local/dev — ver nota de moderación |

`DB_HOST`/`DB_USERNAME`/`DB_PASSWORD`/`DB_DATABASE`/`JWT_SECRET` reales del proyecto: pedíselos a quien tenga el `.env` ya configurado (según `README.md`, "el archivo `.env` en el servidor ya está configurado" — sos parte del equipo, deberías tener acceso a esas credenciales o a quien te las pase). Escribilos en `backend/.env`.

**⚠️ Importante — B2 todavía no está en el servidor remoto (`http://20.63.84.1:3000`).** El checkpoint `dfe47cb` es un commit **local**, nunca se hizo push. Si apuntás al servidor remoto no vas a encontrar `/feed` ni `/workout-posts/user/:userId`. Para probar B2 necesitás levantar el backend **localmente** con tu `.env`.

### Levantar el backend

Dos formas reales, ambas ya definidas en el repo:

**Opción A — directo con npm (recomendada para iterar rápido):**
```bash
cd backend
npm run db:migrate   # aplica migraciones pendientes, incluidas las 2 de B2
npm run start:dev
```

**Opción B — vía `raiz/` (Docker, igual que producción):**
```bash
cd raiz
docker compose up
```
(esto corre `npm run db:migrate && npm run start:dev` dentro del contenedor automáticamente — no hace falta el paso manual de migrar).

En ambos casos el backend queda escuchando en `http://localhost:3000` (o el `PORT` que hayas puesto).

### ¿Necesito el frontend?

No. Todo lo de B2 se puede probar por HTTP directo (curl) o desde Swagger UI. El frontend (`frontend/`) ni siquiera tiene todavía la opción de crear un post `public` en su UI (`VisibilityToggle` solo ofrece Followers/Private) — no lo toques, no forma parte de B2.

### Swagger

```
http://localhost:3000/api-docs
```
Ahí vas a ver los tags **Workout Posts** y **Feed** con los endpoints nuevos documentados (query params, respuestas, `X-Next-Cursor`, etc.). Podés usar "Try it out" ahí mismo, pero para inspeccionar headers de respuesta (`X-Next-Cursor`) es más directo usar `curl -i`.

### Autenticarme

Existe un usuario de prueba ya sembrado en la base (`database/seeds/2026-07-21-01-test-user.sql`):

```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"testuser@havit.dev","password":"TestHavit123!"}'
```

Respuesta real (`AuthService.login`, `src/auth/auth.service.ts`):
```json
{ "accessToken": "<JWT_VALIDO>" }
```

Guardá ese token:
```bash
export TOKEN="<JWT_VALIDO>"
```

Para todos los endpoints protegidos:
```
Authorization: Bearer $TOKEN
```

Para probar "otro usuario" (necesario en varios pasos de abajo) vas a necesitar una **segunda cuenta**. Registrala vos mismo (`RegisterDto`, `src/auth/dto/register.dto.ts` — `email`, `password` min. 8 caracteres, `username`):
```bash
curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"segundo@havit.dev","password":"TestHavit123!","username":"segundouser"}'

curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"segundo@havit.dev","password":"TestHavit123!"}'
export TOKEN2="<JWT_VALIDO_DEL_SEGUNDO_USUARIO>"
```

---

## Crear un Post público

### Precondiciones

- Un challenge existente (`CreateWorkoutProgressDto.challengeId` es **obligatorio**, `src/workout-log/dto/create-workout-progress.dto.ts`). Si no tenés uno, listá los disponibles:
```bash
curl -s http://localhost:3000/challenges -H "Authorization: Bearer $TOKEN" | jq
```
  Tomá cualquier `id` (es un UUID). Si la lista está vacía, tenés que crear uno primero (`POST /challenges`, fuera del alcance de esta guía — pedile a quien tenga Challenges un `challengeId` de prueba).
- El usuario no debe haber registrado progreso hoy para ese `challengeId` (regla existente: un registro por día por challenge — si ya probaste, esperá al día siguiente o usá otro challenge).

### Obtener una `image_url` real (flujo R2)

```bash
curl -s -X POST http://localhost:3000/uploads/sign \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fileType":"image/jpeg"}'
```
Respuesta real (`UploadsService.getPresignedUrl`, `src/uploads/uploads.service.ts`):
```json
{ "signedUrl": "https://...", "publicUrl": "https://...", "key": "uploads/<userId>/<uuid>.jpeg" }
```
Subí un archivo real a `signedUrl` (PUT, sin auth adicional — la firma ya autoriza):
```bash
curl -s -X PUT "<signedUrl>" \
  -H "Content-Type: image/jpeg" \
  --data-binary @/ruta/a/tu/foto.jpg
```
Usá el `publicUrl` devuelto como `imageUrl` en el siguiente paso. (Si `CLOUDFLARE_R2_*` no está configurado en tu entorno, este paso va a fallar con 500 — en ese caso podés usar cualquier URL de imagen pública real solo para aislar la prueba de Feed, sabiendo que no estás probando el flujo real de R2.)

### Crear el post

Endpoint real (`POST /workout-logs/progress`, `src/workout-log/workout-log.controller.ts` — `POST /challenges/progress` hace exactamente lo mismo):

```bash
curl -s -X POST http://localhost:3000/workout-logs/progress \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "challengeId": "<UUID_DEL_CHALLENGE>",
    "imageUrl": "<publicUrl_del_paso_anterior>",
    "caption": "Prueba manual B2",
    "visibility": "public"
  }'
```
`visibility` acepta `"private" | "followers" | "public"` (`CreateWorkoutProgressDto`, ampliado en B2). Si lo omitís, el default es `"private"`.

**Resultado esperado:** `201`, con el `WorkoutLog` creado (incluye sus `exercises`, vacío si no mandaste `routineId`). El `WorkoutPost` se crea como side-effect (no lo ves en esta respuesta directamente).

### Efecto de moderación async

El post nace con `moderation_status = 'pending'` y OpenAI lo revisa en segundo plano (`WorkoutPostsService.reviewPostModeration`). **Sin `OPENAI_API_KEY` configurada, el post queda `pending` para siempre** (3 reintentos fallidos → se guarda como `pending` con una nota) — y como el Feed exige `moderation_status='approved'` sin excepciones (regla B2, auditada en Fase 3), **nunca vas a verlo en `/feed` en ese caso**, sin que sea un bug de B2.

Para confirmar visualmente el efecto de moderación sin depender de OpenAI, tenés dos caminos:
1. Configurar `OPENAI_API_KEY` real y esperar unos segundos tras crear el post.
2. (Solo entorno de prueba) Actualizar la fila manualmente: `UPDATE havit.workout_posts SET moderation_status = 'approved' WHERE id = '<id>';` — usalo solo para validar el pipeline de lectura, no como sustituto de probar moderación real.

---

## Feed

```bash
curl -s http://localhost:3000/feed -H "Authorization: Bearer $TOKEN" | jq
```

Verificá:
- **Shape**: cada elemento tiene `id, user_id, user_name, challenge_id, challenge_name, challenge_day, posted_at` (snake_case). `activity_type`, `user_avatar_url`, `caption`, `image_url`, `likes_count` pueden estar ausentes — nunca vas a ver `activity_type` poblado (decisión de Fase 3: no hay forma inequívoca de calcularlo, se omite a propósito).
- **Orden**: más reciente primero (`posted_at` descendente).
- **Ausencia de `private`**: creá un post con `"visibility":"private"` y confirmá que NO aparece en `/feed` (ni para vos mismo).
- **Ausencia de `followers`**: mismo test con `"visibility":"followers"` — tampoco debe aparecer, ni siquiera para su propio autor (no hay módulo de Followers todavía).
- **Ausencia de `pending`**: un post recién creado (antes de que la moderación lo apruebe) no debe aparecer.
- **Ausencia de `rejected`**: si tenés forma de forzar un rechazo (una imagen que OpenAI marque, o `UPDATE ... SET moderation_status='rejected'` en un entorno de prueba), confirmá que tampoco aparece.
- Sin JWT, `GET /feed` debe devolver `401` (el guard global protege la ruta, no tiene `@Public()`).

## Posts por usuario

**Mis posts:**
```bash
curl -s http://localhost:3000/workout-posts/user/<MI_USER_ID> -H "Authorization: Bearer $TOKEN" | jq
```
(`<MI_USER_ID>` = el `sub` de tu JWT — decodificalo en jwt.io o pedí `GET /auth/me` con tu token). Deberías ver **todas** tus publicaciones (incluidas `private`/`followers`/`pending`), igual que `/workout-posts/mine`:
```bash
curl -s http://localhost:3000/workout-posts/mine -H "Authorization: Bearer $TOKEN" | jq
```

**Posts públicos de otro usuario** (usá el segundo usuario que registraste):
```bash
curl -s http://localhost:3000/workout-posts/user/<USER_ID_DEL_SEGUNDO> -H "Authorization: Bearer $TOKEN" | jq
```
Solo debería devolver posts `public` + `approved` de ese usuario — ninguno `private`/`followers`/`pending` suyo, aunque vos mismo sí los veas con tu propio token en tu propio `userId`.

**Usuario sin publicaciones:** probá con un usuario recién registrado que todavía no creó ningún post → `200` y `[]`.

**UUID inexistente:**
```bash
curl -i http://localhost:3000/workout-posts/user/00000000-0000-0000-0000-000000000000 \
  -H "Authorization: Bearer $TOKEN"
```
Esperado: `404`, body con `message: "User not found"`.

---

## Paginación

1. Pedí una página chica:
```bash
curl -i "http://localhost:3000/feed?limit=1" -H "Authorization: Bearer $TOKEN"
```
2. Mirá el header de respuesta `X-Next-Cursor` (con `-i` los headers se imprimen). Si hay más de 1 post público+aprobado, va a estar presente.
3. Pedí la siguiente página con ese valor:
```bash
curl -i "http://localhost:3000/feed?limit=1&cursor=<valor_de_X-Next-Cursor>" -H "Authorization: Bearer $TOKEN"
```
4. **Sin duplicados**: el `id` de esta página no debe repetir el de la anterior (el orden es `created_at DESC, id DESC`, con `id` como desempate estable — no debería haber overlaps ni saltos).
5. **Última página**: seguí pidiendo con el cursor más reciente hasta que la respuesta ya no traiga header `X-Next-Cursor` — esa es la señal de que no hay más páginas (la ausencia del header, no un valor especial).

---

## Errores

```bash
# Sin JWT
curl -i http://localhost:3000/feed
# Esperado: 401

# Cursor inválido
curl -i "http://localhost:3000/feed?cursor=esto-no-es-un-cursor-valido" -H "Authorization: Bearer $TOKEN"
# Esperado: 400, message: "cursor inválido"

# limit=0
curl -i "http://localhost:3000/feed?limit=0" -H "Authorization: Bearer $TOKEN"
# Esperado: 400 (violación de @Min(1))

# limit=51
curl -i "http://localhost:3000/feed?limit=51" -H "Authorization: Bearer $TOKEN"
# Esperado: 400 (violación de @Max(50))

# userId inválido (no UUID)
curl -i "http://localhost:3000/workout-posts/user/no-es-un-uuid" -H "Authorization: Bearer $TOKEN"
# Esperado: 400 (ParseUUIDPipe)

# usuario inexistente
curl -i "http://localhost:3000/workout-posts/user/00000000-0000-0000-0000-000000000000" -H "Authorization: Bearer $TOKEN"
# Esperado: 404
```

Todos los errores deberían tener la forma estándar del backend (`HttpExceptionFilter`): `{ statusCode, error, message, code?, timestamp, path }` — nunca un stack trace ni un error crudo de Postgres.

---

## Regresión: Challenge → Workout/Progress → WorkoutPost

Este flujo es preexistente, no lo cambió B2, pero como B2 amplió `visibility` y toca `WorkoutLogService`, vale la pena confirmarlo:

```bash
curl -s http://localhost:3000/challenges -H "Authorization: Bearer $TOKEN" | jq
curl -s -X POST http://localhost:3000/challenges/<challengeId>/join -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://localhost:3000/workout-logs/progress \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"challengeId":"<challengeId>","imageUrl":"<url>","visibility":"private"}'
curl -s "http://localhost:3000/challenges/progress?challengeId=<challengeId>" -H "Authorization: Bearer $TOKEN" | jq
```
Esperado: te unís sin error, el progreso se registra (`201`), y `GET /challenges/progress` refleja el día actual/racha — igual que antes de B2. Si esto falla, es una regresión real y hay que reportarla antes de integrar.

---

## Checklist manual final

- [ ] Backend levanta correctamente (`npm run start:dev` o `docker compose up` en `raiz/`).
- [ ] Migraciones B2 aplicadas en el entorno de prueba (`npm run db:migrate` corrió sin error, o el log del contenedor lo confirma).
- [ ] Puedo crear una publicación `public`.
- [ ] La publicación pasa por moderación (o entiendo por qué quedó `pending` sin `OPENAI_API_KEY`).
- [ ] Un post aprobado/`public` aparece en Feed.
- [ ] `private` no aparece en Feed.
- [ ] `followers` no aparece en Feed.
- [ ] `pending`/`rejected` no aparecen en Feed.
- [ ] Posts por usuario funcionan (propio, otro, sin posts, inexistente).
- [ ] Paginación funciona (cursor, sin duplicados, última página reconocible).
- [ ] Errores esperados responden correctamente (401, 400 cursor/limit, 400 UUID, 404 usuario).
- [ ] Tests automatizados B2 pasan (`npx jest src/workout-posts/ src/workout-log/workout-log.service.spec.ts`).
- [ ] Suite existente sigue pasando (`npm run test`).
- [ ] No detecté regresión en Challenge/Workout/Progress.

Con esa lista marcada, podés afirmar: **B2 Posts/Feed está lista para integración.**
