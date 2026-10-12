# B11 — Confiabilidad, backups e integraciones

Estado al 2026-10-12, en `development` de `backend/` (commit base `51cca36`). Responsable: Martin. B10 puede usar este documento como evidencia de restore, RPO/RTO y métricas de éxito/error; aquí está la implementación y la evidencia técnica, no se duplica el trabajo de B10.

**Regla de este documento: no hay evidencia inventada.** Lo que no se pudo verificar desde el entorno de trabajo está marcado como **pendiente de verificación**, con el acceso que falta y los pasos exactos.

## 1. Resumen

| Requisito B11 | Estado |
|---|---|
| Verificar backups automáticos de PostgreSQL/Azure | **NO verificado** en la instancia real `pg-havit-dev-01` (sin acceso a la suscripción de Azure; hace falta el rol Reader). Lo único documentado son las capacidades del servicio según Microsoft (sección 2). |
| Restauración controlada documentada | **A. Restore drill local: EJECUTADO** con el schema real de Havit y datos sintéticos (sección 3). **B. Restore desde el backup administrado de Azure (PITR): NO EJECUTADO**, pendiente por falta de acceso (sección 4). |
| RPO/RTO realistas | Definidos como **objetivos propuestos**, separados de lo observado y de la documentación oficial. **No son un SLA confirmado** (sección 5). |
| Validar OpenAI y Cloudflare R2 | Configuración de reintentos y timeouts auditada y explícita, logging con `Logger` de Nest, tests contra los SDK reales con red simulada (sección 6). |
| Medir éxito/error sobre una muestra controlada | Contadores **en memoria, por proceso** y una línea de log estructurada por llamada, más `scripts/b11-integration-sample.js`. **La muestra real queda pendiente** (requiere secretos y salida a internet). Sección 7. |
| Manejo controlado de fallos externos | Fallos acotados en tiempo, sin reintentos para errores no recuperables, reintento acotado del fallo DNS temporal `EAI_AGAIN` en R2, excepción final sin cambios, sin secretos en logs (sección 6). |

### Qué es evidencia y qué no

| Categoría | Contenido |
|---|---|
| **OBSERVADO** (ejecutado y verificado en B11) | Restore drill local A (sección 3); tests de OpenAI/R2/telemetría con los SDK reales y red simulada (sección 6); prueba de humo del script de muestra con credenciales falsas (sección 7). |
| **DOCUMENTACIÓN OFICIAL** (no verificado sobre Havit) | Capacidades de backup/PITR de Azure Database for PostgreSQL Flexible Server (sección 2). |
| **OBJETIVO PROPUESTO** (no es SLA) | RPO ≤ 15 min, RTO ≤ 4 h (sección 5). |
| **PENDIENTE** | Configuración real de backups de `pg-havit-dev-01` (rol Reader); restore B desde Azure (rol Contributor); muestra real contra OpenAI y R2 (secretos reales + internet). |

## 2. Backups (Azure Database for PostgreSQL)

### Entorno auditado

| Dato | Valor | Fuente |
|---|---|---|
| Proveedor | Azure Database for PostgreSQL — Flexible Server (**inferido**, no verificado en el portal) | `DB_HOST=pg-havit-dev-01.postgres.database.azure.com` (CLAUDE.md del proyecto). Se infiere Flexible Server porque Single Server está retirado; confirmarlo con el comando de abajo. |
| Clasificación | **AZURE / SHARED** — la misma base para el contenedor desplegado y para `raiz/docker-compose.yml` | CLAUDE.md, `raiz/docker-compose.yml` |
| Acceso desde el entorno de esta auditoría | **Ninguno**: no hay `backend/.env` real (solo `.env.example`), no hay Azure CLI ni credenciales de la suscripción | Revisado el 2026-10-12 |

### Capacidad del servicio (documentación oficial de Microsoft)

Fuente: [Backup and restore in Azure Database for PostgreSQL Flexible Server](https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore).

| Aspecto | Lo que documenta Microsoft |
|---|---|
| Backups automáticos | Habilitados por defecto para todo el servidor ("enables automated backups of your entire server"). |
| Tipo y frecuencia | Snapshot diario (el primero full, los siguientes diferenciales) **más** backup continuo de WAL cuando cada segmento está listo para archivarse. |
| RPO de la plataforma | "In general, the delay RPO (recovery point objective) can be up to five minutes." Geo-restore: "up to one hour of RPO". |
| Retención | 7 días por defecto, configurable entre 7 y 35. |
| Point-in-time restore (PITR) | A cualquier momento dentro de la retención (por defecto, el último). **Siempre crea un servidor nuevo y nunca sobrescribe el original.** |
| Tiempo de restore | "The overall recovery time usually takes from few minutes up to a few hours"; depende del replay de logs desde el último snapshot. |
| Redundancia del backup | Local, zonal o geo-redundante. La geo-redundancia **solo se puede elegir al crear el servidor**. |
| Riesgo crítico | "If you delete a server, all backups that belong to the server are also deleted and can't be recovered." |

### Configuración real de `pg-havit-dev-01` — PENDIENTE DE VERIFICACIÓN

No se pudo verificar desde este entorno: **no hay ninguna evidencia observada de la configuración de backups real** (retención, geo-redundancia, último backup). Todo lo de la tabla anterior es lo que Microsoft documenta para el servicio, no lo que tiene configurado este servidor. Hace falta alguien con al menos el rol **Reader** sobre el resource group del servidor. Comandos de solo lectura:

```bash
az login
az postgres flexible-server show -g <resource-group> -n pg-havit-dev-01 \
  --query "{retentionDays:backup.backupRetentionDays, geoRedundant:backup.geoRedundantBackup, earliestRestore:backup.earliestRestoreDate, ha:highAvailability.mode, version:version, sku:sku.name}" -o table
az postgres flexible-server backup list -g <resource-group> -n pg-havit-dev-01 -o table
```

En el portal: servidor → *Settings* → *Backup and restore*. Hay que anotar en la tabla de abajo la **fecha de la verificación**, la retención real, si la geo-redundancia está activa, el *earliest restore point* y el último backup completo.

| Dato a registrar | Valor |
|---|---|
| Fecha de verificación | _pendiente_ |
| Retención (días) | _pendiente_ |
| Geo-redundancia | _pendiente_ |
| Earliest restore point | _pendiente_ |
| Último backup completo | _pendiente_ |
| Verificado por | _pendiente_ |

## 3. A. RESTORE DRILL LOCAL — EJECUTADO

> **Esto NO es una restauración de Azure.** Es un ensayo con `pg_dump`/`pg_restore` sobre un PostgreSQL local, aislado y desechable, con el schema real de Havit y **datos sintéticos**. No se usó ningún backup de Azure ni ninguna conexión a `pg-havit-dev-01`.

| | |
|---|---|
| Destino | PostgreSQL 16.15 local, aislado (sin TCP), creado y destruido para el ensayo |
| Schema | Real: init + migraciones + seeds de `development` (`51cca36`) aplicados con el runner oficial |
| Datos | **Sintéticos** ([`restore-drill-seed-synthetic.sql`](./restore-drill-seed-synthetic.sql)): ningún dato real, emails `@example.invalid`, hashes falsos |
| Herramientas | `pg_dump -Fc` → `pg_restore` → `pg_amcheck --heapallindexed` + validaciones SQL |
| Resultado | **Satisfactorio**: 60/60 tablas idénticas (conteo + md5), constraints validadas, `pg_amcheck` sin errores |

**Qué demuestra:** que el schema real de Havit se respalda y se restaura sin pérdida, con verificación de integridad, y deja ensayadas las validaciones que se repetirán sobre un restore real de Azure.

**Qué NO demuestra:** que existan backups en Azure, que el PITR de Azure funcione para este servidor ni cuánto tarda. Eso es el punto B (sección 4), **no ejecutado**.

### Aislamiento del destino (demostrado)

- PostgreSQL 16.15 recién creado con `initdb` en un directorio temporal, propiedad del usuario `postgres`.
- `listen_addresses=''`: **sin TCP**, solo un socket Unix en ese directorio temporal (`ss -ltn` no mostró ningún listener).
- Sin ningún `DB_HOST` de Azure en el entorno. Al terminar, el cluster se detuvo y el directorio se borró.

### Pasos (2026-10-12, ~16:05–16:11 UTC)

1. `git clone --depth 1 --branch development` del backend (commit `51cca36`).
2. Base nueva `havit_source`, con el runner oficial: `DB_HOST=<socket> DB_SSL=false node database/scripts/migrate.js`. Se aplicaron **64 archivos** (1 init, 55 migraciones, 8 seeds), incluidas las migraciones de B4. Resultado: **60 tablas** en `havit`.
3. Datos sintéticos: [`restore-drill-seed-synthetic.sql`](./restore-drill-seed-synthetic.sql).
   - 200 usuarios, 20 challenges, 1 800 workout logs, 1 350 posts, 1 000 comentarios, 1 000 likes y 500 mensajes directos.
   - Incluye filas en soft delete de B4. Tamaño: **13 MB**.
4. Huella del origen: por cada una de las 60 tablas, `count(*)` y `md5(string_agg(fila::text ORDER BY fila::text))`.
5. Backup: `pg_dump -Fc` → **0,14 s**, 360 KB.
6. Restore sobre una base nueva `havit_restore`: `pg_restore --no-owner --exit-on-error` → **0,54 s**.
7. Validaciones sobre `havit_restore` (todas OK):

| Validación | Resultado |
|---|---|
| Conexión y lectura | OK |
| Tablas | 60/60 |
| Conteo y md5 por tabla | **Idénticos en las 60 tablas** (incluidas `schema_migrations` = 64, `users` = 201, `workout_posts` = 1 350, `direct_messages` = 500) |
| Constraints | 101 FK y 89 PK/UNIQUE; 0 sin validar; 147 índices |
| `pg_amcheck --heapallindexed` | 274/274 relaciones, 440/440 páginas, exit 0 |
| Estado B4 preservado | 36 posts inactivos, 1 challenge inactivo, 5 filas `direct_conversation_hidden_by` |
| Lectura tipo feed (activos, públicos, challenge activo) | Devuelve filas, con joins `posts`/`workout_logs`/`challenges`/`users` |
| Continuidad de identity/secuencias | Un `INSERT` nuevo en `workout_logs` y `direct_messages` asigna ids nuevos, sin colisión (transacción con `ROLLBACK`) |

**Resultado: restauración exitosa y verificada.** Para repetirla: mismos comandos, en un Postgres desechable (por ejemplo el `havit-db-local` de `raiz/docker-compose.local.yml`) y **nunca** con un `DB_HOST` de Azure.

## 4. B. AZURE MANAGED BACKUP RESTORE — NO EJECUTADO

**Estado: NO ejecutado. Pendiente por falta de acceso a Azure** (no hay credenciales de la suscripción ni Azure CLI configurada en el entorno de B11). No existe evidencia de un restore desde el backup administrado de Azure; esta sección es **solo el procedimiento** para cuando alguien con el rol **Contributor** lo ejecute.

Requisito: restaurar el PITR/backup **hacia un servidor nuevo y aislado**, nunca sobre `pg-havit-dev-01` ni sobre otra base compartida. Se ejecuta **solo** creando un servidor nuevo: PITR nunca sobrescribe el original. **No** se debe apuntar la API a un servidor restaurado sin coordinarlo con el equipo.

| Paso | Detalle |
|---|---|
| 1. Elegir el punto | Hora UTC justo antes del incidente, dentro de la retención (*earliest restore point*). |
| 2. Restaurar a un servidor nuevo | `az postgres flexible-server restore -g <rg> --name pg-havit-restore-<yyyymmdd> --source-server pg-havit-dev-01 --restore-time "<YYYY-MM-DDTHH:MM:SSZ>"`. Requiere el rol **Contributor** y tiene costo mientras exista el servidor. |
| 3. Validar (solo lectura) | Conectarse con `psql` al servidor **nuevo** y repetir las validaciones de la sección 3: conteos de las tablas principales, `schema_migrations`, lectura de un post/usuario conocido y constraints sin validar. |
| 4a. Si es un simulacro | Registrar la evidencia y **borrar el servidor temporal**. |
| 4b. Si es un incidente real | Apuntar `DB_HOST` del backend al servidor restaurado y reiniciar el contenedor. Su `npm run db:migrate` solo aplica lo pendiente (el tracking viaja con la base). Smoke test: `POST /auth/login`, `GET /feed`, `GET /users/me/challenges`. |
| Evidencia a capturar | Hora pedida vs. hora efectiva del restore; duración del `az ... restore`; salida de las validaciones; hora en que la API volvió a responder. Esa medición es la que permitiría confirmar (o corregir) el RTO propuesto. |

## 5. RPO / RTO

> Los objetivos son **propuestos** para Havit. **No son un SLA confirmado**: la configuración real de `pg-havit-dev-01` sigue pendiente de verificación con acceso Reader (sección 2) y el restore B de Azure no se ejecutó (sección 4).

| | DOCUMENTACIÓN OFICIAL (Azure, no verificado en Havit) | OBSERVADO (solo restore drill local A) | **OBJETIVO PROPUESTO** |
|---|---|---|---|
| **RPO** | ≤ 5 min con PITR en la misma región; ≤ 1 h con geo-restore (solo si se activó la geo-redundancia al crear el servidor) | 0 pérdida entre dump y restore (dump consistente). **No mide el RPO de Azure.** | **≤ 15 min** ante pérdida o corrupción lógica de datos en la región |
| **RTO** | "Few minutes up to a few hours" según el replay de WAL | 0,54 s de restore lógico (13 MB) + validaciones en segundos. **No mide el RTO de Azure.** | **≤ 4 h** desde que se decide restaurar hasta que la API responde |

**Por qué estos objetivos.**
- **RPO 15 min:** Azure archiva WAL con un retraso de hasta 5 minutos. Se deja margen ×3 porque la configuración real no está verificada y el proyecto no tiene monitoreo de archivado.
- **RTO 4 h:** la duración del PITR depende de Azure ("up to a few hours") y no la controla el equipo. A eso se suman la decisión humana, la validación del servidor nuevo y el cambio de `DB_HOST` más el reinicio (minutos, ver la sección 4). El ensayo local muestra que el volumen de datos actual no es un factor relevante.

**Fuera del objetivo:**
- **Caída de toda la región** sin geo-redundancia: no hay backup fuera de la región, así que no hay RPO/RTO garantizado. Hay que confirmar `geoRedundant` (sección 2).
- **Borrado del servidor:** también borra sus backups.
- **Objetos de R2** (fotos): no forman parte del backup de PostgreSQL. Las URLs en `workout_posts.image_url` sobreviven a un restore, pero el archivo en R2 no está respaldado por este mecanismo.

## 6. Integraciones externas — manejo de fallos

**Decisión: no se agrega una capa de retry propia.** Los dos SDK ya reintentan con backoff exponencial y saben distinguir errores recuperables. Un segundo retry encima multiplicaría los intentos (por ejemplo, 3 × 3) y los tiempos de espera. B11 hace explícita esa configuración, acota los tiempos y agrega logging y métricas.

### OpenAI (`src/openai/moderation.service.ts`)

| | Antes de B11 | Después de B11 |
|---|---|---|
| Cliente | `new OpenAI({ apiKey })` con los valores por defecto del SDK (`openai` 6.39) | `maxRetries: 2` y `timeout: 8000` explícitos (`OPENAI_MAX_RETRIES`, `OPENAI_TIMEOUT_MS`) |
| Timeout por intento | **10 minutos** (el valor por defecto del SDK): una moderación síncrona podía colgar la request | 8 s; el peor caso es ≈ 3 × 8 s + backoff |
| Reintentos | 2, implícitos | 2, explícitos. El SDK reintenta errores de conexión, timeout, 408, 409, 429 y 5xx (backoff de 0,5 s a 8 s con jitter, respeta `Retry-After`). **Nunca** reintenta los demás 4xx (400, 401, 403, 404). |
| Logging | `console.error('MODERATION ERROR:', error)` con el objeto completo | `Logger` de Nest: un `warn` por cada intento fallido y una línea `external_call` por llamada (ver la sección 7) |
| Excepción final | 503 `ServiceUnavailableException` (fail-closed) | **Sin cambios**: el mismo 503 y el mismo mensaje. Sin API key sigue siendo 500. |

Los logs **no** incluyen la API key, el texto del usuario ni el mensaje de error del proveedor (puede repetir el input). Solo incluyen la clase de error, el status, el código, el id de request del SDK y la URL.

### Cloudflare R2 (`src/uploads/uploads.service.ts`)

| | Antes de B11 | Después de B11 |
|---|---|---|
| Cliente | `S3Client` con `maxAttempts: 2`, `connectionTimeout` de 5 s y `requestTimeout` de 20 s (ya existían; el documento del Sprint estaba desactualizado) | Sin cambios (`R2_MAX_ATTEMPTS = 2`) |
| Reintentos | Estrategia estándar del AWS SDK: throttling, 5xx transitorios, timeouts y errores de conexión, con backoff y jitter. No reintenta 4xx (`AccessDenied`, `NoSuchBucket`). **No reintentaba `EAI_AGAIN`.** | La misma estrategia del SDK, **más `EAI_AGAIN`** como transitorio (ver el hallazgo abajo) |
| Logging | **Ninguno**: el presign descartaba el error y la purga no logueaba | Middleware en el paso `deserialize` (corre una vez por intento, dentro del retry del SDK) que loguea cada intento fallido con `amz-sdk-request: attempt=N; max=M`, más una línea `external_call` por llamada |
| Excepción final | Presign: 500 `InternalServerErrorException`. Purga: error del SDK | **Sin cambios** |

**Notas.**
- `getPresignedUrl()` firma **localmente** y no llama a R2. Un fallo ahí es de configuración o credenciales, no de red. Se registra como `operation=presign`.
- Hoy las llamadas de red del backend a R2 son `ListObjectsV2` y `DeleteObjects` (`deleteUserObjects`). El tratamiento de errores vive en el `S3Client` compartido del servicio, así que aplica a **cualquier** llamada de red a R2, presente o futura, sin depender de quién la invoque.

**Hallazgo y corrección: `EAI_AGAIN`.**
- **Qué se observó:** en la prueba de humo (sección 7) un `ListObjectsV2` falló con `code=EAI_AGAIN` en **1 intento**, aunque `maxAttempts` es 2.
- **Por qué:** el SDK clasifica los errores con `@smithy/service-error-classification`. `isTransientError()` solo reconoce como errores de red de Node `ECONNRESET`, `ECONNREFUSED`, `EPIPE`, `ETIMEDOUT`, `EHOSTUNREACH`, `ENETUNREACH` y `ENOTFOUND`. `EAI_AGAIN` (getaddrinfo: "temporary failure, try again") no está en la lista, cae en `CLIENT_ERROR` y la `StandardRetryStrategy` no lo reintenta.
- **Es configurable:** `isTransientError()` también acepta el trait del propio SDK `$retryable` (`isRetryableByTrait`).
- **Corrección (mínima, sin librería nueva):** el middleware por intento (paso `deserialize`, que corre **antes** de que el retry middleware clasifique el error) marca con `$retryable = { throttling: false }` los errores cuyo `code` está en `EXTRA_TRANSIENT_NETWORK_CODES = ['EAI_AGAIN']`. A partir de ahí reintenta la estrategia estándar del SDK: mismo límite `R2_MAX_ATTEMPTS = 2` (1 reintento), mismo backoff con jitter (base 100 ms), **sin loop propio y sin retry infinito**.
- **No se amplió a otros códigos:** por ejemplo, `ERR_INVALID_URL` sigue fallando en 1 intento.
- **Tests:** `EAI_AGAIN` y luego éxito (2 intentos); `EAI_AGAIN` permanente → 2 intentos y el error original; un código no transitorio → 1 intento.

### Tests (ejecutan los SDK reales; solo la red está simulada)

| Spec | Qué cubre |
|---|---|
| `src/openai/moderation.service.reliability.spec.ts` (8) | Éxito al primer intento; 503 y luego éxito; 429 y luego éxito; caída de conexión y luego éxito (con el backoff real); 500 permanente → 3 intentos y el 503 final; 401 sin reintento; el mismo manejo en moderación de imagen; ni la API key, ni el texto ni el mensaje del proveedor aparecen en los logs. Usa `test/jest-environment-node-fetch.js`, que solo expone a Jest 27 el `fetch` nativo de Node. |
| `src/uploads/uploads.service.spec.ts` (10) | `ListObjectsV2` exitoso; 503 y luego éxito; 500 permanente → 2 intentos y el error original del SDK; `EAI_AGAIN` y luego éxito; `EAI_AGAIN` permanente → 2 intentos; código de red no transitorio sin reintento; 403 sin reintento; presign local sin red; fallo de firma → 500; credenciales y mensaje del proveedor ausentes de los logs. |
| `src/common/external-call-telemetry.spec.ts` (7) | Contadores por operación y por servicio, tasa de éxito, formato de la línea de log y un resumen de error sin mensaje ni secretos. |

## 7. Métrica de éxito/error

**Dónde se mide:** `src/common/external-call-telemetry.ts`. Cada llamada terminada emite **una** línea con este formato (`log` si tuvo éxito, `error` si falló):

```
external_call service=openai operation=moderations.create outcome=success attempts=1 durationMs=412
external_call service=r2 operation=ListObjectsV2 outcome=failure attempts=2 durationMs=5100 error=InternalError status=500
```

Además, la misma llamada incrementa contadores en memoria (`externalCallMetrics.snapshot()`): `calls`, `successes`, `failures`, `retries` y `successRate`, por `servicio:operación` y por servicio.

**Limitaciones de los contadores (no es observabilidad distribuida):**
- Viven **solo en la memoria de cada proceso**. Se pierden con cada reinicio o redeploy.
- Con **varias instancias** del contenedor, cada una tiene sus propios contadores y nada los agrega. No representan el total del sistema.
- No se exponen por ningún endpoint ni se envían a ningún stack de métricas (el proyecto no tiene uno y B11 no lo agrega).
- Sirven para la **muestra controlada** (un solo proceso: el script de la muestra) y para los tests. Para producción, la fuente es la línea `external_call` en los logs de **todas** las instancias, agregada con el comando de abajo o en la herramienta de logs.
- El funcionamiento normal no depende de ellos: registrar una llamada solo suma en un `Map` acotado (las claves son nombres de operación fijos del código, no datos del usuario) y nunca lanza ni cambia la respuesta.

**Contar desde los logs de la API** (por ejemplo, del contenedor en Azure):

```bash
grep -o 'external_call service=[a-z0-9]* operation=[^ ]* outcome=[a-z]*' api.log | sort | uniq -c
```

**Muestra controlada reproducible:** `node scripts/b11-integration-sample.js --confirm-external-calls --samples 20`.
- Usa los servicios reales.
- OpenAI: una frase fija y neutra.
- R2: presign local más un `ListObjectsV2` **de solo lectura** sobre un prefijo aleatorio inexistente. No sube ni borra nada y no toca la base.
- Imprime llamadas, éxitos, errores, reintentos y tasa de éxito por servicio.

| Corrida | Resultado |
|---|---|
| **Muestra real (OpenAI + R2)** | **PENDIENTE.** Requiere `OPENAI_API_KEY` y `CLOUDFLARE_R2_*` reales y salida a internet hacia `api.openai.com` y `*.r2.cloudflarestorage.com`. El entorno de esta auditoría no tiene ninguna de las dos cosas. Correrla desde una máquina con el `.env` real y pegar aquí la tabla. |
| Prueba de humo del pipeline (2026-10-12, credenciales **falsas** a propósito, 3 muestras, **antes** de la corrección de `EAI_AGAIN`) | Valida la medición, no la disponibilidad. OpenAI: 3 llamadas, 3 errores (`APIConnectionError`, 3 intentos cada una: 6 reintentos), 0 %. R2 `presign`: 3/3 (100 %, firma local). R2 `ListObjectsV2`: 0/3 (`EAI_AGAIN`, 1 intento). Este resultado es el que originó la corrección de la sección 6; con ella, el mismo fallo DNS se intenta 2 veces (cubierto por tests). |
| Muestra con red simulada (tests de la sección 6) | 18 escenarios deterministas (8 OpenAI + 10 R2), todos con el resultado esperado. |

**Para leer la tasa de R2,** usar la fila por operación. El agregado `r2` mezcla `presign` (local) con llamadas de red.
