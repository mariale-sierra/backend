# Informe del sprint — resultados de pruebas, refactorización, integración continua y deuda técnica

Corte: 2026-10-27. Repos: `backend/` (`development`) y `frontend/` (`development`); `raiz/` solo orquesta Docker.
Ventana del sprint usada para contar commits: **2026-10-06 → 2026-10-27** (supuesto; ajusta si el sprint empezó otro día).
Las pruebas de este informe se ejecutaron en **local** con un PostgreSQL 17 desechable, sin tocar Azure.

---

## 1. Resultados de las pruebas

### 1.1 Resumen por tipo de prueba

| Tipo | Herramienta | Alcance | Resultado (27/10) | Evidencia |
|---|---|---|---|---|
| Unitarias backend | Jest + ts-jest | 70 de 73 suites (3 omitidas) | **1 250 pasan**, 17 omitidas, 0 fallan | `evidencias-2026-10-27/coverage-backend-resumen.txt` |
| Integración de servicios (BD real) | Jest contra PostgreSQL | refresh tokens, eliminación de cuenta, mosaico de posts | **17/17 pasan** (3 suites) | `evidencias-2026-10-27/integration-db.json` |
| Integración y regresión de la API (HTTP + BD) | Jest + Supertest, `test/*.e2e-spec.ts` | auth/sesiones y la API completa | **55/55 pasan** (2 suites) | `evidencias-2026-10-27/integration-api.json` |
| Unitarias frontend | Jest (jest-expo) | 196 de 197 suites (1 omitida) | **2 291 pasan**, 5 omitidas, 0 fallan | `evidencias-2026-10-27/coverage-frontend-resumen.txt` |
| Seguridad por categoría OWASP Top 10 | Batería propia, 88 comprobaciones | 4 usuarios: normal, privado, ajeno, admin | **78 PASS, 10 INFO, 0 hallazgos** (el 13/10 eran 20) | `docs/security/scripts/security-probe-results-2026-10-27.json` |
| Dependencias | `npm audit --omit=dev` | backend y frontend | **Backend 0** vulnerabilidades (antes 2); frontend 7 (4 altas, Expo) | salida de la sesión |
| Inundación / volumen de la API | `autocannon`, 100 conexiones | 9 escenarios | **0 errores 5xx** en todos | `docs/security/scripts/flood-results-2026-10-27.json` |
| Escaneo automatizado | OWASP ZAP | ver §1.5 | ver §1.5 | **falta adjuntar reporte** |

Nota sobre el entorno: la primera corrida de la API en local falló 1 prueba porque Nest cargó el `.env` real y la prueba
llegó a hablar con R2. Con las credenciales externas vacías (como en CI) pasan las 55.

### 1.2 Cobertura frente al 80 % pedido

| | Líneas | Sentencias | Ramas | Funciones |
|---|---|---|---|---|
| **Backend** | **80,70 %** (4 966 / 6 153) | 79,13 % | 74,57 % | 67,55 % |
| **Frontend** | **58,05 %** (4 301 / 7 408) | 57,40 % | 53,65 % | 52,77 % |
| Ambos repos juntos (líneas) | 68,3 % (9 267 / 13 561) | | | |

- **El backend cumple el 80 %** (el 6/10 estaba en 73,4 %). El umbral ya está en `backend/package.json`
  (`coverageThreshold`: líneas 80, sentencias 78, ramas 72, funciones 66).
- **El frontend no llega al 80 %**: 58 %. Para ser honestos en el documento: "80 % del sistema" se cumple en backend; en
  frontend se mide sobre servicios, hooks, i18n, componentes y pantallas, y queda 22 puntos por debajo.
- Las pruebas de integración y de API **no se cuentan** en esa cobertura (necesitan Postgres); suman evidencia de
  comportamiento pero no líneas.

### 1.3 Pruebas de las funcionalidades nuevas del sprint

| Funcionalidad | Pruebas |
|---|---|
| Sesiones: access de 15 min + refresh rotativo, logout y revocación (B4) | `auth-sessions.e2e-spec.ts`, `refresh-tokens.integration.spec.ts`, `auth.service.spec.ts` |
| Contraseñas: política y lista de comunes | `password-policy.spec.ts` y casos en `api-integration.e2e-spec.ts` |
| Términos y eliminación de cuenta (plazo **7 días**) | `account-deletion.integration.spec.ts` (BD real, incluye las dos carreras cancelar vs. purga) y `account-deletion.service.spec.ts` |
| Suspensión por moderación y errores con fecha | `suspension.guard.spec.ts`, `http-exception.filter.spec.ts` |
| Fotos en R2: firma de tipo/tamaño, verificación de bytes, URLs firmadas (B5) | `uploads.service.spec.ts`, `upload-url.util.spec.ts` |
| Sustitución de ejercicios por ubicación | `exercise-substitution.spec.ts`, `exercise-substitution.service.spec.ts` |
| Permisos por id en comentarios, reacciones y reportes | `workout-post-visibility.util.spec.ts` + specs de los 3 servicios |
| Resolución de reportes (sin deadlock, sin sanción sin cambio) | `workout-post-reports.service.spec.ts` |
| Transporte y configuración (TLS a la BD, trust proxy, HTTP) | `db-ssl.spec.ts`, `trust-proxy.spec.ts`, `http-config.spec.ts` |
| Salud del servicio (`/health`, `/health/ready`) | `health.controller.spec.ts` y el job `image` de CI |
| Frontend: foto/progreso, ubicación, moderación, métricas | `usePhotoProgressSubmit.test.tsx`, `useLocationSwitch.test.tsx`, `applyExerciseMetrics*.test.ts`, `editProfile.test.tsx`, `moderationBanned.test.tsx` |

### 1.4 Pruebas de regresión

- La API tiene un bloque **"R14 regresión: endurecimiento de la auditoría OWASP"** en `api-integration.e2e-spec.ts`: cada
  corrección de seguridad (H2, H3, H4, M5, M6...) queda cubierta por una prueba contra Postgres real.
- Hoy se añadieron regresiones para los cambios del día: escape de comodines `LIKE`, rutas con `../` en subidas, previews
  de retos borrados, IDs inexistentes en disponibilidad, no sancionar sin cambio, y la carrera cancelar-vs-purga.
- La prueba de integración que cubre `cancelDeletion` **destapó un bug previo**: siempre respondía éxito, incluso sin
  solicitud pendiente, porque TypeORM devuelve `[filas, contador]` en `UPDATE ... RETURNING`. Corregido.

### 1.5 OWASP ZAP — qué hay y qué falta

**No encontré ningún reporte de ZAP** (HTML, PDF o JSON) en `backend/`, `frontend/`, `raiz/` ni en Descargas, así que no
puedo adjuntar capturas sin inventarlas. Lo único que existe son las cifras del informe del sprint anterior, que
**no pude verificar**:

| Dato (según el informe del sprint anterior) | Valor |
|---|---|
| Rutas activas escaneadas | 129 |
| Escaneo pasivo (baseline) antes de la corrección de cabeceras | 0 fallos / 4 avisos |
| Tras reconfigurar `helmet` (sin `unsafe-inline`, `Permissions-Policy`, COEP, `Content-Type` estándar) | **0 fallos / 1 aviso** |
| Alertas altas o críticas | 0 |

Para adjuntar evidencia real hay dos caminos:
1. Pasar los reportes que ya generaste y se insertan como imágenes de la tabla "Summary of Alerts".
2. Repetir el escaneo contra la instancia local (ya no hace falta tocar Azure):

```bash
# con la API corriendo en local (puerto 3100)
docker run --rm -v "$PWD:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t http://host.docker.internal:3100 -r zap-baseline.html -J zap-baseline.json
```

Esto requiere iniciar Docker Desktop y descargar la imagen (~1 GB). El reporte HTML se captura de pantalla para el documento.

### 1.6 Seguridad y volumen (resumen)

- **Seguridad:** 0 hallazgos en 88 comprobaciones. El único hallazgo real que seguía abierto (la búsqueda `q=%` listaba a
  todos los usuarios) se corrigió con `escapeLike`. Detalle y estado final de cada ID del AUDIT en
  `MATRIZ-REQUISITOS-NO-FUNCIONALES-2026-10-27.md` §2.
- **Volumen (local, un proceso):** con los límites de producción, 0 errores 5xx bajo 100 conexiones y la API siguió
  respondiendo en 5–17 ms. Sin limitador: `/feed` 587 req/s (p99 331 ms), `/workout-posts/mine` 674 req/s (p99 225 ms),
  `/challenges` 378 req/s (p99 592 ms), búsqueda 771 req/s (p99 328 ms); un cuerpo de 2 MB se rechaza con 413.
  Son números de un portátil con base local: sirven para comparar endpoints, no representan Azure.

---

## 2. Refactorización

### Backend
| Tarea | Qué se hizo |
|---|---|
| Configuración extraída y probada | `src/config/db-ssl.ts` (TLS a la BD con verificación de cadena y nombre), `trust-proxy.ts`, `http-config.ts`, cada una con su spec |
| Validación de URLs de subida reutilizable | `src/uploads/upload-url.util.ts`: una sola función para todo lugar que acepta una imagen; hoy además compara la ruta **normalizada** |
| Reglas de visibilidad centralizadas | `workout-post-visibility.util.ts` pasó de un chequeo mínimo a las mismas reglas del feed, usadas por comentarios, reacciones y reportes |
| Escape de comodines `LIKE` | `src/common/escape-like.util.ts`, aplicado en búsqueda de usuarios y de ejercicios |
| Sustituciones de ejercicios | Lógica pura aislada en `src/exercises/lib/exercise-substitution.ts` (con spec) |
| Telemetría de llamadas externas | `src/common/external-call-telemetry.ts` (éxito/error de OpenAI y R2) |
| Errores y guard de suspensión | El filtro global conserva `suspendedUntil`; el guard falla cerrado (503) |
| Concurrencia | Resolución de reportes serializada por contenido; purga de cuenta con lock y revalidación |
| Pipeline | Un solo workflow `ci.yml` (tests → imagen → despliegue), imagen multi-etapa no-root con `HEALTHCHECK`, `/health` y `/health/ready` |

### Frontend (B10, `frontend/docs/sprint-10/B10-*.md`)
| Tarea | Qué se hizo |
|---|---|
| Cámara | Flujo subir → guardar → cerrar movido a `hooks/usePhotoProgressSubmit.ts`; chips a `components/add/camera/CameraChips.tsx` |
| Editar perfil | `components/profile/LanguageToggle.tsx` extraído; filas de sesión movidas a Configuración |
| Ejercicios | Mapeos extraídos a `services/adapters/exercisePickerAdapter.ts` (sin cambio de lógica) |
| Tipado y limpieza | `any` → `unknown` en hooks, contexto y servicios; código muerto y imports sin uso fuera; log sensible de push saneado |
| Estado entre sesiones | Reinicio de stores centralizado al cambiar de sesión |
| Utilidades con pruebas propias | `utils/apiError.ts`, `challengeReward.ts`, `hashtags.ts`, `photoModeration.ts`, `postViewer.ts` |
| Medición reproducible | `scripts/code-metrics.js` (`npm run metrics`) y cobertura ampliada a `components` y `app` |

### Lo que **no** se refactorizó (honestidad)
- Los servicios grandes del backend siguen igual: `challenges.service.ts` 1 863 líneas, `workout-posts.service.ts` 1 387,
  `exercises.service.ts` 860, `users.service.ts` 805, `uploads.service.ts` 744.
- En el frontend no se dividieron pantallas grandes (B10 lo excluyó explícitamente).
- No se reemplazó la concatenación de SQL por un ayudante seguro.

---

## 3. Integración continua

### Commits frecuentes (2026-10-06 → 2026-10-27)

| | Commits | Días con commits | Fusiones/PR | Contribuyentes |
|---|---|---|---|---|
| `backend` | **80** | 13 | 10 | 5 |
| `frontend` | **84** | 13 | 5 | 5 |
| `raiz` | 3 | 2 | 2 | 1 |

**Semana de integración continua: 22 → 27 de octubre (6 días consecutivos con commits en ambos repos)**

| Fecha | 10-22 | 10-23 | 10-24 | 10-25 | 10-26 | 10-27 | Total |
|---|---|---|---|---|---|---|---|
| `backend` | 2 | 11 | 4 | 14 | 4 | 9 | **44** |
| `frontend` | 14 | 8 | 2 | 23 | 13 | 2 | **62** |

(Obtenido con `git log --since="2026-10-06" --format=%ad --date=short`; incluye los commits de hoy.)

### Cómo se hizo
1. **Trabajo en `development`**, con ramas cortas solo para cambios grandes; integración a `main` solo con confirmación.
2. **Antes de cada cambio:** `git fetch --prune`, revisar ramas y PR abiertos, y confirmar que `development` está al día.
3. **Antes de cada push:** pruebas del área tocada, revisión del diff y `git fetch` otra vez por si otra persona
   integró algo; commits pequeños con mensajes en español que describen el cambio.
4. **En cada push, GitHub Actions** (`backend/.github/workflows/ci.yml`) ejecuta sin intervención humana.

### Herramientas automatizadas
| Herramienta | Para qué |
|---|---|
| **GitHub Actions** (`uptime.yml`) | Monitoreo de `/health` y `/health/ready` cada 5 minutos por HTTPS, con aviso por correo si falla (corre solo desde `main`) |
| **GitHub Actions** (`ci.yml`) | Job `tests`: levanta `postgres:16`, aplica las migraciones con el **mismo runner que producción**, corre unitarias con cobertura, integración de servicios y API, genera el resumen y **guarda la evidencia** (artefacto `test-evidence`) |
| | Job `image`: construye la imagen de producción, arranca el contenedor, espera el `HEALTHCHECK` y comprueba que no corre como root |
| | Job `deploy`: solo en `push` a `main` y **solo si `tests` e `image` pasaron**; actualiza `backend` y `raiz` en la VM |
| **Jest + Supertest** | Unitarias, integración con Postgres real y regresión de la API |
| **Docker / `HEALTHCHECK`** | La imagen se valida igual que en producción |
| **`npm run db:migrate`** | El mismo SQL versionado corre en CI, en local y en el despliegue |
| **Cobertura con umbral** | `coverageThreshold` hace fallar la corrida si baja del 80 % de líneas en backend |

Historial del pipeline (`git log -- .github/workflows`): `06/10` primer CI con pruebas de integración y regresión;
`06/10` pruebas en push a cualquier rama y todas las suites aunque una falle; `25/10` `/health` y un único workflow que no
despliega si fallan las pruebas o la imagen; `26/10` limpieza de imágenes para no quedarse sin disco; `27/10` monitoreo de disponibilidad (`uptime.yml`).

### Limitaciones
- **El frontend no tiene workflow de CI** (`frontend/.github` no existe); sus 2 291 pruebas se corren a mano.
- No pude consultar los resultados de las corridas de GitHub Actions (no tengo `gh` instalado); las cifras de §1 son
  una **reproducción local de los mismos pasos** del workflow. Conviene adjuntar la captura de la pestaña *Actions*.
- No hay Dependabot ni `npm audit` en el pipeline.

---

## 4. Informe de deuda técnica: qué se completó y qué debía estar completo

Se contrasta el plan de 12 puntos contra el código actual. "Debía estar cerrado" = lo que el criterio de aceptación pedía
para este corte.

| # | Área | Estado | Evidencia | Qué falta |
|---|---|---|---|---|
| 1 | Transporte seguro | **Parcial** | **Verificado en producción el 27/10** (`docs/sprint-10/evidencias-b3/verificacion-produccion-2026-10-27.txt`): certificado Let's Encrypt válido, `http://` redirige con 308 a `https://`, Swagger cerrado, B4 desplegado; `app.config.js` exige https en release; TLS a la BD verificado en código | El puerto 3000 directo sigue respondiendo por HTTP plano (`http://20.63.84.1:3000/health` → 200): cerrarlo en el firewall |
| 2 | Sesiones y autenticación | **Cumplido** (salvo M2b) | Access de 15 min + refresh rotativo, logout que revoca, política de contraseñas, mensajes uniformes, 5 registros/IP/10 min; 55 pruebas de API | Bloqueo por cuenta tras intentos fallidos (M2b) |
| 3 | Correcciones Neurolab | **Parcial** | Hechas las de progreso/foto (E-5), ubicación (E-6), recompensa (E-8), botones (E-9) | Sin corregir: **crear un reto (E-4, 2,50/5)**, abandonar un reto (E-7), colores (E-10) |
| 4 | Cumplimiento legal | **Cumplido** (salvo abogado) | Plazo **7 días** con prueba contra BD real; datos de contacto, regiones y país completos | Aprobación del abogado (dependencia externa) |
| 5 | Subida de imágenes | **Cumplido** | La firma incluye `ContentType` y `ContentLength` con máximo de 5 MB, verificación de bytes después de subir, lecturas con URL firmada | — |
| 6 | Pipeline de entrega | **Parcial** | Despliegue solo si pasan pruebas e imagen; imagen multi-etapa no-root con `HEALTHCHECK` y `npm ci`; semillas de desarrollo fuera de producción | El despliegue aún hace `docker-compose down` y luego `up -d` (hay caída); sin `npm audit` ni Dependabot |
| 7 | Observabilidad y disponibilidad | **Parcial** | `/health` y `/health/ready`; workflow `Uptime` (`.github/workflows/uptime.yml`) cada 5 min con aviso por correo de GitHub; línea base del 27/10 | `LoggingInterceptor` solo registra método, ruta, estado y duración: **sin usuario, IP ni id de petición**; sin Azure Monitor ni alertas por picos de 401/429/5xx; el monitor corre solo desde `main` |
| 8 | Backups y pruebas no funcionales | **No cumplido** | Ensayo de restauración **local**; respaldo de Azure en la VM; batería de seguridad y carga manuales | Backups cada 24 h programados, restauración real desde Azure, carga en staging con umbrales, ZAP recurrente, muestra real de OpenAI/R2 |
| 9 | Dependencias | **Parcial** | Backend: **0** vulnerabilidades de producción | Frontend: 7 (4 altas, de Expo), requiere subir Expo/React Native |
| 10 | Estructura y mantenimiento | **Parcial** | `console.log`: 0 en backend y 0 en frontend; `any`: 9 en backend y 20 en frontend (no se midió el punto de partida) | 5 servicios por encima de 500 líneas (el mayor, 1 863); no hay ayudante seguro para SQL |
| 11 | Cobertura | **Cumplido** (backend) | Backend **80,7 %**, umbral fijado; el frontend ahora se mide también sobre componentes y pantallas (58 %) | Meta y CI propios del frontend |
| 12 | Decisiones de producto | **Cumplido** | Documentadas en `docs/sprint-10/B11-B12-cambios-de-codigo.md`: los retos privados siguen en Explorar; un no miembro no ve la rutina (`routine_hidden`); reabrir notifica (`challenge_reopened`); las etiquetas quedan como ticket del próximo sprint | `GET /challenges/:id/users` sigue visible para cualquier usuario con sesión |

**Resumen:** Cumplidos **5** (2, 4, 5, 11, 12) · Parciales **6** (1, 3, 6, 7, 9, 10) · No cumplidos **1** (8).

(Los puntos 1, 7 y 12 se actualizaron con el trabajo de B11/B12 subido el 27/10 por otra persona del equipo: commits `1f2f9a7`, `6c25d4f` y `7fc053f`.)

### Deuda del sprint anterior (5 compromisos)
| Compromiso | Estado | Nota |
|---|---|---|
| Escalabilidad (PgBouncer, `max_connections`, Redis compartido) | **Cumplido** | Pendiente solo demostrar la meta de 5 000 concurrentes |
| Security Headers | **Cumplido** | ZAP 0 fallos / 1 aviso (cifra sin reporte adjunto) |
| Cumplimiento legal | **Cumplido en código** | El plazo ya es 7 días; falta el abogado |
| Paginación | **Cumplido** | `GET /challenges` −87 a −97 % de latencia en local; `workout-logs` no se midió |
| Cobertura no funcional | **Parcial** | Carga y ZAP siguen manuales |

### Por qué debía estar cerrado y no lo está
- **#7 (logs con usuario/IP/id)** era la base para atribuir un ataque (M7 del AUDIT, abierto desde el 13/10). El monitor de
  disponibilidad ya existe, pero sin usuario, IP e id de petición en los logs un ataque no se puede atribuir.
- **#6 (despliegue sin caída)** y **#8 (backups automáticos)** son infraestructura: dependen de la VM y de Azure, no del
  código, y por eso quedaron fuera de lo verificable aquí.
- **#3 (Neurolab)** tiene un dato claro que no se corrigió: crear un reto sacó 2,50/5, el más bajo de la encuesta, y es el
  requisito de "primer reto sin asistencia".
- **#10 (servicios gigantes)** se pospuso a favor de seguridad y cobertura; es una decisión razonable pero incumple el
  criterio "servicios ≤ 500 líneas".
