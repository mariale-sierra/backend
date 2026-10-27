# Matriz de requisitos no funcionales — validación del 2026-10-27

Alcance: `backend/` (`development`, commit base `4863185`) y `frontend/` (`development`, commit base `a821f0b`).
Todas las pruebas de esta sesión se ejecutaron en **local**, con un PostgreSQL 17 desechable (puerto 55440) y un
directorio de ejecución con su propio `.env`, sin credenciales de Azure, R2 ni OpenAI. No se hicieron peticiones al
servidor público ni a la base de Azure.

## 0. Advertencia sobre la fuente de los 34 requisitos

El documento original de requisitos **no está en ningún repositorio** (`HISTORIAS-DE-USUARIO.md` contiene 64 historias de
usuario, no los 34 requisitos no funcionales). Esta lista de 34 se **reconstruyó** a partir del resumen de grado de
cumplimiento del informe de sprint (9 cumplen, 12 parcial, 1 no cumple, 12 planificados). Los nombres de los grupos
(p. ej. "Apariencia (3)", "Usabilidad (3)") se desglosaron en filas individuales. **Hay que cotejar los números y nombres
con el documento original** antes de entregarla; si difieren, cambia la columna "Requisito" y conserva la evidencia.

## 1. Matriz (34)

Estados: **Cumple** · **Parcial** · **No cumple** · **Planificado** (depende de infraestructura, dispositivos o personas,
fuera de lo que se puede comprobar desde el código).

| # | Requisito | Estado | Resultado y evidencia | Falta |
|---|---|---|---|---|
| 1 | Autenticación obligatoria con contraseña cifrada | **Cumple** | bcrypt + política de contraseñas (`backend/src/auth/auth.service.ts`, `password-policy.ts`); 78 PASS / 0 hallazgos en la batería (`backend/docs/security/scripts/security-probe-results-2026-10-27.json`: A02, A07). JWT HS256 de 15 min + refresh rotativo | bcrypt con costo 10 (mínimo OWASP); valorar 12 |
| 2 | Backend en Linux/Docker | **Cumple** | `backend/Dockerfile` multi-etapa, `USER node`, `HEALTHCHECK` sobre `/health`; imagen verificada en CI (`backend/.github/workflows/ci.yml`, job `image`) | — |
| 3 | PostgreSQL 14+ | **Cumple** | CI usa `postgres:16`; pruebas locales con 17 (68 archivos SQL aplicados sin error) | — |
| 4 | Moderación en ≤ 24 h | **Cumple** | Cron cada 10 min (`backend/src/workout-posts/workout-posts.service.ts:332`) + reportes con ocultamiento inmediato; `backend/docs/moderacion-automatica.md`, `moderacion-manual.md` | Medir la latencia real de la cola contra OpenAI con credenciales |
| 5 | Visibilidad de publicaciones | **Cumple** | Reglas de feed (`workout-posts.service.ts` `postVisibilityFilter`) y, desde hoy, las mismas reglas en comentarios, reacciones y reportes por id (`workout-post-visibility.util.ts` + `.spec.ts`, hallazgo H-01) | — |
| 6 | Unidades configurables | **Cumple** | Preferencias de unidades en el frontend (`frontend/app/profile/settings.tsx`) | Sin prueba específica de esa pantalla |
| 7 | Aceptación de términos con auditoría | **Cumple** | `backend/database/migrations/2026-10-02-03-terms-acceptance-and-account-deletion.sql`, `src/auth/terms-version.ts`, `frontend/app/accept-terms.tsx`; versión `2026-10-v1` | Si el texto legal cambia materialmente hay que subir `LEGAL_VERSION`/`CURRENT_TERMS_VERSION` (ver §6) |
| 8 | Sin errores de integridad en la interfaz interna | **Cumple** | E2E contra Postgres real: `backend/test/api-integration.e2e-spec.ts` (30 casos) y `auth-sessions.e2e-spec.ts` (24); integración de BD en `account-deletion.integration.spec.ts` | — |
| 9 | Paginación de listados | **Cumple** | Paginación por cursor en retos, feed y logs (`backend/src/common/pagination.util.ts`); latencia de `GET /challenges` −87–97 % en local (`backend/performance/B1-RESULTS.md`) | — |
| 10 | Concurrencia y tiempos de respuesta | **Parcial** | Con límites de producción: 0 errores 5xx bajo 100 conexiones (F1–F3). Sin limitador: `/feed` 587 req/s p99 331 ms; `/challenges` 378 req/s p99 592 ms (§4) | Medir contra Azure/staging con umbrales; solo hay medición local |
| 11 | Seguridad | **Parcial** | 88 comprobaciones: 78 PASS, 10 INFO, **0 hallazgos** (antes 20). `npm audit` backend 0 vulnerabilidades de producción | HTTPS real verificado, ZAP autenticado recurrente, M4/M7/M8 (§3) |
| 12 | Legal (abogado, plazo de 7 días, contacto) | **Parcial** | Plazo de eliminación **7 días** (`ACCOUNT_DELETION_GRACE_DAYS = 7`, probado en `account-deletion.integration.spec.ts` contra Postgres real); datos de contacto, regiones y país completados en `frontend/constants/legal/legalDocs.ts` | **Aprobación del abogado** (dependencia externa, §7) |
| 13 | Backups | **Parcial** | Ensayo de restauración local (60/60 tablas, 0,54 s) y respaldo de Azure en la VM: `backend/docs/confiabilidad/B11-CONFIABILIDAD-BACKUPS-INTEGRACIONES.md`; RPO ≤ 15 min / RTO ≤ 4 h son objetivos propuestos, no SLA | Programar backups cada 24 h y restaurar de verdad desde Azure midiendo RPO/RTO (sección 4 de ese documento, "no ejecutado") |
| 14 | Integraciones externas (OpenAI, R2) | **Parcial** | Timeouts y reintentos acotados, métrica de éxito/error: `B11-...md` §6–7; firma de subida con validación de bytes (`uploads.service.ts` `verifyUploadedObject`, hallazgo H-02 resuelto) | Muestra real de OpenAI/R2 ≥ 95 % con credenciales (`backend/scripts/b11-integration-sample.js`) |
| 15 | Cobertura de pruebas | **Parcial** | Backend **80,7 %** de líneas (meta 80 % cumplida, umbral fijado); frontend 58,05 % (§5) | Frontend: meta y CI propios |
| 16 | Notificaciones y panel de administración | **Parcial** | Notificaciones con preferencias; panel de moderación, bans y reapertura de retos (`frontend/app/profile/moderation.tsx`, `backend/src/challenges`) | `reopenChallenge` no notifica (ver §6, decisión pendiente) |
| 17 | Ayuda y documentación | **Parcial** | Pantalla de ayuda (`frontend/app/profile/help.tsx`) y onboarding (`frontend/app/onboarding`) | FAQ y ayuda según correcciones Neurolab |
| 18 | Portabilidad | **Parcial** | EAS Build configurado, perfiles `development/preview/production` y HTTPS obligatorio en release (`frontend/eas.json`, `app.config.js`) | Validar en Android 10 / iOS 15 reales |
| 19 | Usabilidad — evaluación | **Parcial** | Pruebas UX y Neurolab realizadas, hallazgos documentados (`frontend/docs/sprint-10/B2-navegacion-comprension.md`) | — |
| 20 | Usabilidad — correcciones | **Parcial** | Áreas de mejora especificadas | Implementar y verificar cada una |
| 21 | Usabilidad — verificación posterior | **Parcial** | Pendiente de las correcciones | Repetir la sesión sobre lo corregido |
| 22 | Capacidad y concurrencia ≥ 5 000 | **No cumple** | No demostrado; el límite por IP (300 req/min) y un solo contenedor lo impiden | Prueba de carga en staging, varias instancias + PgBouncer + Redis |
| 23–25 | Apariencia (3) | **Planificado** | Sin medición dedicada | Revisión visual en dispositivo (Gestalt/consistencia) |
| 26 | Disponibilidad ≥ 99 % mensual | **Planificado** | `/health` y `/health/ready` existen y CI los prueba; no hay monitor externo | Configurar UptimeRobot/Better Stack/Azure Monitor y medir un mes (99 % ≈ 7,2 h de caída/mes) |
| 27 | Cumplimiento normativo de privacidad | **Planificado** | Eliminación con auditoría, consentimiento 16+, documentos legales completos | Revisión legal formal; cifrado de columnas de datos personales |
| 28 | Sincronización entre módulos ≤ 5 s | **Planificado** | Sin medición dedicada | Instrumentar y medir en dispositivo |
| 29 | Compatibilidad de dispositivos | **Planificado** | — | Pruebas en Android 10 e iOS 15 |
| 30 | RAM | **Planificado** | — | Medir en dispositivo |
| 31 | Almacenamiento | **Planificado** | — | Medir en dispositivo |
| 32 | Conexión estable | **Planificado** | Timeout de 30 s y manejo de errores de red en `frontend/services/api.ts` | Pruebas con datos móviles |
| 33 | Orientación | **Planificado** | — | Validar orientación vertical en dispositivo |
| 34 | Sensores | **Planificado** | — | Validar en dispositivo |

**Resumen:** Cumplen 9 · Parciales 12 · No cumple 1 · Planificados 12. La suma coincide con 34. En esta sesión no cambió
ningún estado global; cambió la evidencia: legal ya tiene datos y plazo de 7 días (sigue parcial por el abogado) y
seguridad pasó de 20 hallazgos a 0 en la batería.

## 2. Pruebas de seguridad (2026-10-27)

Herramienta: `backend/docs/security/scripts/security-probe.mjs` (88 comprobaciones, 4 usuarios: normal, privado, ajeno,
admin). Evidencia cruda: `backend/docs/security/scripts/security-probe-results-2026-10-27.json`.

| | 2026-10-13 | 2026-10-27 |
|---|---|---|
| PASS | 60 | **78** |
| INFO | 8 | 10 |
| FINDING | 20 | **0** |

Hallazgo real que seguía abierto y se corrigió: **A03-02**, la búsqueda `q=%` listaba a todos los usuarios (`LIKE` sin
escapar). Ahora `escapeLike` (`backend/src/common/escape-like.util.ts`) se aplica a la búsqueda de usuarios y de
ejercicios, con pruebas.

La batería estaba desactualizada y se ajustó (`security-probe.mjs`): el logout ahora exige el refresh token (B4), el
perfil privado devuelve solo datos básicos por diseño, `testuser` solo cuenta si sigue **activo**, y las respuestas 429
del propio limitador se marcan **no concluyentes** en vez de PASS/FINDING. Los tres casos afectados (A07-03, A03-07,
A07-09) se comprobaron aparte en una instancia limpia: 409 con mensaje único, 400 y 401.

Casos informativos: A02-07 bcrypt costo 10; A01-08 `GET /routine/:id` lo lee cualquier usuario autenticado (decisión
pendiente, §6); A02-08 la prueba corre en HTTP local, no verifica el despliegue; A03-06 el JSON devuelve `<script>`
tal cual (el cliente no renderiza HTML).

`npm audit` (solo dependencias de producción): **backend 0** (antes 2 moderadas); **frontend 7** (3 moderadas, 4 altas:
`expo`, `@expo/cli`, `node-forge`, `zod`), cuyo arreglo exige subir Expo/React Native (tarea de dependencias).

### Estado final de los IDs del AUDIT (`AUDITORIA-OWASP-Y-CARGA-2026-10-13.md`)

| ID | Estado | Evidencia de esta sesión |
|---|---|---|
| H1 HTTPS | **Parcial** | Caddy + redirección y `app.config.js` exige https en release (código); el despliegue real no se verificó. Prueba pendiente en el ambiente desplegado |
| H2 `testuser` | **Cerrado** | Migración `2026-10-13-02-disable-seeded-testuser.sql`; `db:migrate` deja `is_active=false` (A05-07 PASS, A07-09 → 401) |
| H3 Retos sin sesión | **Cerrado** | A01-02/04/05 PASS |
| H4 `imageUrl` | **Cerrado** | A10-01 PASS (5 payloads) y validación de ruta normalizada (H-18, `upload-url.util.spec.ts`) |
| H5 Dependencias | **Parcial** | Backend 0; frontend 7 (4 altas, Expo) |
| M1 JWT sin revocación | **Cerrado en código** | A07-08 PASS: tras logout con refresh token, `/users/me` ya no responde 200 |
| M2 Contraseñas | **Cerrado en código** | A07-04 PASS; M2b (bloqueo por cuenta) sigue pendiente |
| M3 Enumeración | **Parcial** | Login uniforme (A07-02 PASS); registro devuelve 409 único ("Email or username already in use"), que confirma existencia; `%` en búsqueda cerrado hoy |
| M4 Subida R2 sin límite de tamaño | **Parcial** | Verificación de bytes tras la subida (H-02); la URL firmada sigue sin limitar tamaño |
| M5 CORS/Swagger | **Cerrado** | A01-00, A05-01, A05-02 PASS |
| M6 413/500 | **Cerrado** | A04-01 PASS |
| M7 Trazabilidad | **Abierto** | Sin usuario/IP/id de petición ni alertas |
| M8 Pipeline | **Parcial** | Despliegue exige pruebas, imagen no-root con `HEALTHCHECK`; pendientes despliegue sin caída y Dependabot |
| M9 TLS a la BD | **Cerrado en código** | `src/config/db-ssl.ts`; no se probó contra Azure |

## 3. Pruebas de inundación y volumen (2026-10-27, local)

Herramienta: `autocannon` vía `backend/docs/security/scripts/flood-probe.mjs`. Evidencia:
`backend/docs/security/scripts/flood-results-2026-10-27.json`. Dos instancias locales: 3100 con los límites de
producción (300 req/min/IP) y 3101 con el limitador global casi apagado. Base local, un proceso, portátil: sirve para
**comparar endpoints entre sí**, no representa la latencia de Azure.

| Escenario | req/s | p99 | 2xx | 4xx | 5xx |
|---|---|---|---|---|---|
| F1 `GET /` sin sesión, 100 conexiones (límites de producción) | 2 021 | 98 ms | 298 | 19 912 (429) | **0** |
| F2 login con contraseña incorrecta, 50 conexiones | 1 784 | 40 ms | 0 | 17 841 (429) | **0** |
| F3 `GET /feed` autenticado (límites de producción) | 2 096 | 61 ms | 0 | 20 960 (429) | **0** |
| F4 `GET /feed` (sin limitador) | 587 | 331 ms | 8 812 | 0 | **0** |
| F5 `GET /workout-posts/mine` (sin limitador) | 674 | 225 ms | 6 735 | 0 | **0** |
| F6 `GET /challenges` con sesión (sin limitador) | 378 | 592 ms | 3 778 | 0 | **0** |
| F7 `GET /users/search?q=%` (sin limitador) | 771 | 328 ms | 7 710 | 0 | **0** |
| F8 `POST /auth/register` (sin limitador global) | 1 844 | 22 ms | 1 | 20 278 | **0** |
| F9 cuerpo de 2 MB (sin limitador) | 323 | 146 ms | 0 | 2 584 (413) | **0** |

Lectura:
- El limitador protege contra un solo atacante: la salud del servidor siguió respondiendo (5–17 ms) tras F1, F2 y F4.
- **F8 no mide el costo de bcrypt**: el registro tiene su propio límite por ruta (5 por IP cada 10 min) que sigue activo
  aunque se apague el global; solo 1 de 20 279 pasó. Para medir bcrypt hay que hacerlo secuencialmente o en staging.
- **F6 no es comparable con el 13/10** (474 req/s p99 321 ms), porque entonces `/challenges` era público; ahora exige
  sesión. Tampoco `/feed` (964 req/s): la máquina y la carga no eran las mismas.
- La batería original se caía en F9 en Windows (`ENAMETOOLONG`, cuerpo en la línea de comandos); se corrigió con un
  archivo de cuerpo y escritura incremental de resultados. Una comprobación de salud falló una vez de forma transitoria
  justo después de F6; las siguientes respondieron 200.
- **No cubierto**: ataque distribuido real (el límite es por IP), varias instancias, Azure. Tarea de carga en staging.

## 4. Pruebas contra base real añadidas hoy

- `src/users/account-deletion.integration.spec.ts` (Postgres real, 10 pruebas en total junto al spec unitario):
  - la cancelación confirmada **antes** de que la purga bloquee la fila no borra nada de R2 (H-19);
  - una cancelación que llega **durante** la purga espera y recibe 404, nunca éxito (H-19);
  - cancelar sin solicitud pendiente responde 404 y no escribe auditoría.
- Esta última prueba destapó un **bug previo**: `cancelDeletion` comprobaba `rows.length === 0`, pero TypeORM devuelve
  `[filas, contador]` para `UPDATE ... RETURNING`, así que **siempre respondía éxito** y escribía una auditoría
  "cancelled" falsa, incluso sobre una cuenta ya purgada. Corregido y cubierto con prueba unitaria y de integración.

## 5. Cobertura de pruebas

Medida el 2026-10-27, solo pruebas unitarias (sin `B2_TEST_DB_URL`, igual que el job `tests` de CI).

| | Líneas | Sentencias | Ramas | Funciones | Pruebas |
|---|---|---|---|---|---|
| **Backend** | **80,70 %** (4 966 / 6 153) | 79,13 % | 74,57 % | 67,55 % | 1 250 pasan, 17 omitidas, 70 de 73 suites |
| **Frontend** | **58,05 %** (4 301 / 7 408) | 57,40 % | 53,65 % | 52,77 % | 2 291 pasan, 5 omitidas, 196 de 197 suites |

Comandos:

```bash
cd backend  && env -u B2_TEST_DB_URL npx jest --ci --coverage --coverageReporters=json-summary --coverageReporters=text-summary
cd frontend && npx jest --ci --coverage --coverageReporters=json-summary --coverageReporters=text-summary
```

- **Backend: la meta del 80 % de líneas se cumple** (el informe anterior decía 78 %; el 6/10 eran 73,4 %), con margen de
  solo unas 43 líneas. Por eso se fijó el umbral en `backend/package.json` (`coverageThreshold`): líneas 80, sentencias
  78, ramas 72, funciones 66, siempre por debajo de lo medido. Aún no se ha visto correr en CI con ese umbral.
- Módulos con más líneas sin cubrir (donde más rinde cubrir): `exercises.service.ts` (97 líneas, 59 %),
  `challenges.controller.ts` (71, 0 %), `exercises.controller.ts` (47, 0 %), `users.controller.ts` (41, 0 %),
  `app.module.ts` y `challenges.module.ts` (cableado, poco valor).
- **Frontend: 58 %**, ya sobre `services`, `hooks`, `i18n`, `components` y `app` (antes solo servicios, hooks e idiomas, 50 %).
  No hay umbral ni CI en el frontend (`frontend/.github/workflows` no existe); no se fijó umbral porque no hay meta
  acordada para el frontend ni pipeline que lo ejecute.

## 6. Registro de decisiones

| Qué | Quién | Cuándo | Decisión y motivo |
|---|---|---|---|
| Plazo de eliminación de cuenta | Ale Sierra | 2026-10-27 | **7 días** (el requisito dice 7). Las eliminaciones ya programadas **se respetan**: la purga usa la fecha guardada en cada cuenta (`deletion_scheduled_for`), así que solo las solicitudes nuevas usan 7 días |
| Datos legales | Ale Sierra | 2026-10-27 | Responsable HAVIT, domicilio Ciudad de Guatemala, Guatemala; contacto de privacidad y soporte `havit_support@gmail.com`; Azure y R2 en Canadá; copias de seguridad hasta 7 días; respuesta a derechos en 30 días; leyes de Guatemala |
| Línea de ayuda | Ale Sierra / asistente | 2026-10-27 | Se citó **911 (emergencias)**. Se indicó "123" (bomberos) con duda; no se usó. **Verificar el número** antes de publicar |
| `LEGAL_VERSION` | **pendiente** | — | El texto legal cambió (plazo de 7 días y datos). Subir `LEGAL_VERSION` obligaría a todos los usuarios a aceptar de nuevo (`terms-version.ts` en backend debe coincidir). No se subió: decidir con el abogado |
| Retos privados en Explorar | **pendiente** | — | Hoy se listan a usuarios con sesión para poder solicitar unirse (H3). Decidir con qué datos |
| Rutinas de un reto privado (`GET /routine/:id`) | **pendiente** | — | Hoy lo lee cualquier usuario autenticado (A01-08) |
| Etiquetas de participantes | **pendiente** | — | Existen (`workout_post_tagged_users`); decidir si se notifica al etiquetado y dónde se ven |
| Aviso al reabrir un reto | **pendiente** | — | `reopenChallenge` no notifica; sería un espejo de `notifyChallengeClosed` |

## 7. Dependencias externas

| Dependencia | Responsable | Registrada | Estado |
|---|---|---|---|
| Aprobación legal de Términos y Privacidad (incluye `LEGAL_VERSION`) | Abogado | 2026-10-27 | **Pendiente**; no marcar completa hasta recibirla |
| Verificar línea de ayuda 911 para Guatemala | Ale Sierra | 2026-10-27 | Pendiente |
| Monitor externo de disponibilidad sobre `/health` (UptimeRobot/Better Stack/Azure Monitor) | Ale Sierra | 2026-10-27 | Pendiente: requiere cuenta |
| Ventana y entorno para carga contra Azure/staging (la BD es compartida; 300 req/min por IP) | Equipo | 2026-10-27 | Pendiente: coordinar |
| Pruebas en dispositivos (Android 10, iOS 15) | Equipo | 2026-10-27 | Pendiente |
| ZAP re-run y autenticado | Equipo | 2026-10-27 | Pendiente (necesita ambiente desplegado) |
| Prueba conjunta auth + imágenes + despliegue en el ambiente desplegado | Equipo | 2026-10-27 | Pendiente |
| Muestra real de OpenAI/R2 con credenciales | Equipo | 2026-10-27 | Pendiente |
| Programar backups cada 24 h y restaurar desde Azure | Equipo | 2026-10-27 | Pendiente |

## 8. Defectos abiertos

| Severidad | Defecto | Nota |
|---|---|---|
| Alta | H1: HTTPS real sin verificar en el despliegue | Código y configuración listos |
| Media | M7: sin trazabilidad ni alertas | Pendiente |
| Media | M4: la URL firmada de R2 no limita el tamaño | Mitigado por verificación posterior |
| Media | Frontend: 7 vulnerabilidades de producción (4 altas) | Requiere subir Expo |
| Media | Registro confirma existencia con 409 | Aceptado hasta decidir verificación de correo |
| Baja | bcrypt costo 10 | Valorar 12 |
| Baja | H-12: `rounds` se captura pero no se persiste | Sin métrica de backend equivalente |
| Baja | H-15: `npm start` borra `.env.local` | Comportamiento documentado a propósito |
