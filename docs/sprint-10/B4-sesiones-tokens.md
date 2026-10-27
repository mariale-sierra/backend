# B4 — Sesiones, tokens y autenticación (Sprint 10)

Referencia principal de B4 para los dos repositorios. El documento hermano `frontend/docs/sprint-10/B4-sesiones-tokens.md` cubre solo la parte de la app. B4 corrige los hallazgos **M1** (JWT de 7 días sin revocación), **M2** (contraseñas débiles) y **M3** (enumeración de cuentas) de `docs/security/AUDITORIA-OWASP-Y-CARGA-2026-10-13.md`.

Este documento incluye las **correcciones posteriores a la auditoría independiente de B4** (§11). Entre ellas está la del defecto crítico B4-02-F01: un logout concurrente con una rotación dejaba viva la sesión.

> **Actualización 2026-10-27: B4 está en producción.** Entró a `main` con el PR #26 (`034d994`) y el job `deploy` terminó el **2026-10-24 06:02:25 UTC** (run *Deploy to server* de ese commit). El arranque aplica la migración con `db:migrate`. Verificado desde fuera de la VM: `POST /auth/refresh` → `400` y `POST /auth/logout` → `204` (antes eran `404`), y el registro rechaza `12345678` con "Password must be at least 10 characters" (`evidencias-b3/verificacion-produccion-2026-10-27.txt`). El texto de abajo describe el estado al 2026-10-23, antes del despliegue.

## 1. Estado de cada requisito

| # | Requisito | Estado | Dónde |
|---|---|---|---|
| 1 | Access token de 15 min + refresh opaco aleatorio guardado hasheado | ✅ | `src/auth/refresh-tokens.service.ts`, `src/auth/auth.service.ts` |
| 1 | Tabla de refresh tokens (user_id, family_id, token_hash, expires_at, revoked_at, replaced_by), más una fila por sesión | ✅ Migración preparada (no aplicada en Azure) | `database/migrations/2026-10-23-01-refresh-tokens.sql` |
| 1 | Rotación en cada uso; `POST /auth/refresh`, `POST /auth/logout` | ✅ | `src/auth/auth.controller.ts` |
| 1 | Limpieza de vencidos con `@nestjs/schedule` | ✅ Cron diario a las 04:00 | `RefreshTokensService.deleteExpired` |
| 1 | Front: un refresh (single flight) ante un 401 y un reintento; si falla, cierra sesión; sin segundo cliente Axios | ✅ Además, ligado a la sesión que lo inició (§11) | `frontend/services/api.ts`, `frontend/services/auth/sessionRefresh.ts` |
| 1 | Transición: los tokens de 7 días sin `sid` valen hasta vencer; fecha límite documentada | ✅ Ver §6 | `src/auth/guards/jwt-auth.guard.ts` |
| 2 | El logout revoca la familia; el reuso de un refresh rotado revoca la familia | ✅ **También con concurrencia** (demostrado contra Postgres, §8) | `RefreshTokensService` |
| 2 | Decidir y documentar si el guard valida el `sid` en la consulta cacheada de 30 s | ✅ Sí, ver §4 | `JwtAuthGuard.assertSessionUsable` |
| 3 | Validador compartido: mínimo 10, lista de comunes empaquetada, sin username/email | ✅ Más secuencias triviales y longitud en caracteres (§11) | `src/auth/password-policy.ts`, `src/auth/common-passwords.txt` |
| 3 | Aplicarlo donde se fije una contraseña; avisar si no existe cambio de contraseña | ✅ Solo existe el registro. **No hay endpoint de cambio ni de recuperación de contraseña** (`frontend/app/(auth)/recover-password.tsx` es un placeholder). | `RegisterDto` |
| 3 | Mensajes de contraseña específicos; ajustar `register.tsx` | ✅ | `frontend/app/(auth)/register.tsx` (cambio mínimo, B10 lo refactoriza) |
| 4 | `bcrypt.compare` contra un hash falso si el usuario no existe | ✅ Tiempos medidos iguales (§8) | `AuthService.login` |
| 4 | Mensaje de cuenta desactivada solo tras la contraseña correcta | ✅ | `AuthService.login` |
| 4 | Mismo mensaje y estado para email y username duplicados + throttle propio en `/register` | ✅ 409 único + 5 por IP cada 10 min | `AuthService.register`, `AuthController` |
| 4 | Decisión de producto confirmada y documentada | ✅ Ver §7 (falta la revisión formal de B11) | |
| 5 | Pruebas: expiración, rotación, reuso, logout, token revocado, contraseñas débiles, enumeración, e2e, **concurrencia** | ✅ Ver §8 | |

## 2. Flujo de tokens

```mermaid
sequenceDiagram
    participant App
    participant API as Backend (NestJS)
    participant F as refresh_token_families
    participant T as refresh_tokens
    App->>API: POST /auth/login {email, password}
    API->>F: INSERT familia F (expires +30 d)
    API->>T: INSERT hash(R1) en F
    API-->>App: accessToken A1 (15 min, sid=F) + refreshToken R1
    App->>API: GET /x (Bearer A1)
    API->>F: guard: ¿F sin revocar y sin vencer? (caché 30 s)
    API-->>App: 200
    Note over App: pasan 15 min
    App->>API: GET /x (Bearer A1)
    API-->>App: 401
    App->>API: POST /auth/refresh {R1} (uno solo aunque fallen varias)
    API->>F: SELECT … FOR UPDATE (bloquea la sesión)
    API->>T: SELECT R1 FOR UPDATE; INSERT R2; R1.replaced_by = R2
    API->>F: expires_at = +30 d (deslizante)
    API-->>App: A2 + R2
    App->>API: GET /x (Bearer A2): reintento único
    API-->>App: 200
    Note over App,API: Si alguien presenta R1 otra vez (reuso)
    API->>F: revoked_at (reason=reuse), y lo mismo en sus tokens
    API-->>App: 401 → la app cierra sesión
    App->>API: POST /auth/logout {R2}
    API->>F: UPDATE revoked_at (reason=logout): espera a una rotación en curso
    API-->>App: 204 (A2 deja de valer al instante en esta instancia)
```

En texto:

```
login/registro ──► familia F nueva + R1 (30 d) + A1 (15 min, sid=F)
401 con token ──► POST /auth/refresh R1 ──► bloquea F ──► R1 rotado → R2 + A2 ──► reintento único
reuso de R1   ──► bloquea F ──► F revocada (reuse) ──► 401 ──► la app cierra sesión
logout R2     ──► UPDATE de F (espera a cualquier rotación) ──► F revocada (logout) ──► 204
cuenta baneada/borrada ──► el refresh revoca F (account) y responde 401
```

Contratos (sin cambios con la corrección):

| Endpoint | Cuerpo | Respuesta | Errores |
|---|---|---|---|
| `POST /auth/login` (público, 10/min por IP) | `{ email, password }` | `200 { accessToken, refreshToken, user }` | `401 "Invalid email or password"` (igual exista o no el email); `401 "This account has been deactivated"` solo con la contraseña correcta |
| `POST /auth/register` (público, **5 por IP cada 10 min**) | `{ email, username, password, acceptTerms, confirmAge16 }` | `200 { message, accessToken, refreshToken, user }` | `400` con el mensaje de la regla de contraseña incumplida; `409 "Email or username already in use"`; `429` |
| `POST /auth/refresh` (público, 30/min por IP) | `{ refreshToken }` | `200 { accessToken, refreshToken, user }` | `401 "Invalid refresh token"` para cualquier fallo (desconocido, vencido, revocado, reusado, cuenta no utilizable); `400` si falta o pasa de 200 caracteres |
| `POST /auth/logout` (público) | `{ refreshToken? }` | `204` siempre | — |

`/auth/logout` es público a propósito: cerrar sesión tiene que funcionar con un access token ya vencido, y quien tiene el refresh token es quien puede revocar su sesión. Revoca la familia **sea cual sea el token de la cadena** que se presente.

Claims del access token: `{ sub, email, username, sid, iat, exp }`, donde `sid` es el id de la familia. Duraciones en `src/auth/refresh-tokens.service.ts` (`ACCESS_TOKEN_TTL_SECONDS = 900`, `REFRESH_TOKEN_TTL_DAYS = 30`).

## 3. Esquema

`database/migrations/2026-10-23-01-refresh-tokens.sql` es idempotente (`IF NOT EXISTS`). Crea dos tablas.

**`havit.refresh_token_families`**: una fila por sesión y **única fuente de verdad** de su estado.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `UUID PK` | El `sid` del access token |
| `user_id` | `UUID NOT NULL → users(id) ON DELETE CASCADE` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `expires_at` | `TIMESTAMPTZ NOT NULL` | Vencimiento deslizante: el del token vigente; cada rotación lo mueve a +30 días |
| `revoked_at` | `TIMESTAMPTZ NULL` | |
| `revoke_reason` | `TEXT`, `CHECK IN ('logout','reuse','account')` | `CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))` |

Índices: PK; `(user_id)` (cascada desde users); `(expires_at)` (limpieza).

**`havit.refresh_tokens`**: cada refresh token emitido.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `UUID PK DEFAULT gen_random_uuid()` | |
| `user_id` | `UUID NOT NULL → users(id) ON DELETE CASCADE` | |
| `family_id` | `UUID NOT NULL → refresh_token_families(id) ON DELETE CASCADE` | |
| `token_hash` | `CHAR(64) NOT NULL`, índice único | SHA-256 hex del token (256 bits aleatorios, así que basta un hash sin sal). El token en claro no se guarda nunca |
| `expires_at` | `TIMESTAMPTZ NOT NULL` | Emisión + 30 días |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `revoked_at`, `revoke_reason` | como en la familia | **Copia de auditoría** de la revocación de su familia, escrita en la misma transacción. Las decisiones se toman con la de la familia |
| `replaced_by` | `UUID NULL → refresh_tokens(id) ON DELETE SET NULL` | Token que lo sustituyó al rotar |

Índices: único en `token_hash`; `(family_id)`; **`(replaced_by)`**, necesario para que el `ON DELETE SET NULL` de la limpieza no recorra la tabla por cada fila borrada (B4-01-F03); `(user_id)`; `(expires_at)`.

**Sesión viva** = su fila de familia tiene `revoked_at IS NULL` y `expires_at > now()`.

**Orden de bloqueos (para todos los caminos): primero la familia, después sus tokens.**

- `rotate`: busca la familia del token sin bloquear; `SELECT … FROM refresh_token_families … FOR UPDATE`; vuelve a leer el token con `FOR UPDATE`; luego inserta el sucesor, marca `replaced_by` y desliza `expires_at`, todo en una transacción.
- Revocación (logout, reuso o cuenta): `UPDATE refresh_token_families … WHERE revoked_at IS NULL` y después `UPDATE refresh_tokens`.
- Limpieza: `DELETE` de familias vencidas (sus tokens caen en cascada) y, para tokens vencidos de familias vivas, bloquea antes la familia con `FOR UPDATE SKIP LOCKED`.

No hay entidad TypeORM: el servicio usa SQL directo, como `account-deletion.service.ts` y el guard.

**Migración corregida en su sitio:** el archivo original (una sola tabla) se reescribió antes de aplicarse en cualquier base compartida. Se verificó que solo estaba aplicado en `havit_b4_test`, la base local desechable de B4: no está en Azure ni en CI (nunca se hizo push), y no aparece en ninguna otra base local. Esa base se borró y se volvió a crear. **Si alguien aplicó la versión anterior en otra base desechable, debe recrearla:** el runner registra la migración por nombre de archivo y no volvería a ejecutarla.

## 4. Revocación y caché del guard

`JwtAuthGuard` valida el `sid` **en la misma consulta cacheada 30 s** que ya comprobaba `is_active`/`deleted_at`. Es una consulta por sesión cada 30 s:

```sql
SELECT u.is_active, u.deleted_at,
       EXISTS (SELECT 1 FROM havit.refresh_token_families f
               WHERE f.id = $2 AND f.user_id = u.id
                 AND f.revoked_at IS NULL AND f.expires_at > now()) AS session_active
FROM havit.users u WHERE u.id = $1
```

- La caché va por sesión (`s:<sid>`; los tokens antiguos sin `sid` usan `u:<userId>`). Es un `Map` a nivel de módulo, **compartido por todas las instancias del guard del proceso**: el `APP_GUARD` global y cada `@UseGuards(JwtAuthGuard)` crean la suya.
- Después de que una revocación se confirma, el servicio llama a `JwtAuthGuard.forgetSession(sid)`. Esto borra la entrada de la caché **y marca el `sid` como revocado localmente durante 60 s** (dos ventanas de caché). Mientras dura la marca, el guard rechaza ese `sid` sin consultar. Además, **no lo guarda en caché** aunque una consulta que empezó antes del commit responda "viva" (B4-02-F02). Pasados los 60 s, cualquier consulta nueva ya ve la revocación confirmada.
- **Ventana residual máxima:** 0 en la instancia que procesó la revocación; **hasta 30 s en cualquier otra instancia** (hoy solo hay una), porque la marca local no se comparte entre procesos. No se promete revocación inmediata entre instancias.
- Se rechaza sin consultar un `sid` que no sea UUID.
- **Riesgo heredado y aceptado:** si la base falla, el guard deja pasar la petición (comportamiento previo, para no cerrar todas las sesiones por un corte breve). Durante un corte, una sesión revocada en otra instancia podría seguir funcionando hasta que vuelva la base.

## 5. Política de contraseñas

`src/auth/password-policy.ts`, decorador `@IsAcceptablePassword()` en `RegisterDto`. Las reglas se aplican en este orden y cada una tiene su mensaje:

| Regla | Mensaje (en inglés en la API; la app lo traduce) |
|---|---|
| Mínimo **10 caracteres**, contados en code points (`[...password].length`) y no en unidades UTF-16: `🔥🍕🎉🚀🌙` son 5 | `Password must be at least 10 characters` |
| Máximo **72 bytes** UTF-8 (bcrypt ignora el resto); se comprueba aparte de la longitud | `Password must be at most 72 bytes` |
| No contener el `username` ni la parte local del email (sin distinguir mayúsculas, también deshaciendo el leetspeak; las partes de menos de 3 caracteres se ignoran) | `Password must not contain your username or email` |
| No ser trivial: menos de 4 caracteres distintos; **≥80 % de pares adyacentes repetidos o a un paso ±1** (alfabeto, dígitos con vuelta 9↔0 o teclas vecinas de una fila del teclado), también en posiciones pares e impares por separado (`q1w2e3r4t5y6`); o un **bloque repetido** (`1234512345`, `abcdabcdab`) | `Password is too common` |
| No coincidir con `src/auth/common-passwords.txt`, comparando la contraseña, su versión sin leetspeak y sin dígitos/símbolos en los extremos (`Password2024!`, `p@ssw0rd1234` → `password`) | `Password is too common` |

- La lista es propia del proyecto (463 entradas). No se descargó nada. Las secuencias numéricas ya no necesitan estar en la lista: las detecta la regla de patrones.
- La lista se busca junto al archivo compilado y después en `src/auth/`, porque `nest build` no copia archivos que no son TypeScript (§10). `AuthService.onModuleInit` la carga al arrancar: si falta, falla el arranque y no el primer registro.
- **La contraseña guardada no se normaliza** (ni NFC ni NFD). Normalizarla rompería el login de cuentas existentes cuyo texto no esté en NFC. Es un riesgo aceptado, no un defecto: la misma tecla produce la misma secuencia en el mismo dispositivo.
- **Solo se aplica al fijar una contraseña.** Hoy eso solo ocurre en el registro. El login no la aplica: las cuentas creadas con la regla vieja de 8 caracteres siguen entrando (probado en e2e). Cuando exista un endpoint de cambio o recuperación de contraseña, debe usar `@IsAcceptablePassword()` y revocar las demás sesiones (`RefreshTokensService`).
- La app replica las mismas reglas salvo la lista (§ documento del frontend).

## 6. Transición y fecha de retiro de los tokens de 7 días

- Un token emitido antes de B4 (`{sub, email, username}`, 7 días, **sin `sid`**) sigue pasando el guard con la comprobación de cuenta de siempre, **hasta que vence**.
- **No obtiene privilegios de renovación:** no es un refresh token. `/auth/refresh` lo rechaza (400 por longitud, o 401), y la app sin refresh token guardado cierra sesión al primer 401 sin intentar renovar.
- **Fecha límite = fecha y hora del despliegue del backend con B4 + 7 días.** Ejemplo: si entra en producción el 2026-10-26 a las 18:00 UTC, desde el **2026-11-02 a las 18:00 UTC** ya no queda ningún token de 7 días válido. **Despliegue: 2026-10-24 06:02 UTC → retiro: 2026-10-31 06:02 UTC.** Desde esa hora ya no queda ningún token de 7 días válido.
- Pasada esa fecha, se puede quitar la rama sin `sid` del guard.

| Backend \ App | App vieja (sin B4) | App con B4 |
|---|---|---|
| Backend viejo | Como hoy | Funciona: sin `refreshToken` guarda solo el access token y, al vencer (7 d), cierra sesión; el `/auth/logout` 404 se ignora |
| **Backend B4** | Las sesiones ya abiertas siguen hasta vencer; **un login nuevo dura 15 min** hasta que actualicen | ✅ |

## 7. Decisiones de producto (confirmadas el 2026-10-23)

Se presentaron antes de implementar y se eligió la opción recomendada en las tres. La primera se planteó como confirmación con **Ale Sierra (B11)**, y **B11 debe revisarla formalmente**.

1. **Enumeración en el registro:** el mismo `409 "Email or username already in use"` para email y para username, y `/auth/register` limitado a **5 por IP cada 10 minutos**. Riesgo residual: sin verificación por correo, combinar un email con un username aleatorio sigue revelando si el email existe. El límite frena el barrido, pero no lo elimina.
2. **Compatibilidad:** 15 minutos para todos. Hay que publicar la APK nueva (B8) justo después del backend.
3. **Duración de la sesión:** refresh de **30 días deslizantes**, sin tope absoluto.

Decisiones técnicas:

- **Reuso estricto:** dos refresh simultáneos con el mismo token producen una rotación y una revocación de la familia. Si se pierde la respuesta de un refresh, el siguiente intento cuenta como reuso. La app lo evita con single flight. Está aceptado y queda para que B11 lo revise.
- **Logout sin red:** la sesión local se borra, pero la del servidor sigue hasta que vence (30 días).
- **Cuenta baneada o purgada:** el refresh revoca su familia (`account`) y responde 401. El guard la corta en 30 s o menos.

## 8. Pruebas ejecutadas (resultados reales, 2026-10-23, tras las correcciones)

Entorno: macOS, Node 22, **Postgres 18 local** (`localhost`), con la base desechable `havit_b4_test` **recreada desde cero** con la migración corregida (`npm run db:migrate`: 66 archivos aplicados). Todos los `DB_*`, `DB_POOL_HOST=` y `REDIS_URL=` se pasaron explícitos para no usar `.env`, y `JWT_SECRET` era un valor de prueba. **Nada contra Azure.**

| Comando | Resultado |
|---|---|
| Línea base (antes de B4): `env -u B2_TEST_DB_URL npx jest --ci` | 62 suites ok (2 omitidas), 1049 pass, 4 skipped |
| `env -u B2_TEST_DB_URL npx jest --ci` | **65 suites ok** (3 omitidas: las de integración que necesitan BD), **1149 pass, 0 fallos**, 13 skipped |
| `B2_TEST_DB_URL=… npx jest --ci integration` | **3/3 suites, 13/13** (incluye las 9 de concurrencia de `refresh-tokens.integration.spec.ts`) |
| `B2_TEST_DB_URL=… npm run test:e2e -- --ci` | **2/2 suites, 55/55** (28 existentes + 27 de B4) |
| `npm run build` y `tsc --noEmit -p tsconfig.build.json` (TS 5.9 de `@nestjs/cli`) | ok |
| `eslint --no-fix` sobre los archivos de B4, comparado con `origin/development` | Ver la tabla siguiente |

Lint (errores/avisos, sin `--fix`). La versión anterior de este documento decía "ningún error nuevo", y no era cierto para los specs (B4-05-F02). Ahora:

| Archivo | Ahora | `origin/development` |
|---|---|---|
| Producción nueva (`refresh-tokens.service.ts`, `password-policy.ts`, DTOs) | 0 | (nuevo) |
| Producción modificada (`auth.service.ts`, `auth.module.ts`, `auth.controller.ts`, `jwt-auth.guard.ts`, decorador) | 0 / 0 / 3 / 8e+1w / 3 | 0 / 0 / 3 / 8e+1w / 3 (sin cambios) |
| `refresh-tokens.service.spec.ts`, `refresh-tokens.integration.spec.ts`, `password-policy.spec.ts`, `auth.controller.spec.ts`, `test/auth-sessions.e2e-spec.ts` | **0** | (nuevos) |
| `auth.service.spec.ts`, `jwt-auth.guard.spec.ts`, `register.dto.spec.ts`, `test/api-integration.e2e-spec.ts` | 16 / 3 / 0 / 49e+1w | 16 / 3 / 0 / 49e+1w (sin cambios) |

`tsc -p tsconfig.json` (que también incluye `test/`) da `TS2307` en los `await import()` dinámicos de las e2e (`module: nodenext`): uno ya existía en `api-integration.e2e-spec.ts` y la e2e de B4 tiene dos con la misma causa. Jest los compila con `tsconfig.spec.json` y las suites pasan.

**Reproducción del defecto crítico, antes y después** (`src/auth/refresh-tokens.integration.spec.ts`, evidencia en `docs/sprint-10/evidencias-b4/`):

- **Antes** (código y migración anteriores, mismo Postgres): `✕ a logout that runs while the same family is being rotated leaves no live successor` y `✕ a reuse detected while the head is being rotated revokes the successor too`, ambos con "Received promise resolved instead of rejected": el sucesor seguía rotando. 2 fallos de 7.
- **Después:** 9/9 en tres ejecuciones seguidas (`concurrencia-despues.txt`), y otra vez dentro de la ejecución completa de integración (13/13).

El intercalado es determinista. La rotación se detiene justo después de insertar el sucesor, todavía sin commit. Entonces se lanza el logout o el reuso, se espera a que Postgres lo muestre bloqueado (`pg_stat_activity.wait_event_type = 'Lock'`) y solo después se libera la rotación. Casos cubiertos:

1. Logout concurrente con una rotación: ningún token de la familia vuelve a rotar y el guard rechaza el `sid`.
2. Reuso concurrente con la rotación de la cabeza: el sucesor queda revocado.
3. Rotación que llega mientras un logout está sin confirmar: espera y recibe 401.
4. Dos refresh simultáneos: exactamente uno rota y la familia termina revocada.
5. Una familia revocada no vuelve: ningún token de la cadena renueva, antes ni después.
6. Dos sesiones del mismo usuario: revocar A durante una rotación de B deja viva a B.
7. Fallo a mitad de la rotación: nada queda confirmado a medias y el token sigue sirviendo.
8. 15 rondas de rotaciones, reusos y logouts mezclados sobre una familia: ningún deadlock ni otro error de BD, solo 401 uniformes, y la familia nunca queda viva.
9. El guard deja de aceptar la sesión revocada en este proceso sin esperar a que caduque su caché.

Más la e2e **S6** (por HTTP: controlador, servicio y guard) del mismo caso: el refresh retenido responde 200 y el logout 204, y después ni el refresh ni el access token nuevos valen (401).

Unitarias: expiración real del access token a los 15 minutos con un `JwtService` real (acepta a 15 min − 1 s y rechaza a los 15 min); la caché del guard ante una consulta en curso durante el logout; el orden de bloqueos (familia antes que token); las reglas nuevas de contraseña; y `THROTTLE_REGISTER_LIMIT` inválido (`''`, `abc`, `5x`, `-1`, `0`, `2.5`, `NaN`, `Infinity`) que vuelve a 5.

E1 (enumeración): mismo estado y cuerpo; login con email inexistente frente a contraseña incorrecta: **55.9 ms frente a 56.3 ms (ratio 0.99)** en la última ejecución (la auditoría de octubre midió ~5 ms frente a ~66 ms).

Integración real app ↔ backend: `frontend/services/auth/__tests__/sessionRefresh.integration.test.ts` contra este backend compilado y corriendo en `localhost:3999` sobre `havit_b4_test`: **5/5** tras las correcciones.

Para repetir (Postgres local):

```bash
createdb havit_b4_test
DB_HOST=localhost DB_PORT=5432 DB_USERNAME=$(whoami) DB_PASSWORD=x DB_DATABASE=havit_b4_test DB_SSL=false DB_POOL_HOST= npm run db:migrate
B2_TEST_DB_URL="postgres://$(whoami):x@localhost:5432/havit_b4_test" npx jest --ci integration
B2_TEST_DB_URL="postgres://$(whoami):x@localhost:5432/havit_b4_test" DB_POOL_HOST= REDIS_URL= JWT_SECRET=b4-local-test-secret npm run test:e2e -- --ci
dropdb havit_b4_test   # al terminar
```

No se probó: el despliegue real, la migración contra Azure, **varias instancias del backend** (la ventana de ≤30 s entre instancias es la del diseño y no está medida), ni un dispositivo físico con la APK.

## 9. Orden de integración y despliegue recomendado

1. Revisar y fusionar el backend B4 (con las correcciones) en `development`. CI (`tests.yml`) corre las unitarias, la integración (incluida la de concurrencia) y las e2e con su propio Postgres.
2. Revisar y fusionar el frontend B4 en `development`. Es compatible con el backend viejo, así que puede ir antes o a la vez.
3. **Antes** de llevar el backend a `main`/Azure, tener lista la APK con B4 (B8).
4. Desplegar el backend: al arrancar, `db:migrate` aplica `2026-10-23-01-refresh-tokens.sql` (solo crea las dos tablas y sus índices). Anotar la fecha en §6.
5. Publicar la APK B4 en cuanto el backend esté arriba.
6. A los 7 días del paso 4, quitar la rama sin `sid` del guard.

## 10. Dependencias y hallazgos fuera de alcance (no corregidos)

- **B3 (HTTPS):** mientras el API siga en HTTP, los tokens viajan en claro. La rama `frontend/feature/sprint10-b3-https` toca las líneas de la URL base de `services/api.ts`; B4 cambia los interceptores, así que la fusión debería ser limpia.
- **B8 (builds):** se necesita la APK nueva (§9).
- **B10 (`register.tsx`):** conservar `REGISTER_FIELD_ERRORS`.
- **B11:** revisión de la decisión §7.1 y del reuso estricto.
- **Build:** `npm run build` genera `dist/src/main.js`, pero `npm start` ejecuta `node dist/main.js`. **Pasaba antes de B4.** Hoy `raiz/docker-compose.yml` usa `npm run dev` (`nest start`, que encuentra `dist/src/main.js`). B4 no depende del layout.
- **No existe cambio ni recuperación de contraseña.**
- **M2b** (fuerza bruta por cuenta): sigue sin bloqueo por cuenta.
- `username` sin reglas de formato y email sin normalizar: no son de B4.
- Los scripts `docs/security/scripts/*.mjs` y `scripts/verify-b5-concurrency.js` registran varias cuentas seguidas y necesitan `THROTTLE_REGISTER_LIMIT` alto en su entorno de prueba (nunca en producción).
- **CGNAT:** 30 refresh por minuto por IP podría quedarse corto para muchos móviles detrás de la misma IP. Es un riesgo, no medido.

## 11. Correcciones posteriores a la auditoría independiente

| ID | Sev. | Defecto | Corrección | Prueba |
|---|---|---|---|---|
| B4-02-F01 | **Crítico** | Un logout o reuso concurrente con una rotación no revocaba el sucesor (READ COMMITTED: el `UPDATE … WHERE family_id` no veía la fila que insertaba la otra transacción) | Fila única por sesión (`refresh_token_families`); la rotación la bloquea `FOR UPDATE` antes del token y la revocación es un `UPDATE` de esa fila; orden familia → tokens en todos los caminos | `refresh-tokens.integration.spec.ts` (9 casos; los 2 críticos fallaban antes), e2e S6 |
| B4-01-F01 | Medio | Un refresh que respondía después del logout volvía a guardar tokens (o los de otra cuenta) | Época de sesión en la app (§ documento del frontend) | `sessionRefresh.test.ts` |
| Extra | Medio | Una petición de A podía repetirse con el token de B (`tokenForRetry`) | Misma época: un 401 de otra sesión se descarta sin refresh ni reintento | `sessionRefresh.test.ts` |
| B4-01-F02 | Medio | Al restaurar la sesión, un refresh fallido por red, 429 o 5xx borraba una sesión válida | El interceptor rechaza con el error del refresh, no con el 401 | `authRestoreSession.test.tsx`, `sessionRefresh.test.ts` |
| B4-05-F01 | Medio | Sin pruebas de concurrencia de revocación | Las de las filas anteriores | — |
| B4-03-F01 | Bajo | Se aceptaban secuencias triviales | Regla de patrones (§5), en backend y frontend | `password-policy.spec.ts`, `schemas.test.ts` |
| B4-03-F02 | Bajo | Longitud en unidades UTF-16 | Conteo en code points, en los dos lados | ídem |
| B4-01-F03 | Bajo | Faltaba el índice en `replaced_by` | `idx_refresh_tokens_replaced_by` | migración aplicada en limpio |
| B4-02-F02 | Bajo | Una consulta en curso volvía a cachear una sesión recién revocada | Marca local de revocación de 60 s, comprobada antes de consultar y antes de cachear | `jwt-auth.guard.spec.ts`, integración caso 9 |
| B4-05-F02 | Bajo | La afirmación sobre lint era inexacta | Specs nuevos sin errores; cifras reales en §8 | `eslint --no-fix` |
| Otros | — | Sin prueba de expiración real a los 15 min; `THROTTLE_REGISTER_LIMIT` no numérico daba NaN | Prueba con `JwtService` real; vuelta a 5 | `jwt-auth.guard.spec.ts`, `auth.controller.spec.ts` |
