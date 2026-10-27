# B11 / B12 — Cambios de código de apoyo (Sprint 10)

Fecha: 2026-10-27. Este documento cubre solo los cambios de **código** de B11 y B12 que no tocan los documentos de Ale Sierra. El registro de decisiones, la tabla del AUDIT, la matriz de requisitos y los documentos legales siguen en los documentos de B11/B12, que pueden citar este.

## 1. Resumen y criterio de aceptación

1. **Retos privados (B11, decisiones a y b).** Un reto privado sigue apareciendo en Explorar. Su detalle (`GET /challenges/:id`) ya no entrega la rutina a quien no es miembro: recibe la forma del ciclo (qué días son de descanso), sin nombres de rutina ni ejercicios, y `routine_hidden: true`.
2. **Aviso al reabrir (B11, decisión d).** `PATCH /challenges/:id/reopen` notifica al creador y a los participantes activos con el tipo nuevo `challenge_reopened`, igual que hace el cierre con `challenge_closed`.
3. **Monitoreo de disponibilidad (B12).** Workflow `Uptime` que cada 5 minutos pide `/health` y `/health/ready` por HTTPS y falla, con aviso por correo de GitHub, si alguno no responde 200.
4. **Cobertura (B12).** El umbral lo fijó Ale Sierra en `package.json` (`24d497c`: líneas 80, sentencias 78, ramas 72, funciones 66). Estos cambios lo respetan: con ellos la cobertura queda en líneas 80.73 %, sentencias 79.16 %, ramas 74.63 % y funciones 67.63 %.

**Criterio:**
- **Cumplido** para 1 y 2 (pruebas en verde, sección 5); 4 se mantiene sobre el umbral.
- **Parcial** para 3: el workflow se probó en local contra producción (éxito y fallo), pero GitHub solo ejecuta los workflows programados desde `main`. Empieza a correr cuando `development` llegue a `main`.

## 2. Decisiones tomadas y alternativas descartadas

| Decisión | Alternativas descartadas | Por qué |
|---|---|---|
| (a) Los retos privados **siguen en Explorar** con nombre, foto, duración, miembros y autor | Ocultarlos de la lista | HU-18 ("solicitar el ingreso a uno privado") necesita poder encontrarlos; ocultarlos exigiría invitaciones o enlaces. Es la decisión original de la auditoría (H3), ahora confirmada por el equipo. |
| (b) Un no miembro **no ve la rutina**: `cycle_days` llega solo con `day_number` e `is_rest_day` | Devolver `cycle_days: []`; responder 403 en el detalle | Con la forma del ciclo la tarjeta y el detalle siguen mostrando duración, ciclo y días de descanso, sin revelar el contenido. Un 403 rompería la pantalla desde donde se solicita unirse. |
| Quién cuenta como miembro: creador, cualquier fila en `challenge_user_map`, invitación **pendiente** o admin | Solo `status = 'active'` | Es la misma regla de "miembro" que ya usa el feed (`challengePrivacyFilter`). El invitado necesita ver a qué lo invitan y el admin cierra y reabre desde esta pantalla. |
| La redacción ocurre **después** de la caché de Redis | Clave de caché por usuario | La entrada cacheada es la misma para todos. Recortarla por lector después mantiene un solo valor en caché, y la consulta de membresía es un `EXISTS` indexado. |
| (c) Etiquetas: **sin cambios** en este sprint | Notificar al etiquetado | Se deja como ticket para el siguiente sprint. Hoy solo se puede etiquetar a participantes del reto y nadie se autoetiqueta. |
| (d) Reabrir notifica, con un **tipo nuevo** `challenge_reopened` | Reutilizar `challenge_closed` con un dato extra | Cada tipo tiene su propio texto, preferencia y navegación. Es el mismo patrón que el resto del catálogo. |
| Monitoreo con **GitHub Actions** | UptimeRobot / Better Stack / Azure Monitor | No necesita cuentas ni permisos nuevos y deja historial público en Actions. Limitación: GitHub puede retrasar las ejecuciones programadas; si hace falta precisión, migrar a UptimeRobot usando las mismas rutas. |

## 3. Archivos creados / modificados

| Archivo | Cambio |
|---|---|
| `src/challenges/challenges.service.ts` | `findOne(id, viewerId)` recorta la rutina de retos privados para no miembros (`canSeePrivateRoutine`). `reopenChallenge` notifica. `notifyChallengeClosed` y la notificación de reabrir comparten `notifyChallengeStatusChange`. |
| `src/challenges/challenges.controller.ts` | `GET /challenges/:id` pasa el usuario actual. Swagger documenta `routine_hidden`. |
| `src/challenges/challenges.service.spec.ts` | 4 pruebas de retos privados y 2 de reabrir. Las llamadas existentes pasan el lector. |
| `src/notifications/notification-catalog.ts` | Código `challenge_reopened` y su texto es/en para push. |
| `database/seeds/2026-10-27-01-notification-type-challenge-reopened.sql` | Fila de `notification_types` (idempotente, `ON CONFLICT`). |
| `.github/workflows/uptime.yml` | Monitoreo cada 5 min de `/health` y `/health/ready`. |

En el frontend (commits aparte): tipo e i18n de `challenge_reopened` y aviso en el detalle cuando `routine_hidden` es `true`. Ver `frontend/docs/sprint-10/B11-cambios-de-app.md`.

## 4. BD, variables de entorno e infraestructura

- **BD:** solo un seed nuevo. El runner lo aplica al arrancar (`prestart` → `db:migrate`). No hay migraciones de esquema.
- **Variables:** el workflow acepta una variable de repositorio opcional `API_URL` (Settings → Variables). Sin ella usa `https://havit-api.canadacentral.cloudapp.azure.com`.
- **A mano:** nada para que funcione. Para recibir los correos de fallo, quien haya hecho el último cambio al `cron` debe tener activadas las notificaciones de Actions en GitHub.

## 5. Cómo se probó

```bash
npx jest src/challenges src/notifications            # 6 suites, 198 pruebas OK
env -u B2_TEST_DB_URL npx jest --ci --coverage      # igual que el CI
#   Tests: 1256 passed, 17 skipped (70 suites)
#   Lines 80.73 %, Statements 79.16 %, Branches 74.63 %, Functions 67.63 %
#   -> pasa el coverageThreshold de package.json (80/78/72/66)
npx eslint <archivos tocados>                        # sin errores nuevos (se compararon contra HEAD)
```

Script del workflow ejecutado en local contra producción:

```
/health -> HTTP 200 en 0.47s
/health/ready -> HTTP 200 en 0.44s: {"status":"ok","checks":{"database":"up","redis":"up"}}
exit 0
# Con API_URL=https://no-existe.invalid -> HTTP 000 en las dos rutas, exit 1
```

Pruebas nuevas en `challenges.service.spec.ts`:

- no miembro → `routine_hidden: true`, `cycle_days` sin nombres ni ejercicios;
- miembro, invitado o admin → rutina completa;
- creador → rutina completa sin consultar membresía;
- reto público → nunca consulta membresía;
- reabrir notifica a creador y participantes activos;
- reabrir sigue funcionando si falla la consulta de participantes.

## 6. Evidencia

- Salidas de la sección 5.
- Línea base de disponibilidad del 27/10 (`backend/docs/sprint-10/evidencias-b3/verificacion-produccion-2026-10-27.txt`): `/health` 200 y `/health/ready` con base de datos y Redis `up`.
- **Objetivo del 99 % mensual = máximo ≈ 7.2 h de caída al mes** (30 d × 24 h × 1 %).

## 7. Pendientes, riesgos y dependencias

- El monitoreo empieza a correr cuando esto llegue a `main` (requiere autorización explícita para el merge a producción).
- El frontend viejo, sin el cambio, muestra la sección del ciclo con días sin nombre a un no miembro de un reto privado; no se rompe. El aviso nuevo llega con la próxima build.
- Las rutinas propias (`GET /routine/:id`) ya eran solo del creador. `/challenges/:id/today` y `/routine/today/:challengeId` ya exigían ser participante activo; no se tocaron.
- `GET /challenges/:id/users` (lista de participantes) sigue visible para cualquier usuario con sesión, también en retos privados. Queda para que B11 decida.
- Umbral de cobertura: el margen en líneas es de 0.73 puntos; un cambio sin pruebas puede tumbar el job `tests` (y por lo tanto el deploy).
- La matriz de B12 (`docs/testing/MATRIZ-REQUISITOS-NO-FUNCIONALES-2026-10-27.md`) todavía marca como pendientes el aviso al reabrir, los retos privados y el monitor externo; queda en manos de B12 actualizarla con este documento.

## 8. Cómo revertir

- `git revert` de los commits del backend. El seed puede quedarse: un tipo sin uso no afecta.
- Para desactivar solo las notificaciones de reabrir sin desplegar: `UPDATE havit.notification_types SET is_active = false WHERE code = 'challenge_reopened';` (`notify` ignora los tipos inactivos).
- Monitoreo: desactivar el workflow en Actions → Uptime → "Disable workflow".
