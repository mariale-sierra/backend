# Matriz de requisitos no funcionales — validación del 2026-10-27

Alcance: `backend/` (`development`, commit base `4863185`) y `frontend/` (`development`, commit base `a821f0b`).
Todas las pruebas de esta sesión se ejecutaron en **local**, con un PostgreSQL 17 desechable (puerto 55440) y un
directorio de ejecución con su propio `.env`, sin credenciales de Azure, R2 ni OpenAI. No se hicieron peticiones al
servidor público ni a la base de Azure.

## 0. Fuente de los 34 requisitos

La lista sale del informe del sprint anterior ("Comparación con los requisitos no funcionales del diseño"), que cuenta
**18 evaluados** (Cumplen 6, No cumplen 3, Parciales 3, Ayuda y documentación 3, Soporte 3) y **16 sin prueba dedicada**
(Apariencia 3, Usabilidad 3, disponibilidad, portabilidad, legal, backups, sincronización y 5 de software/hardware/
restricciones). El documento de diseño original no está en ningún repositorio, y el informe agrupa algunos requisitos,
así que **dos desgloses son una interpretación** y hay que cotejarlos con el diseño: RAM y almacenamiento (filas 31 y 32)
se separaron, y "exclusividad móvil / orientación vertical / sensores" (fila 34) se dejó como una sola.

## 1. Matriz (34)

Estados: **Cumple** · **Parcial** · **No cumple** · **Sin evidencia** (no hay código ni prueba que lo respalde) ·
**Planificado** (depende de infraestructura, dispositivos o personas). La columna "Informe anterior" muestra el estado
que tenía en el informe del sprint pasado.

| # | Requisito | Informe anterior | Estado hoy | Resultado y evidencia | Falta |
|---|---|---|---|---|---|
| 1 | Autenticación obligatoria (correo + contraseña cifrada) | Cumple | **Cumple** | bcrypt + política de contraseñas (`backend/src/auth/auth.service.ts`, `password-policy.ts`); batería de seguridad 78 PASS / 0 hallazgos (`backend/docs/security/scripts/security-probe-results-2026-10-27.json`); JWT de 15 min + refresh rotativo | bcrypt costo 10 (mínimo OWASP); valorar 12 |
| 2 | Backend en Linux/Docker/nube pública | Cumple | **Cumple** | `backend/Dockerfile` multi-etapa, `USER node`, `HEALTHCHECK`; imagen verificada en CI (`.github/workflows/ci.yml`, job `image`) | — |
| 3 | PostgreSQL 14+ | Cumple | **Cumple** | CI con `postgres:16`; pruebas de hoy con 17 (68 archivos SQL aplicados sin error) | — |
| 4 | Moderación de contenido en ≤ 24 h | Cumple | **Cumple** | Cron cada 10 min (`backend/src/workout-posts/workout-posts.service.ts:332`) y reportes con ocultamiento inmediato; `backend/docs/moderacion-automatica.md` | Medir la latencia real de la cola contra OpenAI |
| 5 | Visibilidad de publicaciones | Cumple | **Cumple** | Reglas del feed y, desde hoy, las mismas en comentarios, reacciones y reportes por id (`workout-post-visibility.util.ts` + spec, H-01) | — |
| 6 | Unidades de medida configurables | Cumple | **Cumple (en código)** | Cada métrica de ejercicio lleva su `default_unit` (`backend/database/init/2026-07-07-00-init-schema.sql`) y el frontend maneja `lbs`/`reps`/etc. (`frontend/types/metrics.ts`) | **No hay selector de unidades para el usuario** (no encontré ninguno). Confirmar si el requisito lo exige |
| 7 | Capacidad y concurrencia ≥ 5 000 | No cumple | **No cumple** | No demostrado: límite de 300 req/min por IP, un contenedor, solo medición local (§3) | Prueba en staging con varias instancias, PgBouncer y Redis |
| 8 | Aceptación de términos y condiciones | No cumple | **Cumple** | Flujo implementado: `backend/database/migrations/2026-10-02-03-terms-acceptance-and-account-deletion.sql`, `src/auth/terms-version.ts`, `frontend/app/accept-terms.tsx`; auditoría con versión `2026-10-v1` | Revisión del abogado (fila 27) |
| 9 | Eliminación de cuenta/datos en ≤ 7 días | No cumple | **Cumple (con matiz)** | Endpoint y purga automática; `ACCOUNT_DELETION_GRACE_DAYS = 7`, probado contra Postgres real (`account-deletion.integration.spec.ts`) | La purga corre cada hora, así que ocurre hasta ~1 h después de los 7 días |
| 10 | Tiempos de respuesta (login/foto/pantalla) | Parcial | **Parcial** | 0 errores 5xx bajo 100 conexiones con límites de producción; sin limitador `/feed` 587 req/s p99 331 ms (§3) | Medir contra Azure real, con umbrales |
| 11 | Cifrado de información personal | Parcial | **Parcial** | Contraseñas con bcrypt y Azure cifra en reposo; TLS a la BD verificado en código (`src/config/db-ssl.ts`) | Cifrado explícito por columna (correo, fotos, métricas) |
| 12 | Integración con API externa (≥ 95 % de éxito) | Parcial | **Parcial** | OpenAI y R2 integradas con timeouts y reintentos acotados (`backend/docs/confiabilidad/B11-CONFIABILIDAD-BACKUPS-INTEGRACIONES.md` §6–7); verificación de bytes tras la subida (H-02) | Muestra real con credenciales (`backend/scripts/b11-integration-sample.js`) |
| 13 | Sección de ayuda | Parcial | **Cumple** | `frontend/app/profile/help.tsx` (+ test) | Contenido a ajustar según Neurolab |
| 14 | Tutorial inicial | Parcial | **Parcial** | `frontend/app/onboarding/practices.tsx` solo selecciona prácticas; el directorio `app/(auth)/onboarding` está vacío | Tutorial real del primer uso |
| 15 | FAQ | Parcial | **Cumple** | Ayuda/FAQ de Sprint 10 B9 dentro de `help.tsx` | Ampliar según Neurolab |
| 16 | Cobertura de pruebas unitarias ≥ 80 % | Parcial | **Parcial** | **Backend 80,7 %** (cumple, umbral fijado en `package.json`); **frontend 58,05 %** (§5) | Meta y CI del frontend |
| 17 | Adaptabilidad de dificultad/pantalla | Parcial | **Sin evidencia** | No encontré ningún código de "dificultad" en backend ni frontend | Definir el requisito (¿nivel del reto? ¿responsive?) y probarlo |
| 18 | Configuración de notificaciones y panel de administración | Parcial | **Parcial** | Notificaciones con preferencias (`frontend/app/notification-settings.tsx`); panel de moderación y bans (`frontend/app/profile/moderation.tsx`) | `reopenChallenge` no notifica (§6) |
| 19 | Apariencia: paleta neutra / lenguaje inclusivo | Sin prueba | **Sin evidencia** | No evaluado | Revisión de diseño |
| 20 | Apariencia: tiempo de renderizado < 4 s | Sin prueba | **Sin evidencia** | Sin medición dedicada | Medir en dispositivo |
| 21 | Apariencia: consistencia visual | Sin prueba | **Parcial** | Tokens de tema y componentes compartidos (`frontend/constants/theme`, `components/ui`); encuesta: "visualmente atractiva" 4,00/5 (E-11) | Evaluación visual en dispositivo |
| 22 | Usabilidad: navegación sin ayuda | Parcial | **Parcial** | Neurolab: crear cuenta 4,75, Home 4,00, encontrar retos 4,25 (`frontend/docs/sprint-10/B2-navegacion-comprension.md` §9.3, 4 participantes) | Repetir tras las correcciones |
| 23 | Usabilidad: satisfacción | Parcial | **Parcial** | Neurolab: atractiva 4,00, motivaría a seguir 4,00 (E-11, E-12) | Muestra mayor |
| 24 | Usabilidad: primer reto sin asistencia | Parcial | **Parcial** | Neurolab: "comprendí cómo crear un reto" **2,50** (E-4, el más bajo; sin corrección en B2) | Corregir y volver a medir |
| 25 | Disponibilidad ≥ 99 % mensual | Sin prueba | **Planificado** | `/health` y `/health/ready` existen y CI los prueba; no hay monitor externo | Monitor (UptimeRobot/Better Stack/Azure Monitor) durante un mes; 99 % ≈ 7,2 h de caída/mes |
| 26 | Portabilidad: Android/iOS | Sin prueba | **Parcial** | EAS Build con perfiles `development/preview/production` y https obligatorio en release (`frontend/eas.json`, `app.config.js`) | Validar en Android 10 e iOS 15 reales |
| 27 | Legal: normativa local de privacidad | Sin prueba | **Parcial** | Documentos legales con datos completos (`frontend/constants/legal/legalDocs.ts`), consentimiento 16+ y eliminación con auditoría | **Revisión del abogado** (dependencia externa, §7) |
| 28 | Confiabilidad: backups automáticos cada 24 h | Sin prueba | **Parcial** | Ensayo local 60/60 tablas en 0,54 s; respaldo de Azure en la VM (`B11-CONFIABILIDAD-BACKUPS-INTEGRACIONES.md`) | Programar cada 24 h y restaurar de verdad desde Azure |
| 29 | Interfaz interna: sincronización ≤ 5 s | Sin prueba | **Sin evidencia** | Sin medición dedicada | Instrumentar y medir |
| 30 | Compatibilidad de dispositivos | Sin prueba | **Planificado** | — | Pruebas en dispositivos reales |
| 31 | RAM | Sin prueba | **Planificado** | — | Medir en dispositivo |
| 32 | Almacenamiento | Sin prueba | **Planificado** | — | Medir en dispositivo |
| 33 | Conexión estable | Sin prueba | **Parcial** | Timeout de 30 s y manejo de errores de red en `frontend/services/api.ts` | Pruebas con datos móviles |
| 34 | Exclusividad móvil / orientación vertical / sensores | Sin prueba | **Parcial** | `"orientation": "portrait"` en `frontend/app.json` | Validar en dispositivo |

**Resumen:** Cumplen **10** · Parciales **15** · No cumple **1** · Sin evidencia **4** (17, 19, 20, 29) · Planificados
**4** (25, 30, 31, 32). Total 34.

Cambios frente al informe anterior: **8** (términos) y **9** (eliminación ≤ 7 días) pasaron de *No cumple* a *Cumple*;
**13** y **15** (ayuda y FAQ) pasaron de *Parcial* a *Cumple*; la seguridad ya no tiene hallazgos abiertos en la batería
(0 de 88). Siguen sin cumplirse la capacidad ≥ 5 000 (7) y todo lo que depende de dispositivos o monitoreo.

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
| Media | Sin código de "dificultad" ni selector de unidades para el usuario (filas 6 y 17) | Confirmar con el diseño si el requisito lo exige |

## 9. Medibilidad de los requisitos (definiciones propuestas)

El informe del sprint anterior señaló cuatro requisitos mal acotados. Propuesta para cerrarlos, **sujeta a tu
aprobación**:

| Requisito | Problema | Definición propuesta |
|---|---|---|
| 7. "Al menos 5 000" | No dice la unidad | 5 000 **usuarios activos simultáneos** sobre la API completa, con p95 < 1 s y < 1 % de errores 5xx, medido en staging |
| 25. Disponibilidad ≥ 99 % | No dice cómo medirla | Monitor externo cada 1–5 min sobre `/health/ready`; el mes cuenta como cumplido con ≤ 7,2 h acumuladas de caída |
| 1. "Correo y un código o contraseña" | Ambiguo si son alternativas | Hoy: **correo + contraseña** (sin código). Confirmar que es lo exigido |
| 28. Backups cada 24 h | Sin RPO/RTO ni prueba de restore | Backup diario verificado, restore real mensual; RPO ≤ 15 min y RTO ≤ 4 h como objetivos (no SLA) hasta medirlos |
