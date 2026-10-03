# B2 — Seguridad y requisitos legales

Estado: implementado en `development` (backend). Este documento resume qué cambió, cómo se protege cada dato y qué falta que haga una persona (abogado, frontend, infra).

## 1. Visibilidad de posts (hallazgo crítico, corregido)

`GET /workout-posts/mosaic` (`WorkoutPostsService.findMosaicByChallenge`) no aplicaba **ningún** filtro de visibilidad: devolvía posts `private`, `followers` y de challenges privados a cualquier usuario autenticado. Ahora:

- Recibe el `viewerId` del JWT y aplica los mismos filtros que el resto de lecturas: `is_hidden = false`, moderación aprobada (el autor ve los suyos), visibilidad del post (`private` solo autor, `followers` solo seguidores activos) y `challengePrivacyFilter()` (challenge privado solo miembros).
- Los filtros de visibilidad por post se extrajeron a `postVisibilityFilter()` y ahora los comparten `fetchPhotos()` y el mosaico, para que no vuelvan a divergir.
- Verificado con SQL real contra Postgres (`workout-posts-mosaic.integration.spec.ts`): un extraño ve 0 posts de un challenge privado; en uno público solo ve el post `public`.
- La forma de la respuesta no cambió.

Revisión del resto de endpoints de lectura (Feed, perfiles, fotos de challenge, fotos de usuario, comentarios, reacciones): todos pasan por `getFeed`, `fetchPhotos`, `fetchPaginatedPhotos` o `assertPostVisibleToUser`. Sin hallazgos adicionales. Gap conocido que sigue abierto (documentado antes, fuera de este bloque): no hay guard de membresía en `GET /challenges/:id`.

## 2. Cabeceras HTTP

Configuración en `src/config/security-headers.ts`, conectada a **un solo** `helmet()` en `main.ts`:

| Cabecera | Valor |
|---|---|
| Content-Security-Policy | `default-src 'none'; script-src 'none'; style-src 'none'; …; frame-ancestors 'none'; form-action 'none'; base-uri 'none'` en toda la API. **Sin `unsafe-inline`.** |
| CSP en `/api-docs` | Solo ahí se permite `'self' 'unsafe-inline'`, porque Swagger UI lo necesita. |
| Permissions-Policy | cámara, micrófono, geolocalización, pagos, USB, etc. deshabilitados |
| Cross-Origin-Embedder-Policy | `require-corp` |
| Cross-Origin-Opener-Policy / Resource-Policy | `same-origin` |
| Referrer-Policy | `no-referrer` |
| Cache-Control | `no-store` en toda la API (excepto `/api-docs`) |

`GET /` ahora responde `application/json` (`{"status":"ok","service":"havit-api"}`) en lugar de `text/html` con "Hello World!".

Pendiente de infra: HSTS lo envía helmet, pero solo tiene efecto sobre HTTPS. Hoy el API se sirve por `http://20.63.84.1:3000` (ver sección 3).

## 3. Protección de datos

| Dato | En tránsito | En reposo |
|---|---|---|
| Correo, username | Cliente → API: **HTTP sin TLS** hoy (`http://20.63.84.1:3000`). API → Postgres: TLS (`ssl` en `app.module.ts`, Azure lo exige; `rejectUnauthorized=false` por defecto, ver abajo). | Postgres administrado de Azure (cifrado en reposo con claves de Microsoft). Texto plano dentro de la BD. |
| Contraseña | Igual que el correo | Solo `bcrypt` (cost 10), nunca en claro. |
| Fotos | Subida directa a Cloudflare R2 con URL prefirmada (HTTPS, 5 min). Lectura por `CLOUDFLARE_R2_PUBLIC_URL`. | Cifrado en reposo por Cloudflare R2. **Las URL son públicas por clave `uploads/<userId>/<uuid>`**: quien tenga la URL ve la foto aunque el post sea privado. |
| Métricas de entrenamiento | Igual que el correo | Postgres; sin cifrado a nivel de columna. |
| Token JWT | Igual que el correo | 7 días, firmado con `JWT_SECRET`; no se revoca al banear/eliminar (ver sección 5). |

Hallazgos que requieren decisión (no se tocaron en este bloque, son de infraestructura):

1. **El API no usa HTTPS.** Mientras sea así, correo, contraseña y JWT viajan en claro. Es el riesgo más serio para "usuarios reales". Solución: dominio + TLS (reverse proxy con Let's Encrypt o Azure Front Door/App Gateway).
2. `DB_SSL_REJECT_UNAUTHORIZED` es `false` por defecto: el cifrado existe pero no valida el certificado del servidor. Activar con el CA de Azure.
3. Fotos de posts privados en R2 son accesibles por URL directa. Para cerrarlo: bucket privado + URLs firmadas de lectura de corta duración.
4. Los datos de salud/métricas se consideran sensibles en varias jurisdicciones; la política de privacidad debe pedir consentimiento explícito y el abogado debe revisarlo.

## 4. Aceptación de T&C y mayoría de edad (16+)

- `POST /auth/register` exige `acceptTerms: true` y `confirmAge16: true` (400 si faltan o son `false`).
- Se guardan en `users`: `terms_accepted_at`, `terms_version` (constante `CURRENT_TERMS_VERSION` en `auth.service.ts`, hoy `2026-10-v1`) y `age_confirmed_at`. Migración `2026-10-02-03-terms-acceptance-and-account-deletion.sql`.
- Usuarios existentes quedan con `terms_accepted_at = NULL`. **Pendiente decidir** cómo hacerles aceptar (pantalla en el siguiente login + endpoint `POST /auth/accept-terms`); no se implementó.
- **Rompe el registro del frontend actual** hasta que envíe los dos campos y muestre los textos legales.

## 5. Eliminación de cuenta

Flujo (`AccountDeletionService`, endpoints en `/users/me/deletion-request`):

1. `POST` (requiere contraseña) → programa la eliminación a **30 días** (`ACCOUNT_DELETION_GRACE_DAYS`). El perfil deja de aparecer en búsqueda y perfil público de inmediato.
2. Durante el plazo, `DELETE` cancela y `GET` consulta el estado.
3. Un cron horario purga las cuentas vencidas: borra fotos en R2 (`uploads/<userId>/`) y, en una sola transacción, posts, comentarios, likes, workout logs y métricas, follows, participaciones/invitaciones/solicitudes, mensajes (chat y espacios), notificaciones y membresías. La fila de `users` queda **anonimizada** (username/email/hash sin identificar, `is_active=false`, `deleted_at`) porque la referencian registros de moderación y contenido creado (challenges, rutinas).
4. Si falla R2 o la BD, no se marca como hecho y se reintenta en la siguiente hora.

Decisiones que conviene validar con el abogado y con quien hizo B4: **30 días** como plazo (el requisito original no lo especificaba en lo que recibí); los mensajes del usuario en chats de otras personas se borran (no se anonimizan); reportes y penalizaciones se conservan anonimizados por seguridad de la comunidad. Los posts ya usan `is_active`/`is_hidden` como soft delete en B4; aquí se hace borrado real porque el objetivo es eliminar datos personales, no ocultarlos.

Limitaciones conocidas: el JWT ya emitido sigue siendo válido hasta 7 días tras la eliminación (la cuenta queda vacía e inactiva, `login` rechaza); copias de seguridad de Azure retienen datos según su política de retención (declararlo en la política de privacidad).

### Auditoría

Tabla `havit.account_deletion_audit` (sin FK a `users`, para que sobreviva): `requested`, `cancelled`, `completed`, `failed`, con SHA-256 del correo (permite verificar "¿se eliminó esta dirección?" sin guardarla) y detalles (fecha programada, objetos R2 borrados, error).

## 6. Pruebas

- `npx jest` → ver resultados en el resumen del cambio. Fallan por entorno (falta `ioredis` en `node_modules` local, sin relación con B2) 7 suites, y 2 tests de `workout-posts.service.spec` que ya fallaban antes (moderación desactivada temporalmente).
- Pruebas de integración contra Postgres real (se omiten sin `B2_TEST_DB_URL`; usar siempre una BD desechable con las migraciones aplicadas):

```bash
B2_TEST_DB_URL=postgres://user:pass@localhost:5434/havit_b2_test npx jest integration
```

## 7. OWASP ZAP

No encontré en los repositorios el reporte del primer escaneo, por lo que no puedo compararlo automáticamente. Los comandos para ejecutarlo contra una instancia **que no sea producción** están en el resumen entregado; guardar el reporte en `backend/docs/security/zap/` y comparar alertas contra el primero (cabeceras CSP/COEP/Permissions-Policy, Content-Type de `/`, "Storable and Cacheable Content" deberían desaparecer).
