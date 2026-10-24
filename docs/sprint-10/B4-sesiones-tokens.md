# B4 — Sesiones, tokens y autenticación (Sprint 10)

Referencia principal de B4 para los dos repositorios. El documento hermano `frontend/docs/sprint-10/B4-sesiones-tokens.md` cubre solo la parte de la app. Corrige los hallazgos **M1** (JWT de 7 días sin revocación), **M2** (contraseñas débiles) y **M3** (enumeración de cuentas) de `docs/security/AUDITORIA-OWASP-Y-CARGA-2026-10-13.md`.

> Nada de esto está desplegado. La migración está **preparada** y solo se ejecutó contra una base local desechable (`havit_b4_test` en `localhost`). No se tocó Azure ni el servidor.

## 1. Estado de cada requisito

| # | Requisito | Estado | Dónde |
|---|---|---|---|
| 1 | Access token de 15 min + refresh opaco aleatorio guardado hasheado | ✅ Implementado y probado | `src/auth/refresh-tokens.service.ts`, `src/auth/auth.service.ts` |
| 1 | Tabla nueva (user_id, family_id, token_hash, expires_at, revoked_at, replaced_by) | ✅ Migración preparada (no aplicada en Azure) | `database/migrations/2026-10-23-01-refresh-tokens.sql` |
| 1 | Rotación en cada uso; `POST /auth/refresh`, `POST /auth/logout` | ✅ | `src/auth/auth.controller.ts` |
| 1 | Limpieza de vencidos con `@nestjs/schedule` | ✅ Cron diario 04:00 | `RefreshTokensService.deleteExpired` |
| 1 | Front: un refresh (single flight) ante 401 y un reintento; si falla, cierra sesión; sin segundo cliente axios | ✅ | `frontend/services/api.ts`, `frontend/services/auth/sessionRefresh.ts` |
| 1 | Transición: tokens de 7 días sin `sid` valen hasta vencer; fecha límite documentada | ✅ Ver §6 | `src/auth/guards/jwt-auth.guard.ts` |
| 2 | Logout revoca la familia; reuso de un refresh rotado revoca la familia | ✅ | `RefreshTokensService.rotate` / `revokeByToken` |
| 2 | Decidir y documentar si el guard valida el `sid` en la consulta cacheada de 30 s | ✅ Sí, ver §4 | `JwtAuthGuard.assertSessionUsable` |
| 3 | Validador compartido: mínimo 10, lista de comunes empaquetada, sin username/email | ✅ | `src/auth/password-policy.ts`, `src/auth/common-passwords.txt` |
| 3 | Aplicarlo donde se fije una contraseña; avisar si no existe cambio de contraseña | ✅ Solo existe el registro. **No hay endpoint de cambio ni de recuperación de contraseña** (`frontend/app/(auth)/recover-password.tsx` es un placeholder). | `RegisterDto` |
| 3 | Mensajes de contraseña específicos; ajustar `register.tsx` | ✅ | `frontend/app/(auth)/register.tsx` (cambio mínimo, B10 lo refactoriza) |
| 4 | `bcrypt.compare` contra hash falso si el usuario no existe | ✅ Tiempos medidos iguales (§8) | `AuthService.login` |
| 4 | Mensaje de cuenta desactivada solo tras contraseña correcta | ✅ (ya era así; ahora probado) | `AuthService.login` |
| 4 | Mismo mensaje y estado para email y username duplicados + throttle propio en `/register` | ✅ 409 único + 5 por IP cada 10 min | `AuthService.register`, `AuthController` |
| 4 | Decisión de producto confirmada y documentada | ✅ Ver §7 (falta la revisión formal de B11) | |
| 5 | Pruebas: expiración (timers falsos), rotación, reuso, logout, token revocado, contraseñas débiles, enumeración, e2e | ✅ Ver §8 | |

## 2. Flujo de tokens

```mermaid
sequenceDiagram
    participant App
    participant API as Backend (NestJS)
    participant DB as havit.refresh_tokens
    App->>API: POST /auth/login {email, password}
    API->>DB: INSERT (family F, hash(R1), expires +30 d)
    API-->>App: accessToken A1 (15 min, sid=F) + refreshToken R1
    App->>API: GET /x  (Bearer A1)
    API->>DB: guard: ¿cabeza de F viva? (cache 30 s)
    API-->>App: 200
    Note over App: pasan 15 min
    App->>API: GET /x (Bearer A1)
    API-->>App: 401
    App->>API: POST /auth/refresh {R1}   (uno solo aunque fallen varias peticiones)
    API->>DB: SELECT … FOR UPDATE; INSERT R2 (misma F); R1.replaced_by = R2
    API-->>App: A2 + R2
    App->>API: GET /x (Bearer A2)  — reintento único
    API-->>App: 200
    Note over App,API: Si alguien presenta R1 otra vez (reuso)
    API->>DB: revoked_at en toda F (reason=reuse)
    API-->>App: 401 → la app cierra sesión
    App->>API: POST /auth/logout {R2}
    API->>DB: revoked_at en toda F (reason=logout)
    API-->>App: 204 (A2 deja de valer al instante en esta instancia)
```

En texto:

```
login/registro ──► familia F nueva: R1 (30 d) + A1 (15 min, sid=F)
401 con token ──► POST /auth/refresh R1 ──► R1 rotado → R2 + A2 ──► reintento único
reuso de R1   ──► toda F revocada (reuse) ──► 401 ──► la app cierra sesión
logout R2     ──► toda F revocada (logout) ──► 204; A2 cae en ≤30 s (inmediato en la misma instancia)
cuenta baneada/borrada ──► el refresh revoca F (account) y responde 401
```

Contratos:

| Endpoint | Cuerpo | Respuesta | Errores |
|---|---|---|---|
| `POST /auth/login` (público, 10/min por IP) | `{ email, password }` | `200 { accessToken, refreshToken, user }` | `401 "Invalid email or password"` (igual exista o no el email); `401 "This account has been deactivated"` solo con la contraseña correcta |
| `POST /auth/register` (público, **5 por IP cada 10 min**) | `{ email, username, password, acceptTerms, confirmAge16 }` | `200 { message, accessToken, refreshToken, user }` | `400` con el mensaje de la regla de contraseña incumplida; `409 "Email or username already in use"`; `429` |
| `POST /auth/refresh` (público, 30/min por IP) | `{ refreshToken }` | `200 { accessToken, refreshToken, user }` | `401 "Invalid refresh token"` para cualquier fallo (desconocido, vencido, revocado, reusado, cuenta no utilizable); `400` si falta o pasa de 200 caracteres |
| `POST /auth/logout` (público) | `{ refreshToken? }` | `204` siempre | — |

`/auth/logout` es público a propósito: cerrar sesión debe funcionar con un access token ya vencido, y quien tiene el refresh token es quien puede revocar su sesión.

Claims del access token: `{ sub, email, username, sid, iat, exp }`. `sid` es el `family_id`. Duraciones en `src/auth/refresh-tokens.service.ts` (`ACCESS_TOKEN_TTL_SECONDS = 900`, `REFRESH_TOKEN_TTL_DAYS = 30`).

## 3. Esquema de la tabla

`database/migrations/2026-10-23-01-refresh-tokens.sql` (idempotente, `IF NOT EXISTS`):

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `UUID PK DEFAULT gen_random_uuid()` | |
| `user_id` | `UUID NOT NULL → users(id) ON DELETE CASCADE` | |
| `family_id` | `UUID NOT NULL` | Una familia = un login en un dispositivo = el `sid` |
| `token_hash` | `CHAR(64) NOT NULL`, índice único | SHA-256 hex del token. El token tiene 256 bits aleatorios, así que basta un hash rápido sin sal; el token en claro no se guarda nunca |
| `expires_at` | `TIMESTAMPTZ NOT NULL` | Emisión + 30 días |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `revoked_at` | `TIMESTAMPTZ NULL` | Se pone en **todas** las filas de la familia al revocarla |
| `revoke_reason` | `TEXT NULL`, `CHECK IN ('logout','reuse','account')` | |
| `replaced_by` | `UUID NULL → refresh_tokens(id) ON DELETE SET NULL` | Token que lo sustituyó al rotar |

Índices: único en `token_hash`; parcial `(family_id) WHERE replaced_by IS NULL` (consulta del guard); `(user_id)`; `(expires_at)` (limpieza).

**Sesión viva** = la familia tiene una cabeza (`replaced_by IS NULL`) con `revoked_at IS NULL` y `expires_at > now()`.

No hay entidad TypeORM: el servicio usa SQL directo, como `account-deletion.service.ts` y el guard (rotación con `SELECT … FOR UPDATE` dentro de una transacción).

## 4. Revocación: decisión del guard

**Decisión: sí, `JwtAuthGuard` valida el `sid` dentro de la misma consulta cacheada de 30 s** que ya comprobaba `is_active`/`deleted_at`. Es una sola consulta por sesión cada 30 s:

```sql
SELECT u.is_active, u.deleted_at,
       EXISTS (SELECT 1 FROM havit.refresh_tokens t
               WHERE t.family_id = $2 AND t.user_id = u.id
                 AND t.replaced_by IS NULL AND t.revoked_at IS NULL
                 AND t.expires_at > now()) AS session_active
FROM havit.users u WHERE u.id = $1
```

- La caché va por sesión (`s:<sid>`; los tokens viejos sin `sid` siguen usando `u:<userId>`). Es un `Map` a nivel de módulo, **compartido por todas las instancias del guard** (el `APP_GUARD` global y cada `@UseGuards(JwtAuthGuard)` de los controladores crean la suya).
- Logout y reuso llaman a `JwtAuthGuard.forgetSession(sid)`. En la instancia que atendió la revocación, el access token deja de valer **al instante**. En otra instancia (hoy hay una sola), tarda como mucho 30 s. Sin esta comprobación, un access token robado seguiría valiendo hasta 15 minutos después de cerrar sesión.
- Se rechaza sin consultar un `sid` que no sea UUID. No debería pasar, porque el token va firmado, pero un error de la consulta deja pasar la petición, así que no se le da esa vía.
- **Riesgo heredado y aceptado:** si la base falla, el guard deja pasar la petición (comportamiento previo, para no cerrar todas las sesiones por un corte breve). Durante un corte, una sesión revocada podría seguir funcionando hasta que vuelva la base. Las peticiones normales fallan igual en ese caso.

## 5. Política de contraseñas

`src/auth/password-policy.ts`, decorador `@IsAcceptablePassword()` en `RegisterDto`. Las reglas se aplican en este orden y cada una tiene su mensaje:

| Regla | Mensaje (inglés en la API; la app lo traduce) |
|---|---|
| Mínimo **10** caracteres | `Password must be at least 10 characters` |
| Máximo **72 bytes** UTF-8 (bcrypt ignora el resto) | `Password must be at most 72 bytes` |
| No contener el `username` ni la parte local del email (sin distinguir mayúsculas, también con leetspeak deshecho; partes de menos de 3 caracteres se ignoran) | `Password must not contain your username or email` |
| No ser común: menos de 4 caracteres distintos, o coincidir con `src/auth/common-passwords.txt` comparando la contraseña, su versión sin leetspeak y sin dígitos/símbolos en los extremos (`Password2024!`, `p@ssw0rd1234` → `password`) | `Password is too common` |

- La lista es propia del proyecto (463 entradas: comunes en inglés y español, secuencias, palabras del dominio como `havit` o `gimnasio`). No se descargó nada. Para ampliarla se añaden líneas en minúsculas al archivo.
- `nest build` no copia archivos que no sean TS, y el build actual deja el código en `dist/src/` (ver §10). Por eso la lista se busca junto al archivo compilado y después en `src/auth/`, que la imagen Docker siempre contiene (`COPY . .`). `AuthService.onModuleInit` la carga al arrancar: si falta, falla el arranque, no el primer registro.
- **Solo se aplica al fijar una contraseña.** Hoy eso solo ocurre en el registro. El login no la aplica: las cuentas creadas con la regla vieja de 8 caracteres siguen entrando (probado en e2e). **No existe endpoint de cambio ni de recuperación de contraseña.** Cuando se cree, debe usar `@IsAcceptablePassword()` y revocar las demás sesiones del usuario (`RefreshTokensService`).
- La app replica en su esquema zod la longitud, el máximo de bytes y la regla de identidad. La lista de comunes solo vive en el servidor, y su mensaje vuelve traducido al paso de contraseña.

## 6. Transición y fecha de retiro de los tokens de 7 días

- Un token emitido antes de B4 (`{sub, email, username}`, 7 días, **sin `sid`**) sigue pasando el guard con la comprobación de cuenta de siempre, **hasta que vence**.
- **No obtiene privilegios de renovación:** no es un refresh token. `/auth/refresh` lo rechaza (400 por longitud, o 401), y la app sin refresh token guardado cierra sesión al primer 401 en lugar de intentar renovar. Probado en e2e (S4) y en las pruebas del front.
- Desde el despliegue, todo token nuevo lleva `sid`.
- **Fecha límite = fecha y hora del despliegue del backend con B4 + 7 días.** El último token de 7 días posible se emitió justo antes del despliegue. Ejemplo: si el backend B4 entra en producción el 2026-10-26 a las 18:00 UTC, desde el **2026-11-02 18:00 UTC** ya no queda ningún token de 7 días válido. Hay que anotar aquí la fecha real al desplegar: **despliegue: _pendiente_ → retiro: _pendiente_ + 7 días**.
- Después de esa fecha se puede eliminar la rama sin `sid` del guard (`cacheKey` `u:` y la consulta solo de usuario) en una tarea de limpieza.

**Compatibilidad entre versiones (decisión de producto, §7):**

| Backend \ App | App vieja (sin B4) | App con B4 |
|---|---|---|
| Backend viejo | Como hoy | Funciona: sin `refreshToken` en la respuesta guarda solo el access token; al vencer (7 d), cierra sesión; `/auth/logout` 404 se ignora |
| **Backend B4** | Las sesiones ya abiertas siguen hasta vencer; **un login nuevo dura 15 min** (ignora el refresh) hasta que actualicen la app | ✅ Objetivo |

## 7. Decisiones de producto (confirmadas el 2026-10-23)

Las tres se presentaron antes de implementar y quien encargó B4 eligió la opción recomendada en cada una. La primera se planteó explícitamente como confirmación con **Ale Sierra (B11)**. **B11 debe revisarla formalmente** dentro de su revisión de seguridad.

1. **Enumeración en el registro:** el mismo `409 "Email or username already in use"` para email y username repetidos, y `/auth/register` limitado a **5 por IP cada 10 minutos**. Coste de UX: el usuario no sabe cuál de los dos está ocupado. La app vuelve al paso del email y marca los dos campos. **Riesgo residual:** sin verificación por correo, combinar un email con un username aleatorio sigue revelando si el email existe; el límite frena el barrido, pero no lo elimina. La solución completa (responder 200 y mandar un correo) necesita infraestructura de correo que no existe.
2. **Compatibilidad:** 15 minutos para todos. No hay negociación por cabecera que mantenga 7 días a las APK viejas. Hay que publicar la APK nueva (B8) justo después del backend (ver §9).
3. **Duración de la sesión:** refresh de **30 días deslizantes**, sin tope absoluto. Quien abre la app al menos una vez al mes no vuelve a iniciar sesión.

Otras decisiones técnicas:

- **Reuso estricto:** si dos peticiones presentan a la vez el mismo refresh, una rota y la otra cuenta como reuso: la familia se revoca y el usuario tiene que volver a entrar. No hay periodo de gracia. La app evita el caso con single flight, pero si se pierde la respuesta de un refresh (red), el siguiente intento se trata como reuso. Está aceptado y documentado (e2e S2).
- **Logout sin red:** la sesión local se borra igualmente, pero la del servidor sigue viva hasta que vence (30 días) porque `/auth/logout` no llegó.
- Cuenta baneada o purgada: el refresh revoca su familia (`account`) y responde 401. El guard ya la cortaba en 30 s o menos.

## 8. Pruebas ejecutadas (resultados reales, 2026-10-23)

Entorno: macOS, Node 22, **Postgres 18 local** (`localhost`, base desechable `havit_b4_test` creada para B4 y migrada con `npm run db:migrate`: 66 archivos aplicados, incluida la migración nueva). Todos los `DB_*`, `DB_POOL_HOST=` y `REDIS_URL=` se pasaron explícitos para que no se usaran los valores de `.env`, y `JWT_SECRET` era un valor de prueba. **Nada contra Azure.**

| Comando | Resultado |
|---|---|
| Línea base antes de B4: `env -u B2_TEST_DB_URL npx jest --ci` | 62 suites ok (2 omitidas), 1049 pass, 4 skipped |
| `env -u B2_TEST_DB_URL npx jest --ci` (con B4) | **64 suites ok** (2 omitidas, requieren BD), **1115 pass**, 4 skipped, 0 fallos |
| `B2_TEST_DB_URL=… npx jest --ci integration` | 2/2 suites, **4/4** |
| `B2_TEST_DB_URL=… npm run test:e2e -- --ci` | **2/2 suites, 54/54** (28 existentes + 26 de B4 en `test/auth-sessions.e2e-spec.ts`) |
| `npm run build` | ok |
| `npx eslint src/auth` | Ningún error nuevo: los archivos nuevos no tienen ninguno; los modificados tienen el mismo número que antes (deuda previa `no-unsafe-*`) |
| `npx prettier --check src/auth test` | ok |

Cobertura de B4 en pruebas unitarias:

- `refresh-tokens.service.spec.ts`: solo se guarda el hash; 30 días exactos; **expiración con timers falsos** (válido a 30 d − 1 ms, inválido a 30 d); rotación con `FOR UPDATE`; reuso que revoca la familia y se confirma aunque la petición falle; cuentas baneadas o purgadas; el mismo mensaje para todos los fallos; logout; limpieza.
- `jwt-auth.guard.spec.ts`: `sid` en la misma consulta; sesión revocada → 401; `forgetSession` corta al instante; revocación hecha en otro lado se detecta tras 30 s (timers falsos); caché compartida entre instancias; un dispositivo no afecta a otro; `sid` no UUID; token viejo sin `sid`.
- `auth.service.spec.ts`: access token de 900 s con `sid`; un bcrypt siempre, exista o no el email; la misma respuesta para email desconocido y contraseña incorrecta; el aviso de desactivada solo con la contraseña correcta; el mismo 409 por email y por username; hash antes de buscar duplicados; refresh y logout.
- `password-policy.spec.ts` y `register.dto.spec.ts`: `password` y `12345678` (aceptadas antes de B4) se rechazan, junto con variantes con leetspeak y sufijos, identidad y 72 bytes.

E2E (`test/auth-sessions.e2e-spec.ts`, app completa y Postgres real):

- S1: claims (`exp - iat = 900`, `sid`) y que la BD no contiene el token.
- S2: cadena de rotación; **reuso** que revoca la familia y el access token más nuevo; dos refresh simultáneos (200 + 401).
- S3: **sesión cerrada que no se renueva con un token revocado** y cuyo access token cae al instante; las otras sesiones siguen; 204 idempotente.
- S4: token de 7 días sin `sid` válido y no renovable; vencido → 401; `sid` inventado → 401.
- S5: refresh vencido, cuenta baneada (`account`), limpieza (`make_interval`) contra Postgres real.
- P1: contraseñas débiles con su mensaje; el login sigue aceptando una contraseña vieja de 8 caracteres.
- E1: **el mismo estado y cuerpo** con email repetido y con username repetido; el mismo estado y cuerpo en el login con email inexistente y con contraseña incorrecta, con **tiempos medidos de 55.9 ms frente a 56.1 ms (ratio 1.00)**. La auditoría midió ~5 ms frente a ~66 ms antes de B4.
- T1: el sexto registro desde una IP en 10 minutos responde 429.

Integración real app ↔ backend: `frontend/services/auth/__tests__/sessionRefresh.integration.test.ts` contra este backend compilado y corriendo en `localhost:3999` sobre la misma base local, **5/5**. Ver el documento del frontend.

Para repetir (Postgres local):

```bash
createdb havit_b4_test
DB_HOST=localhost DB_PORT=5432 DB_USERNAME=$(whoami) DB_PASSWORD=x DB_DATABASE=havit_b4_test DB_SSL=false DB_POOL_HOST= npm run db:migrate
B2_TEST_DB_URL="postgres://$(whoami):x@localhost:5432/havit_b4_test" DB_POOL_HOST= REDIS_URL= JWT_SECRET=b4-local-test-secret npm run test:e2e -- --ci
dropdb havit_b4_test   # al terminar
```

No se probó: el despliegue real, la migración contra Azure, varias instancias del backend (la revocación entre instancias tarda ≤30 s según el diseño, sin verificar), ni un dispositivo físico con la APK.

## 9. Orden de integración y despliegue recomendado

1. Revisar y fusionar el backend B4 en `development`. CI (`tests.yml`) corre unitarias, integración y e2e con su propio Postgres.
2. Revisar y fusionar el frontend B4 en `development`. Es compatible con el backend viejo (§6), así que puede ir antes o a la vez.
3. **Antes de llevar el backend a `main`/Azure**, tener lista la APK con B4 (B8), porque desde ese momento los logins desde APK viejas duran 15 minutos.
4. Desplegar el backend: al arrancar, `db:migrate` aplica `2026-10-23-01-refresh-tokens.sql` (solo crea la tabla y los índices, sin tocar datos). Anotar la fecha en §6.
5. Publicar la APK B4 en cuanto el backend esté arriba.
6. A los 7 días del paso 4, quitar la rama sin `sid` del guard.

## 10. Dependencias y hallazgos fuera de alcance (no corregidos)

- **B3 (HTTPS):** mientras el API siga en HTTP, el access token y el refresh token viajan en claro. B4 limita el daño (15 minutos, revocación), pero no lo sustituye. La rama `frontend/feature/sprint10-b3-https` toca `services/api.ts` (líneas de la URL base); B4 cambia los interceptores de ese archivo, así que la fusión debería ser limpia.
- **B8 (builds):** APK nueva necesaria (§9).
- **B10 (`register.tsx`):** B4 solo cambió el mapa de errores por campo (`REGISTER_FIELD_ERRORS`) y su uso. El refactor debe conservarlo.
- **B11:** revisión formal de la decisión §7.1 y del reuso estricto.
- **Build:** `npm run build` genera `dist/src/main.js` (porque `database/importers/*.ts` también se compila), pero `npm start` ejecuta `node dist/main.js`. **Ya pasaba antes de B4** (verificado compilando `development` en un worktree temporal). B4 no depende del layout de `dist/`. Conviene revisarlo en la tarea de infraestructura.
- **No existe cambio ni recuperación de contraseña.** Al crearlos, aplicar `@IsAcceptablePassword()` y revocar sesiones.
- **M2b (fuerza bruta por cuenta):** sigue sin bloqueo por cuenta. Solo están los límites por IP (login 10/min, registro 5/10 min).
- `username` sigue sin reglas de formato, y el email no se normaliza (mayúsculas). No es B4.
- Los scripts `docs/security/scripts/*.mjs` y `scripts/verify-b5-concurrency.js` registran varias cuentas seguidas. Con el límite nuevo de `/auth/register` necesitan `THROTTLE_REGISTER_LIMIT` alto en su entorno de prueba (nunca en producción).
- La cuenta deshabilitada vía purga (B2) no borra sus filas de `refresh_tokens` en el momento. El refresh las rechaza (`account`) y la limpieza diaria las borra al vencer, y además el `ON DELETE CASCADE` las cubre si alguna vez se borra el usuario.
