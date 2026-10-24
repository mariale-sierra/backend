# Auditoría de seguridad (OWASP Top 10) y pruebas de inundación — 2026-10-13

Alcance: backend NestJS (`backend/`), app Expo (`frontend/`) y el pipeline de despliegue (`raiz/`, `.github/workflows`). Sigue al escaneo ZAP de B2 (2026-10-03, ver historial git de `docs/security/B2-SEGURIDAD-Y-LEGAL.md`) y lo amplía con pruebas autenticadas, lógica de negocio, dependencias y carga.

## 0. Estado de remediación (semana 1, 2026-10-13)

| Hallazgo | Estado | Qué se hizo |
|---|---|---|
| H2 `testuser` sembrado | **Corregido en código** (efecto en producción al desplegar) | El seed salió de `database/seeds/` y vive en `database/demo/` (solo `npm run db:demo`). La migración `2026-10-13-02-disable-seeded-testuser.sql` desactiva la cuenta y anula su hash **solo si todavía tiene la contraseña publicada** (no la borra). Opcional, a mano en la base real: `DELETE FROM havit.users WHERE email = 'testuser@havit.dev';` |
| H3 Retos sin sesión | **Corregido** | `GET /challenges`, `/challenges/:id` y `/challenges/:id/author` exigen JWT (401 sin token). **Decisión:** los retos privados siguen apareciendo en Explorar para usuarios con sesión, porque HU-18 ("solicitar el ingreso a uno privado") necesita que se puedan encontrar; ocultarlos de la lista exigiría otro mecanismo de descubrimiento (invitaciones/enlace). Queda como decisión de producto. |
| H4 `imageUrl` | **Corregido** | `@IsUrl(https)` + máx. 500 en el DTO; en el servicio, con `CLOUDFLARE_R2_PUBLIC_URL` configurado la URL debe estar bajo `<R2>/uploads/<tu userId>/`. La foto de perfil aplica la misma regla. Sin R2 configurado (local/tests) solo se exige https y longitud. |
| H5 Dependencias backend | **Parcial** | `npm audit fix` (solo lockfile): de 10 vulnerabilidades de producción (1 crítica, 5 altas) a 2 (`@nestjs/swagger` → `js-yaml`), cuyo arreglo exige subir `@nestjs/swagger` de versión mayor; queda para una tarea aparte. Frontend: pendiente (sección 6, punto 4). |
| M5 CORS / Swagger | **Corregido** | Sin `CORS_ORIGINS` ya no hay CORS (antes reflejaba cualquier origen). Swagger UI y `/api-docs-json` solo con `ENABLE_SWAGGER=true`. |
| M6 413 y 500 en registro | **Corregido** | Errores 4xx de Express (cuerpo grande) conservan su estado (413) y se registran como `warn` sin stack; el registro concurrente (correo o usuario repetido) devuelve 409 en lugar de 500. |
| H1 Sin HTTPS | **Parcial (B3, sprint 10)** | Caddy como proxy HTTPS con redirección 308 HTTP→HTTPS y certificado automático (`raiz/docker-compose.yml`, `raiz/caddy/Caddyfile`); `trust proxy` acotado (`TRUST_PROXY`); el APK de `preview`/`production` exige URL `https://` y sale con `usesCleartextTraffic=false`. **Falta infraestructura:** etiqueta DNS en Azure, abrir 80/443 en el NSG, publicar el APK HTTPS y después cerrar el 3000. Ver `docs/sprint-10/B3-https-transporte.md`. |
| M9 TLS a Postgres sin verificar | **Corregido en código (B3)** | Verificación de cadena y nombre activa por defecto en la app y el runner (`src/config/db-ssl.ts`, `database/scripts/lib.js`) con las raíces de Azure en `certs/azure-postgres-root-cas.pem`; PgBouncer en `verify-full`. Efecto en el servidor al desplegar `main`. |
| M1 JWT de 7 días sin revocación | **Corregido en código (B4, sprint 10)** | Access token de 15 min + refresh token opaco rotativo (hash en `havit.refresh_tokens`), `POST /auth/refresh`, `POST /auth/logout`, revocación de la familia en logout y en reuso, `sid` validado por `JwtAuthGuard`. Los tokens de 7 días ya emitidos valen hasta vencer (despliegue + 7 días). Ver `docs/sprint-10/B4-sesiones-tokens.md`. |
| M2 Contraseñas débiles | **Corregido en código (B4)** | Mínimo 10, máximo 72 bytes, lista de comunes empaquetada, sin username/email, en el registro (no existe cambio de contraseña). **M2b** (bloqueo por cuenta) sigue pendiente. |
| M3 Enumeración | **Parcial (B4)** | Login: bcrypt contra hash falso (tiempos iguales medidos) y aviso de cuenta desactivada solo con contraseña correcta. Registro: un 409 único para email/username + 5 registros por IP cada 10 min; sin verificación por correo, el riesgo residual queda documentado. La búsqueda con `%` (A03-02) no es B4. |
| M4, M7–M8 | Pendientes | Ver plan (sección 6). |

**Despliegue — qué cambia en el servidor:** (1) Swagger desaparece hasta definir `ENABLE_SWAGGER=true` en el `.env` del servidor; (2) CORS queda apagado: si se publica una versión **web** de la app, hay que definir `CORS_ORIGINS=https://tu-dominio`; la app móvil no se ve afectada; (3) la migración desactiva `testuser` al arrancar; (4) quien consuma esos tres endpoints de retos sin token (scripts, Postman) ahora recibe 401.

## 1. Cómo se probó (y qué NO se probó)

| Qué | Cómo |
|---|---|
| Backend bajo prueba | Compilado desde `development` (con la penalización por suspensión y la corrección de BUG-04), ejecutado en **localhost**, con Postgres 17 desechable + `db:migrate` + `db:demo`, **sin** el `.env` real (sin R2, OpenAI ni Redis) y con un `JWT_SECRET` de prueba. **No se tocó Azure ni el servidor de producción.** |
| Pruebas dinámicas de seguridad | 88 comprobaciones automatizadas con 4 usuarios (normal, privado, ajeno, admin). Script: `docs/security/scripts/security-probe.mjs`; resultados crudos: `security-probe-results-2026-10-13.json`. Los veredictos del script se **revisaron a mano** (algunos "FINDING" crudos son por diseño o no concluyentes y están reclasificados abajo). |
| Inundación / carga | `autocannon` contra dos instancias locales: una con los límites por defecto (lo que corre en producción) y otra con el limitador desactivado para medir capacidad bruta. Script: `docs/security/scripts/flood-probe.mjs`. |
| Estático | `npm audit` (backend y frontend, dependencias de producción), búsqueda de secretos en los 3 repos, revisión de `Dockerfile`, `docker-compose`, `deploy.yml`, `tests.yml`, configuración de CORS/Swagger/JWT/subidas y de almacenamiento de tokens en la app. |

**No cubierto / limitaciones (importante):**

- Los números de carga son de un portátil con base local; **no representan a producción** (Azure PostgreSQL, red real, VM). Sirven para comparar endpoints entre sí y para ver cómo se comporta el limitador. **No se debe repetir una prueba de inundación contra producción.**
- No se ejecutó ZAP otra vez ni se analizó el binario móvil (APK/IPA), ni certificate pinning, ni jailbreak/root detection.
- Configuración real de producción desconocida: longitud del `JWT_SECRET` de producción (el local tiene 128 caracteres, bien), si `CORS_ORIGINS` está definido, si hay Redis, reglas de red de Azure PostgreSQL, ni si el usuario `testuser` existe en la base real.
- No se probaron las integraciones externas (R2 real, OpenAI real).

## 2. Resumen ejecutivo

**Lo que está bien** (probado, no solo leído): ningún SQL injection en 9 payloads sobre búsqueda, 5 sobre ids de ruta y el cursor; las ~20 pruebas de IDOR (logs, posts, comentarios, reacciones, chats, rutinas, unirse a retos privados, registrar progreso sin membresía) responden 401/403/404; todas las rutas de admin devuelven 403 a un usuario normal; el mass-assignment (`is_admin` en registro y en perfil) se rechaza con 400; JWT con `alg: none` y firmado con 10 secretos comunes se rechaza; no se filtran hashes ni correos en perfiles ni en la búsqueda; los errores no filtran stack traces; `TRACE` y `X-Powered-By` no existen; el limitador de login corta en el intento 11 y **no** se puede saltar con `X-Forwarded-For`.

**Lo que hay que arreglar primero:**

| # | Severidad | Hallazgo | OWASP |
|---|---|---|---|
| H1 | Alta | El API sigue en **HTTP sin cifrar** (correo, contraseña y JWT de 7 días viajan en claro) | A02 / A05 |
| H2 | Alta | Cuenta sembrada **`testuser` / `TestHavit123!`** con la contraseña en el repo; los `seeds/` se aplican en cada arranque, también en producción | A05 / A07 |
| H3 | Alta | **Retos privados visibles sin iniciar sesión** (`GET /challenges`, `/challenges/:id`, `/challenges/:id/author` son públicos y no filtran los privados) | A01 |
| H4 | Alta | `imageUrl` de un progreso acepta **cualquier cadena** (`file://`, `javascript:`, `http://169.254.169.254`, hosts internos) y se muestra a otros usuarios y se manda a OpenAI | A10 / A03 / A04 |
| H5 | Alta | **Dependencias con vulnerabilidades**: backend 10 (1 crítica, 5 altas), frontend 29 (1 crítica, 17 altas, casi todas herramientas de desarrollo) | A06 |
| M1 | Media | JWT de 7 días **sin revocación ni logout en el servidor**; sin refresh tokens | A07 |
| M2 | Media | Políticas de contraseña débiles (`password` y `12345678` se aceptan) y sin bloqueo por cuenta | A07 |
| M3 | Media | Enumeración de usuarios (registro dice "Email already in use"; el login tarda 66 ms si el correo existe vs 5 ms si no; la búsqueda con `%` lista a todos) | A07 / A01 |
| M4 | Media | URL prefirmada de subida **sin límite de tamaño ni tipo vinculado**; bucket público | A04 / A05 |
| M5 | Media | CORS refleja **cualquier origen** si `CORS_ORIGINS` no está definido; **Swagger UI/JSON público** (mapa completo de 105 rutas) | A05 |
| M6 | Media | Un cuerpo demasiado grande devuelve **500** (no 413) y escribe un `ERROR` con stack por petición; el registro concurrente con el mismo correo devuelve 500 | A04 / A05 |
| M7 | Media | Sin trazabilidad de seguridad: el log HTTP no incluye usuario, IP ni id de petición; sin alertas por fallos de login | A09 |
| M8 | Media | Pipeline: migraciones **y seeds** automáticos en producción, despliegue en `main` sin exigir pruebas, `docker-compose down/up` con caída del servicio, imagen Docker como root | A05 / A08 |
| M9 | Media | TLS a la base de datos **sin validar el certificado** por defecto (`DB_SSL_REJECT_UNAUTHORIZED=false`) | A02 |
| L* | Baja | Ver sección 4 | — |

## 3. Hallazgos por categoría OWASP Top 10 (2021)

Cada hallazgo: **evidencia → impacto → solución**. Los ids corresponden a las pruebas del script.

### A01 — Control de acceso roto

**H3 — Retos privados expuestos sin token (A01-02/04/05, FINDING).**
- Evidencia: `GET /challenges` (sin `Authorization`) devuelve 200 y la lista contiene el nombre del reto privado `secret club`; `GET /challenges/:id` y `/:id/author` también devuelven 200 sin token. Ya estaba anotado como R-06 en el handoff de B8 y como "gap conocido" en el documento de B2.
- Impacto: cualquiera en internet puede listar y leer nombre, descripción y creador de retos que sus dueños marcaron privados; sirve además para enumerar usuarios.
- Solución: (1) en `ChallengesService.findAll` filtrar `visibility = 'public'` para quien no sea miembro (y exigir sesión en el listado); (2) en `GET /challenges/:id` y `/:id/author`, si el reto es privado, requerir ser miembro o tener solicitud, devolviendo 404 al resto; (3) dejar públicos solo los retos públicos si se quiere conservar la vista previa sin sesión. Añadir prueba e2e (en R11/R12 hay patrón).

**A01 sin hallazgos (PASS):** 25 comprobaciones — IDOR en logs, posts, comentarios, reacciones, chats, rutinas; rutas de admin; unirse a un reto privado exige solicitud; BUG-04 (progreso sin membresía) cerrado.

**Decisiones de producto pendientes (INFO):** `GET /routine/:id` lo puede leer cualquier usuario autenticado (probablemente por compartir rutinas en retos: confirmar); un perfil privado muestra a extraños nombre, foto y contadores de seguidores (por diseño; posts, badges y listas sí se ocultan).

### A02 — Fallos criptográficos

**H1 — Sin HTTPS (A02-08).**
- Evidencia: `app.config.js` apunta a `http://20.63.84.1:3000`; el servidor envía HSTS pero el navegador/SO lo ignora sobre HTTP. Para que el APK de prueba funcione se habilitó `usesCleartextTraffic` en el build (`app.json`), lo que fija la dependencia con este hallazgo.
- Impacto: cualquiera en la misma red (cafetería, datos móviles hostiles) puede robar contraseñas y tokens y suplantar cuentas durante 7 días.
- Solución: dominio + certificado (Let's Encrypt con un proxy como Caddy/Nginx, Cloudflare delante de la IP, o Azure Front Door); cambiar `EXPO_PUBLIC_API_URL` a `https://`; después **quitar** `usesCleartextTraffic` de `app.json`; configurar `trust proxy` en Nest solo hasta el salto confiable.

**M9 — TLS a Postgres sin verificar certificado.** `rejectUnauthorized` es `false` salvo que `DB_SSL_REJECT_UNAUTHORIZED === 'true'`. Un atacante en la ruta VM→Azure podría interponerse. Solución: descargar el CA de Azure, montarlo y activar la variable.

**Bien:** JWT HS256 (`alg:none` rechazado; 10 secretos comunes rechazados), secreto local de 128 caracteres, bcrypt cost 10 (aceptable; pasar a 12 con el tiempo), sin hash ni correo en las respuestas. **Bajo:** el payload del JWT lleva `email` (no es secreto pero no hace falta).

### A03 — Inyección

- 9 payloads de SQLi/NoSQLi/plantillas en `/users/search`, 5 en ids de ruta, 1 en `cursor`, 1 de operadores en el login: **ninguno** provocó error 5xx, retardo (`pg_sleep`) ni datos extra. TypeORM y las consultas SQL propias usan parámetros.
- **L1 — Comodines `LIKE` sin escapar (A03-02):** en `UsersService.search` el texto va como `ILike('%' + q + '%')`; `q=%` o `q=_` devuelve a todos los usuarios (paginado) y fuerza escaneos. Solución: escapar `\ % _` antes de armar el patrón y exigir ≥2 caracteres.
- **Patrón frágil (buena práctica, no vulnerabilidad hoy):** `WorkoutPostsService` arma SQL concatenando fragmentos (`${moderationFilter}`, `${visibilityFilter}`, `${this.reportedByViewerFilter(...)}`). Hoy todos los valores van en parámetros `$n`, pero un descuido al editar abre una inyección. Solución: query builder o un ayudante tipado que solo acepte fragmentos constantes, y la prueba e2e R13 como red.
- XSS almacenado: el API devuelve el texto tal cual (`<script>` en un caption). Es correcto para una API JSON y React Native lo muestra como texto; un futuro cliente web debe escapar.

### A04 — Diseño inseguro

- **H4 / M4 (A10-01, FINDING ×5):** `imageUrl` (`CreateWorkoutProgressDto`) solo exige `@IsString`. Se aceptaron con 201: `http://169.254.169.254/latest/meta-data/`, `file:///etc/passwd`, `javascript:alert(1)`, `ftp://evil.example/x`, `http://localhost:5432/`. Impacto: un usuario puede publicar contenido alojado en su propio servidor (evita el flujo de subida y parte de la moderación), usar píxeles de rastreo contra quien vea su post (fuga de IP/horario de los seguidores) o apuntar a recursos internos; esa URL se envía al servicio de moderación de OpenAI. Solución: aceptar solo URLs que empiecen por `CLOUDFLARE_R2_PUBLIC_URL + '/uploads/' + <userId> + '/'`, con `@IsUrl({protocols:['https']})` y longitud máxima. (La foto de perfil ya valida y rechaza `javascript:` — misma regla.)
- **M4 — Subida prefirmada (revisión de código, `UploadsService.getPresignedUrl`):** el `PutObjectCommand` no fija `ContentType` ni `ContentLength`; el MIME solo se valida al pedir la firma, no al subir. Se puede subir cualquier bytes/tamaño con la URL firmada de 5 minutos, y el bucket es público por clave. Solución: `createPresignedPost` con condiciones (`content-length-range`, `Content-Type` exacto) o firmar `ContentType` y comprobar tamaño/magic bytes tras la subida; bucket privado con URLs de lectura firmadas para posts privados.
- **M6a — Cuerpo grande (A04-01):** 2 MB a `/auth/login` → **500** `{"message":"Internal server error"}` y un `ERROR … PayloadTooLargeError` con stack en el log por cada petición (F9: 860 peticiones, todas 500, p99 1,4 s con 20 conexiones). El límite de 100 kb funciona, pero se traduce mal. Solución: el filtro de excepciones debe respetar `err.status/statusCode` de `http-errors` (413) y registrar a nivel `warn` sin stack; fijar el límite explícitamente (`json({ limit: '100kb' })`).
- Bien: comentario de 100 000 caracteres → 400; `limit=999999999` → 400; `routineId` negativo → 400; ids malformados → 400.

### A05 — Configuración de seguridad incorrecta

- **H2 — Cuenta sembrada con contraseña conocida (A05-07, A07-09):** `database/seeds/2026-07-21-01-test-user.sql` crea `testuser@havit.dev` con la contraseña `TestHavit123!` (visible en el repo) y `db:migrate` ejecuta `seeds/` en cada arranque del contenedor, incluido el de Azure. (En la prueba el login con esas credenciales devolvió 429 por el limitador, pero el usuario existe.) Solución: eliminar ese seed del flujo automático (el mecanismo `database/demo/` + `npm run db:demo` ya existe para datos de prueba), borrar o desactivar la cuenta en la base real y cambiar cualquier contraseña reutilizada.
- **M5 — CORS y Swagger:** `Origin: https://evil.example` es reflejado en `Access-Control-Allow-Origin` si `CORS_ORIGINS` no está definido (la app móvil no usa CORS y los tokens son Bearer, así que el impacto directo es bajo, pero es una puerta abierta si algún día hay cookies o un cliente web). `GET /api-docs` y `/api-docs-json` son públicos (105 rutas con su contrato). Solución: definir `CORS_ORIGINS` en producción, y servir Swagger solo si `NODE_ENV !== 'production'` o detrás de autenticación básica.
- **M8 — Imagen y despliegue (revisión de archivos):** ver sección 5.
- Bien: `helmet` con CSP `default-src 'none'`, COEP/COOP/CORP, Permissions-Policy, `Cache-Control: no-store`, sin `X-Powered-By`, `TRACE` → 404, errores sin stack.

### A06 — Componentes vulnerables

**H5 — `npm audit --omit=dev`:**

| Repo | Total | Crítica | Alta | Notas |
|---|---|---|---|---|
| backend | 10 | 1 | 5 | `proxy-addr` (suplantación de IP; solo explotable si se activa `trust proxy`, hoy no), `@nestjs/platform-express`/`multer` (DoS, el API no recibe multipart), `ws`, `js-yaml`, `brace-expansion` (DoS), `qs`, `typeorm` (SQLi en MySQL en `orderBy`; la BD es PostgreSQL), `body-parser` |
| frontend | 29 | 1 (`shell-quote`) | 17 | Casi todo es herramienta de desarrollo (`expo`, `metro`, `@expo/cli`, `braces`, `micromatch`): afecta a las máquinas de desarrollo, no al APK. Directas: `expo`, `react-native` |

Solución: `npm audit fix` en el backend (los arreglos existen, probar con la suite), actualizar `@nestjs/*` y `typeorm`; en el frontend subir Expo/RN al parche que corrija la cadena y volver a auditar; añadir `npm audit --audit-level=high` y Dependabot al CI.

### A07 — Fallos de identificación y autenticación

- **M1 — Sin revocación (A07-08):** no existe `POST /auth/logout`; el cierre de sesión es solo local, y un token robado sigue valiendo hasta 7 días (la baneada/borrada sí se corta en ≤30 s por la comprobación en `JwtAuthGuard`). Solución: access token de 15–30 min + refresh token rotativo guardado hasheado en BD, y revocar al cerrar sesión/cambiar contraseña.
- **M2 — Contraseñas (A07-04):** solo `MinLength(8)`; se aceptaron `password` y `12345678`. Solución: mínimo 10–12 caracteres, rechazo de contraseñas comunes/filtradas (lista local o HIBP con k-anonymity) y medidor en la app.
- **M2b — Fuerza bruta (A07-05/06):** el límite de 10 intentos/min **por IP** funciona (intento 11 → 429) y no se evade con `X-Forwarded-For`. Pero no hay bloqueo ni retraso por cuenta: un atacante con muchas IPs puede adivinar la contraseña de una cuenta concreta sin freno. El almacenamiento es en memoria si no hay Redis (se reinicia con cada despliegue). Solución: contador por correo (Redis) con retraso progresivo/CAPTCHA, y avisar al usuario ante intentos fallidos.
- **M3 — Enumeración:** `POST /auth/register` con un correo existente responde 409 "Email already in use" (A07-03); el login de un correo existente tarda ~66 ms frente a ~5 ms de uno inexistente porque `bcrypt.compare` solo corre si el usuario existe (A07-02); la búsqueda con `%` devuelve a todos los usuarios (A03-02). Mensajes de login iguales para ambos casos (bien). Solución: comparar siempre contra un hash falso; en registro, mismo mensaje genérico + correo de verificación; exigir ≥2 caracteres de búsqueda.

### A08 — Fallos de integridad de software y datos

- CI (`tests.yml`) ejecuta pruebas con Postgres desechable en cada push (bien), pero `deploy.yml` se dispara con cualquier push a `main` **sin depender** de que esas pruebas hayan pasado, y las acciones de GitHub están fijadas por etiqueta (`@v4`), no por SHA.
- La imagen se construye con `npm install --legacy-peer-deps` (no usa el lockfile de forma estricta) y copia el código fuente completo, `devDependencies` incluidas.
- Subidas: el servidor solo permite `image/jpeg|png|webp` al firmar (probado: `text/html` → 400), pero no verifica el contenido real (ver M4).
- Solución: `needs`/protección de rama para exigir `tests` antes de `deploy`; `npm ci`; imagen multi-etapa; fijar acciones por SHA; firmar/escanear la imagen (Trivy).

### A09 — Fallos de registro y monitorización

- **M7:** `LoggingInterceptor` registra `método ruta estado duración`, sin usuario, IP ni id de petición (p. ej. `POST /auth/login 401 +53ms`), de modo que un ataque de fuerza bruta o un abuso no se puede atribuir ni correlacionar. No hay eventos de seguridad (login fallido, 403, suspensión, baneo), alertas, ni envío centralizado de logs.
- Solución: añadir `requestId`, `userId` (cuando hay) e IP al log; eventos `security.*` para login fallido/403/429; reenviar a Azure Monitor/Log Analytics y alertar por picos de 401/429/5xx.
- Bien: no se registran cuerpos ni tokens en el backend.

### A10 — Falsificación de peticiones del lado del servidor (SSRF)

- El servidor **no descarga** URLs enviadas por el usuario (no se halló SSRF directo). Pero `imageUrl` se reenvía a OpenAI para moderación y se guarda sin validar (ver H4), por lo que el riesgo es de contenido/rastreo y de futura SSRF si alguien añade una descarga (miniaturas, compresión) usando ese campo. La solución de H4 lo cierra.

## 4. Pruebas de inundación y resistencia

Entorno: portátil, un proceso Node, Postgres local, sin Redis. Cada fila es una prueba de 10–15 s.

| Prueba | Conexiones | Resultado |
|---|---|---|
| **Producción simulada (límites por defecto: 300 peticiones/min/IP)** | | |
| F1 `GET /` sin token | 100 | ~3 300 req/s; **300 respondidas 200 y 35 995 rechazadas 429** (el limitador corta en la petición 301); latencia media 30 ms, p99 65 ms; 0 errores 5xx. Salud inmediata tras la prueba: 429 en 12 ms (la IP seguía bloqueada) |
| F2 login con contraseña mala | 50 | ~3 100 req/s; 31 277 respuestas 4xx (casi todas 429; el limitador permite 10 intentos por minuto); p99 22 ms; el servidor siguió sano (200 en 7 ms). **Un atacante con una sola IP no puede forzar el login** |
| F3 `GET /feed` autenticado | 100 | ~2 300 req/s; 300 × 200, 25 374 × 429; 0 × 5xx |
| **Capacidad bruta (limitador desactivado: ataque distribuido o muchas personas tras una misma IP/NAT)** | | |
| F4 `GET /feed` autenticado | 100 (15 s) | **964 req/s**, media 103 ms, p99 175 ms, 0 errores |
| F5 `GET /workout-posts/mine` (historial completo) | 100 | 1 132 req/s, p99 123 ms (con pocos datos; crece con el historial) |
| F6 `GET /challenges` público | 100 | **474 req/s**, media 209 ms, p99 321 ms — el endpoint más caro y además sin autenticación |
| F7 `GET /users/search?q=%` | 100 | 523 req/s, p99 255 ms |
| F8 `POST /auth/register` con correo repetido | 30 | 13 335 peticiones: 1 × 200, 13 305 × 4xx, **29 × 500** (condición de carrera: dos inserciones concurrentes del mismo correo → violación de unicidad sin traducir) |
| F8b 300 registros únicos simultáneos | 300 | 263 × 200 y 37 conexiones fallidas del lado del cliente, 5,9 s en total; la salud del servidor llegó a 545 ms (bcrypt ocupa el hilo del pool). ≈50 altas/s |
| F9 cuerpo de 2 MB | 20 (8 s) | 860 peticiones, **todas 500** (debería ser 413), p99 1,4 s |

**Interpretación**

1. **El limitador protege bien contra un solo atacante** (3 000+ req/s rechazados en ~1 ms sin afectar a los demás), y no se evade con cabeceras falsas.
2. **No protege contra un ataque distribuido**: el límite es por IP y por instancia; con 300 req/min/IP, unas cuantas decenas de IPs bastan para saturar los endpoints caros (`/challenges` ≈ 470 req/s por proceso en este equipo). No hay límite por usuario autenticado, ni WAF/CDN, ni autoescalado (un solo contenedor).
3. **Riesgo de "vecino ruidoso"**: si en el futuro se pone un proxy/CDN delante **sin** configurar `trust proxy`, todos los usuarios compartirán una IP y un solo cliente puede dejar sin servicio a los demás (300 req/min en total); si se configura mal, el limitador se vuelve evadible.
4. El registro es costoso (bcrypt) y público: 300 altas en 6 s degradaron la latencia general. Conviene un límite propio más bajo en `/auth/register` (hoy solo el global de 300/min) y verificación de correo.
5. Mejoras de resiliencia: caché del listado público (`/challenges` ya tiene caché si hay Redis; en producción confirmar `REDIS_URL`), límites por usuario, `limit` máximo en búsquedas, y tiempo de espera de consultas (`statement_timeout`).

## 5. Lista de malas prácticas detectadas

**Seguridad y configuración**
1. Contraseña de una cuenta de prueba escrita en el repositorio y sembrada automáticamente en todos los entornos (`database/seeds/2026-07-21-01-test-user.sql`).
2. Producción en HTTP plano con la IP del servidor escrita en el código (`app.config.js`, `app.json`, `main.ts` `PUBLIC_API_URL`).
3. Permitir tráfico HTTP sin cifrar en el APK de release (`usesCleartextTraffic`) como parche en lugar de resolver HTTPS.
4. Valores "seguros por omisión" invertidos: CORS permite todo si falta la variable; `DB_SSL_REJECT_UNAUTHORIZED` desactivado por defecto; Swagger siempre encendido.
5. Tokens de 7 días sin revocación; el logout no hace nada en el servidor.
6. Validar solo la forma y no el origen de datos que luego se muestran a otros (`imageUrl` como `@IsString`).
7. Archivo `.env` rastreado por git en `frontend/` (hoy solo tiene la URL pública, pero invita a meter secretos allí). Confirmar que `backend/.env` sigue ignorado (lo está; no hay historial de `.env`).
8. Mensajes de error y tiempos de respuesta distintos para "existe / no existe" en registro y login.
9. Ausencia de límite por cuenta y de bloqueo progresivo; limitador en memoria que se reinicia con cada despliegue.

**Backend y datos**
10. Construcción de SQL por concatenación de fragmentos (`WorkoutPostsService`) aunque hoy esté parametrizada.
11. Servicios gigantes: `challenges.service.ts` (1 724 líneas), `workout-posts.service.ts` (1 209), `exercises.service.ts` (859), `users.service.ts` (710), `workout-log.service.ts` (686): difíciles de revisar y de probar; los errores de lógica de negocio (p. ej. BUG-04) se esconden ahí.
12. Excepciones de infraestructura que se convierten en 500 sin traducir (cuerpo grande, unicidad en registro concurrente).
13. Migraciones y datos semilla ejecutados automáticamente en cada arranque contra la base compartida (sin ventana de mantenimiento, sin copia previa, y con riesgo de carrera si hubiera dos réplicas).
14. Artefactos de compilación versionados (`tsconfig.build.tsbuildinfo`, `swagger.json`) que ensucian cada `nest build`.
15. Lint con reglas relajadas (`no-explicit-any` apagado, `no-floating-promises` solo como aviso) y ~330 avisos preexistentes de `no-unsafe-*`.
16. Comentarios largos tipo bitácora ("real, reported bug…") dentro del código: documentan la historia en lugar del contrato y aumentan el ruido.

**Infraestructura y proceso**
17. `Dockerfile`: imagen completa `node:20`, proceso como **root**, `npm install --legacy-peer-deps` en lugar de `npm ci`, sin multi-etapa (se envían fuentes y devDependencies), sin `HEALTHCHECK`, `npm start` como proceso 1 (no recibe bien las señales) y migraciones dentro del arranque.
18. `deploy.yml`: despliega en cada push a `main` sin esperar a las pruebas, `docker-compose down` + `up` (caída del servicio en cada despliegue), sin rollback ni versionado de imágenes, en un runner autoalojado dentro del servidor de producción.
19. Acciones de CI fijadas por etiqueta, sin escaneo de dependencias ni de imagen.
20. Remotos y copias paralelas (`claude-copy`) y ramas viejas (`feature/challenge-roles`, `fix/challenge-integration-bugs`) sin limpiar.
21. Sin logging estructurado ni correlación de peticiones; sin alertas.

**Frontend**
22. `console.log` de payloads completos en producción (15 llamadas; p. ej. `uploadImageAsync` imprime la URL firmada y respuestas de `/uploads/sign`, `adaptChallengesForMetrics` imprime contratos enteros): llegan a los logs del dispositivo. Usar un wrapper de log y `babel-plugin-transform-remove-console` en release.
23. Archivos de pantalla de 600–800 líneas (`register.tsx` 789, `routine/[day].tsx` 662, `spaces/[id]/index.tsx` 654, `camera.tsx` 618) mezclando UI, estado y red.
24. 27 usos de `any` en código de producción que anulan `strict: true`.
25. URL del API fija en el código con la IP del servidor (configuración por entorno solo vía `EXPO_PUBLIC_API_URL`).
26. Dependencias de herramientas con vulnerabilidades altas sin plan de actualización y `--legacy-peer-deps` obligatorio para instalar (conflictos de pares ocultos).
27. Estado en memoria compartido entre sesiones (corregido hoy con `resetSessionStores`; revisar cualquier nuevo store).

## 6. Plan de remediación sugerido

**Esta semana (impacto alto, esfuerzo bajo/medio)**
1. Borrar `testuser` de la base real, sacar el seed del flujo automático. (H2, ~1 h)
2. Validar `imageUrl` contra el dominio R2 y la carpeta del usuario; límite de longitud. (H4, ~2 h con pruebas)
3. Filtrar retos privados en `GET /challenges`, `/:id`, `/:id/author`. (H3, ~3 h con e2e)
4. `npm audit fix` backend + prueba completa; plan para Expo/RN. (H5, ~2 h)
5. Mapear 413 y errores de unicidad en el registro a respuestas correctas; bajar el nivel del log. (M6, ~1 h)
6. Definir `CORS_ORIGINS` y apagar Swagger en producción. (M5, ~30 min)

**Siguiente sprint**
7. HTTPS con dominio y proxy; luego retirar el permiso de HTTP en Android. (H1)
8. Política de contraseñas, límite de `/auth/register`, mensajes y tiempos uniformes. (M2, M3)
9. Access + refresh token con revocación y endpoint de logout. (M1)
10. Subida con `content-length-range` + `Content-Type` firmados; evaluar bucket privado. (M4)
11. Logs con usuario/IP/requestId y alertas básicas; CA de Azure para `DB_SSL_REJECT_UNAUTHORIZED=true`. (M7, M9)
12. Pipeline: `deploy` dependiente de `tests`, `npm ci`, imagen multi-etapa no-root con `HEALTHCHECK`, despliegue sin caída. (M8)

**Backlog**
13. Dividir los servicios gigantes por casos de uso; reemplazar la concatenación de SQL por un ayudante seguro.
14. Escapar `LIKE`, límites por usuario, `statement_timeout`, caché de listados públicos, WAF/CDN.
15. Repetir ZAP autenticado (con token) y pruebas de carga contra un entorno **de staging** separado antes de la salida a usuarios reales.

## 7. Cómo repetir las pruebas

```bash
# 1) Postgres desechable + migraciones + demo, backend compilado SIN .env real, en un directorio sin .env
npm run build && node database/scripts/migrate.js && npm run db:demo
# 2) Arrancar en 3100 (límites por defecto) y 3101 (THROTTLE_LIMIT=100000000)
# 3) node docs/security/scripts/security-probe.mjs resultados.json
# 4) node docs/security/scripts/flood-probe.mjs
```

Los scripts tienen rutas de Windows de este equipo; ajústalas. Nunca los apuntes a Azure ni a producción.
