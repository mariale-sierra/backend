# Sprint 10 · B5 — Seguridad de fotografías y Cloudflare R2

Responsable: Martin Villatoro · Rama: `feature/sprint10-b5-fotos-r2` (desde `development`), en los dos repositorios.
Referencia principal de B5 para backend y frontend. El documento hermano `frontend/docs/sprint-10/B5-fotografias-r2.md` cubre solo la parte de la app.

> Nada de esto está desplegado ni se ejecutó contra Azure. Las pruebas de integración corrieron contra un Postgres local descartable (`havit_b5_test`, Docker, puerto 5433, borrado al terminar). El bucket R2 sigue **público**: CP0 (verificación independiente contra R2 real) y CP4b (hacerlo privado) **no se ejecutaron**, por instrucción explícita.

## 1. Resumen y criterio de aceptación

B5 cubre tres checkpoints de un plan de 9 (CP0–CP8): **CP1** (firma de subida: Content-Type/Content-Length/If-None-Match), **CP2** (verificación post-subida: HeadObject + magic bytes, rechazo y borrado de objetos inválidos), **CP4a** (URLs de lectura firmadas en todos los puntos de lectura de fotos), **CP6** (ajustes de frontend: tipo MIME real, compatibilidad con las URLs firmadas) y **CP7** (matriz de pruebas automatizadas de abuso/autorización, más la corrección del mecanismo de moderación, §14). **CP0** (prueba independiente contra R2 real) y **CP4b** (volver privado el bucket) quedan explícitamente pendientes — ver §13 y §15.

**Criterio: cumplido para CP1/CP2/CP4a/CP6/CP7**, con las correcciones ya aplicadas y pruebas en verde (§5, §14). **CP0 se autorizó pero no pudo ejecutarse**: no hay credenciales de Cloudflare R2 disponibles en este entorno (ni de prueba ni de producción) — ver §13. **No se puede declarar cumplido el criterio de privacidad real** mientras el bucket siga público y CP0/CP4b no se ejecuten — eso depende de infraestructura (Cloudflare), fuera de este alcance.

## 2. Decisiones técnicas

| Decisión | Alternativa descartada | Motivo |
|---|---|---|
| Firmar `Content-Type`, `Content-Length` e `If-None-Match: '*'` en la URL de subida (CP1/CP2), vía `signableHeaders` explícito (`@aws-sdk/s3-request-presigner` trata `content-type` como no firmable por defecto). | Confiar en lo que el cliente declara sin firmarlo. | El tamaño y tipo reales quedan atados a la firma; una segunda subida a la misma key queda bloqueada por R2 (según su propia documentación — no verificado de forma independiente, CP0 no autorizado). |
| Verificación post-subida con HeadObject + primeros bytes (firma mágica) para JPEG/PNG/WebP, distinguiendo 400 (objeto ausente o contenido inválido, con borrado) de 503 (fallo transitorio de R2, sin borrado). | Confiar en el Content-Type declarado sin inspeccionar los bytes reales. | Un archivo HTML renombrado a `.jpg` pasa el Content-Type pero no la firma mágica; un 503 transitorio no debe borrar un objeto que sí es válido. |
| El tamaño declarado en `/uploads/sign` se vincula en Redis (TTL 15 min) a la key, y se vuelve a comparar contra el tamaño real en la verificación. | Agregar una columna/migración para persistir el tamaño declarado. | Resuelve la verificación de tamaño sin tocar el esquema; Redis ya es global y falla abierto si no está disponible. |
| Helper único de URLs de lectura firmadas (`toSignedReadUrl` / `toCachedSignedReadUrl` / `invalidateCachedReadUrl`) con TTL por categoría (perfil 24h, espacio 24h, post público 1h, post de seguidores 15min, post privado 10min, moderación 10min), aplicado en **todos** los puntos de lectura identificados (perfiles, posts, espacios, chats, reportes/moderación administrativa, racha de amigos, notificaciones). | Firmar caso por caso con TTLs distintos sin un criterio común. | Un solo lugar para auditar TTLs y comportamiento; evita que un punto de lectura quede sin firmar por descuido. |
| Redis solo para perfil/post público/espacio, con el TTL de caché siempre menor al de la firma (margen automático, `cachedReadTtlSeconds`). | Cachear también privado/seguidores. | Evita servir desde caché una URL firmada ya vencida; privado/seguidores/moderación nunca se cachean porque son de bajo tráfico y no vale el round-trip, y porque cachear ahí aumentaría la superficie de una URL filtrada. |
| El firmado ocurre **estrictamente dentro** del bloque ya existente de autorización/visibilidad (nunca antes ni fuera de él). | Firmar primero y decidir visibilidad después. | Si se firmara antes de la verificación de acceso, una URL firmada podría generarse para contenido que el llamador no debería poder ver, incluso si después se descarta de la respuesta. |
| `extractUploadKey` devuelve `null` (y la URL pasa sin firmar) si no reconoce el prefijo propio del dueño, en vez de una key "parecida pero incorrecta". | Intentar extraer una key igual sin validar el prefijo. | Evita firmar — y por tanto exponer una key real — a partir de una URL que no es realmente del dueño asumido; también da compatibilidad automática con fotos antiguas/externas (§11). |
| `moderatePostViaAi`: si la firma de lectura falla, se trata como **fallo de moderación** (post queda `pending`, se reintenta en el siguiente batch), nunca como "se usa la URL pública cruda". | Usar `post.image_url` como respaldo si la firma falla. | Esa URL pública dejará de resolver en cuanto el bucket sea privado (CP4b); usarla de respaldo habría hecho que una foto se tratara como "moderada" sin que OpenAI pudiera verla realmente, o que la moderación quedara muerta en cuanto CP4b se active. |
| Dentro de ese mismo fallo de firma, **nunca** dejar que la válvula de aprobación automática por antigüedad lo apruebe, aunque pase el umbral de 2 horas (`ModerationSigningFailedError`, §14). | Dejar que la válvula de antigüedad existente lo cubriera igual que un fallo de OpenAI. | Un fallo de firma no es una señal de que "OpenAI está caído" — es un problema de nuestra propia infraestructura; aprobar en ese caso sería aprobar sin ninguna evaluación real de contenido. La válvula sigue intacta para un fallo real de OpenAI. |

## 3. Archivos modificados

**Backend** (46 archivos con cambios + 1 archivo nuevo de pruebas):

| Área | Archivos | Resumen |
|---|---|---|
| Núcleo de subida/lectura | `src/uploads/{uploads.service.ts, upload-url.util.ts, uploads.controller.ts, dto/sign-upload.dto.ts}` + sus specs | CP1 (firma de subida), CP2 (verificación post-subida), CP4a (helper de lectura firmada, TTLs, caché Redis) |
| Perfiles | `src/users/{users.service.ts, dto/profile-response.dto.ts}` + spec | Firma de `profile_image_url` en perfil propio, público, búsqueda y lista de banneados |
| Retos | `src/challenges/{challenges.service.ts, challenges.module.ts, dto/challenge-author.dto.ts, dto/challenge-join-request-response.dto.ts}` + spec | Firma de fotos de autor/solicitudes de ingreso |
| Espacios | `src/spaces/{spaces.service.ts, spaces.module.ts, dto/*.ts}` + spec | Firma de portada, creador, miembros, solicitudes, mensajes |
| Publicaciones | `src/workout-posts/{workout-posts.service.ts, workout-posts.module.ts, workout-post-reactions.service.ts, workout-post-comments.service.ts, workout-post-reports.service.ts}` + specs + **nuevo** `workout-posts-mosaic.integration.spec.ts` (ampliado) | Firma por fila según visibilidad (feed, mosaico, galería, reacciones, comentarios), invalidación de caché al borrar/ocultar, corrección de `moderatePostViaAi` (§2, §10), pruebas de abuso CP7 (§12) |
| Chats | `src/chats/{chats.service.ts, chats.module.ts, shared-content.service.ts}` + `chats.service.spec.ts` + **nuevo** `shared-content.service.spec.ts` | Firma de fotos compartidas en chats, estrictamente post-autorización |
| Seguidores / notificaciones | `src/follows/{follows.service.ts, follows.module.ts, dto/friend-streak.dto.ts}` + spec; `src/notifications/{notifications.service.ts, notifications.module.ts}` + spec | Firma de foto en racha de amigos y en notificaciones |
| `workout-log` | 4 archivos (solo specs + módulo) | Ajuste de mocks por la inyección de `UploadsService` en servicios relacionados; sin cambio de comportamiento |
| Evidencia | `docs/sprint-10/evidencias-b5/` (nuevo) | Salidas reales de migración, build y pruebas (§7) |

Sin archivos ajenos a B5 tocados. Hay un cambio local sin commitear de otro bloque (`docs/confiabilidad/B11-CONFIABILIDAD-BACKUPS-INTEGRACIONES.md`) que no se tocó.

## 4. Configuración e infraestructura pendiente

- **Sin migraciones nuevas, sin variables de entorno nuevas, sin dependencias nuevas.** CP1/CP2/CP4a/CP6/CP7 son cambio de código y pruebas puros.
- **Pendiente, fuera de este alcance:** volver privado el bucket R2 (CP4b) — requiere un cambio de configuración en Cloudflare, no autorizado aquí. Ver §9 y §10.
- **Pendiente:** CP0 (prueba independiente contra R2 real) — no autorizado aquí.

## 5. Comandos y resultados de pruebas

Todo corrido en `backend/`, 2026-10-24.

| Comando | Resultado |
|---|---|
| `npm run build` | OK |
| `npx jest --silent` | **66/69 suites, 1214 pass, 0 fallos, 14 omitidas** (3 suites omitidas ya existentes + 1 prueba nueva de integración que requiere `B2_TEST_DB_URL`) |
| `npx eslint <archivos tocados>` (sin `--fix`) | Único hallazgo nuevo: 2 errores de Prettier en archivos de prueba nuevos — corregidos con `npx prettier --write` sobre esos 2 archivos exactos. El resto son avisos/errores `@typescript-eslint/no-unsafe-*` **preexistentes**, confirmados línea por línea contra el diff como no introducidos por B5 (deuda ya presente en specs/servicios no relacionados con fotos) |
| `npx prettier --check <archivos tocados>` | Limpio tras la corrección anterior |
| **Integración real contra Postgres local descartable** (`B2_TEST_DB_URL=postgres://postgres:x@localhost:5433/havit_b5_test npx jest --ci integration`) | **3/3 suites, 14/14 pass** — incluye la prueba nueva de autorización de CP7 (§12) y la ya existente del mosaico (B2), ambas corriendo contra SQL real, no mocks |
| Migración limpia sobre una base nueva (`npm run db:migrate`) | **66 archivos aplicados**, sin errores (evidencia en `docs/sprint-10/evidencias-b5/migracion-local.txt`) |

Entorno de integración: Docker, `postgres:16-alpine`, contenedor descartable (`--rm`), puerto 5433, destruido al terminar. **Nunca Azure.**

## 6. Evidencias verificables

En `docs/sprint-10/evidencias-b5/`:

| Archivo | Contenido |
|---|---|
| `migracion-local.txt` | Salida completa de `npm run db:migrate` contra una base Postgres local recién creada: 66 archivos aplicados, 0 errores |
| `integracion-pg-local-cp7.txt` | Salida de `npx jest --ci integration` (los 3 suites de integración, incluida la nueva prueba de autorización de CP7) contra el mismo Postgres local |
| `build.txt` | Salida de `npm run build` |
| `unit-tests-backend.txt` | Salida completa de `npx jest --silent`, regenerada tras la corrección del hallazgo de CI (66/69 suites, 1214 pass) |
| `moderacion-correccion-cp7.txt` | Salida de `npx jest src/workout-posts/workout-posts.service.spec.ts --silent` (74/74), evidencia específica de la corrección de §14 |

Las pruebas unitarias mismas (`uploads.service.spec.ts`, `shared-content.service.spec.ts`, `workout-posts.service.spec.ts`, etc.) son la evidencia del comportamiento punto por punto; no hay capturas de pantalla (cambios de API y de lógica interna, no de UI en este repositorio).

**Hallazgo y corrección tras abrir el PR (2026-10-24):** el primer push disparó un fallo real en el workflow de CI (`tests.yml`) en la prueba e2e preexistente `imageUrl: solo https y, con R2 configurado, solo archivos del propio usuario` (`test/api-integration.e2e-spec.ts`). Causa: esa prueba solo configura `CLOUDFLARE_R2_PUBLIC_URL` (para probar la validación de forma de `assertOwnUploadUrl`, que no necesita nada más), y `extractUploadKey` (CP2/CP4a) trataba eso como "R2 configurado" y, por tanto, llegaba a intentar una llamada real a R2 sin bucket configurado. Corregido exigiendo también `CLOUDFLARE_R2_BUCKET_NAME` antes de construir una key verificable; reproducido localmente antes y después del fix (falla → pasa) contra un Postgres local descartable, con la suite completa (unitarias 1214/1214, integración 14/14, e2e 55/55, build limpio) re-verificada. Commit `61202a3`, pusheado al mismo PR.

## 7. Riesgos y dependencias

- **Huérfanos en R2 (heredado de CP2, documentado y no resuelto por instrucción explícita):** si el borrado de un objeto inválido falla tras el rechazo, el objeto queda huérfano en el bucket. La solución correcta (un job de limpieza por referencias) sigue fuera de alcance. Se descartó explícitamente una regla de lifecycle sobre todo el prefijo `uploads/` porque borraría fotos legítimas.
- **El bucket sigue público.** Todo lo de CP4a/CP6/CP7 está construido y probado para cuando se vuelva privado (CP4b), pero hoy el firmado es una capa adicional, no la única protección — ver §10.
- **Ventana de reintentos de moderación:** con la corrección de §2/§10, un fallo de firma deja el post `pending` (se reintenta en el siguiente batch) o, si ya lleva más de 2 horas así, lo aprueba automáticamente marcado para revisión humana (mecanismo preexistente, sin cambios en sus criterios). Si la firma fallara de forma sostenida (p. ej. Redis caído y R2 también fallando), posts legítimos podrían auto-aprobarse sin que OpenAI los haya visto nunca — mismo riesgo aceptado que ya existía para un fallo sostenido de OpenAI, ahora también cubre el fallo de firma.
- **Dependencia de CP4b:** CP7 prueba la autorización (SQL) y que no se firma nada fuera de ella, pero no puede probar "el bucket es privado" porque no lo es. No declarar cumplido ese criterio hasta CP4b.
- **Dependencia de CP0:** nada de esto se verificó contra un bucket R2 real (ni el `If-None-Match`, ni el comportamiento real de signed URLs vencidas). Ver §12 para qué se probó con mocks y qué no, y §13 para por qué CP0 sigue sin ejecutarse.
- **Corregido (ver §14): el mecanismo de aprobación automática por antigüedad (`STALE_PENDING_FALLBACK_MS`) ya no puede aprobar una foto cuya moderación nunca se evaluó por un fallo de firma de lectura.** Sigue aprobando automáticamente ante un fallo real y sostenido de OpenAI (comportamiento preexistente, deliberado, sin cambios) — ese riesgo residual (aceptado desde el incidente de 2026-09, documentado en el propio código) permanece, pero es el mismo que ya existía antes de B5 y no es exclusivo de las fotos.

## 8. Procedimiento de reversión

- Todo el trabajo está sin commitear en el árbol de trabajo de `feature/sprint10-b5-fotos-r2`. Para descartarlo: `git checkout -- <archivo>` por archivo, o `git stash`/`git clean` si se decide no conservar nada (revisar antes que no se borre el cambio ajeno de B11 mencionado en §3).
- Si ya se hubiera fusionado a `development`: `git revert` del/los commit(s) de esta rama. No hay migraciones que revertir (§4). El frontend tolera tanto URLs firmadas como públicas (compatibilidad, §11), así que revertir solo el backend o solo el frontend no rompe al otro.
- No hay cambios de infraestructura que revertir (CP4b no se ejecutó).

## 9. Límites y formatos permitidos

- Tipos de archivo aceptados en subida: `image/jpeg`, `image/png`, `image/webp` (`sign-upload.dto.ts`, `ALLOWED_UPLOAD_TYPES` en el frontend). Cualquier otro valor de `fileType` es rechazado por el `ValidationPipe` global antes de llegar a `UploadsService`.
- Tamaño máximo: `DEFAULT_UPLOAD_MAX_BYTES = 5 * 1024 * 1024` (5 MB), verificado dos veces: al firmar (`fileSize` declarado) y después de subir (tamaño real vía HeadObject). Configurable por `UPLOAD_MAX_BYTES` si existiera esa variable de entorno (no se cambió en B5).
- Validación de contenido real: primeros bytes (firma mágica) para JPEG/PNG/WebP — un archivo cuyo contenido no coincide con ninguno de los tres, o cuyo contenido no coincide con el tipo declarado, se rechaza y se borra (§2, `MAGIC_BYTE_CHECKS`).

## 10. Decisión sobre el bucket privado

**El bucket R2 sigue público.** CP4b (cambiar su configuración a privada en Cloudflare) **no se ejecutó** en esta etapa — no estaba autorizado y requiere tocar infraestructura real. Todo el trabajo de CP4a/CP6/CP7 se hizo **anticipando** ese cambio: cada punto de lectura ya pasa por una URL firmada con TTL, y la corrección de §2 elimina el único lugar (`moderatePostViaAi`) que dependía de poder leer la URL pública cruda sin firmar. **No se declara cumplido ningún criterio de "privacidad real" de las fotos** — hoy, cualquiera con la URL pública (firmada o no) puede seguir leyendo el objeto directamente en R2, porque el bucket lo permite. El firmado de lectura es una preparación correcta y probada, no una protección vigente.

## 11. Tratamiento de fotografías existentes

- Toda foto subida antes de B5 sigue teniendo su URL guardada tal cual en la base (columna `image_url`/`profile_image_url`/etc., sin migración). `toSignedReadUrl`/`toCachedSignedReadUrl` llaman a `extractUploadKey(url, ownerUserId)`: si la URL coincide con el prefijo de subidas propio de ese usuario en R2, se firma normalmente; si no coincide (por ejemplo, una URL de otro dominio o un formato antiguo que no sigue el prefijo esperado), la función devuelve `null` y la URL original se devuelve **sin modificar, sin firmar y sin error**.
- Esto se probó explícitamente (`upload-url.util.spec.ts`, `uploads.service.spec.ts`: "passes through a URL that is not one of this owner's R2 uploads, unchanged") — ninguna foto existente deja de mostrarse por este cambio, y ninguna key ajena se firma por error.
- Si una foto fue subida por un usuario pero su URL ya no coincide con el prefijo esperado (dato legado inconsistente), el resultado es el mismo: se devuelve sin firmar, igual que antes de B5. No se intentó "repararla" ni se requiere ninguna migración de datos.

## 12. Matriz de pruebas de abuso (CP7)

Todas en `backend/`, salvo las dos marcadas como frontend. **R2 real** significa que requeriría CP0 (no ejecutado); donde se indica "local/mock" la prueba corre sin red, y donde se indica "Postgres local real" corre contra SQL real (Docker, descartable, nunca Azure).

| # | Caso | Dónde | Tipo | Resultado |
|---|---|---|---|---|
| 1 | Archivo declarado y real mayor a 5 MB | `uploads.service.spec.ts` ("rejects a fileSize over the configured ceiling before touching R2", "rejects and deletes an object over the size ceiling") | Local/mock | ✅ Rechazado antes de tocar R2 (al firmar) y también si el tamaño real post-subida lo excede |
| 2 | HTML renombrado como `.jpg` | `uploads.service.spec.ts` ("rejects and deletes an HTML file renamed to .jpeg") | Local/mock | ✅ Rechazado y borrado por firma mágica inválida |
| 3 | Content-Type incorrecto (declarado no coincide con los bytes reales) | `uploads.service.spec.ts` ("rejects a declared type that does not match its real magic bytes even when valid for another format") | Local/mock | ✅ Rechazado |
| 4 | Magic bytes inválidos / archivo truncado | `uploads.service.spec.ts` ("rejects and deletes a truncated/garbage object") | Local/mock | ✅ Rechazado y borrado |
| 5 | JPEG, PNG y WebP válidos | `uploads.service.spec.ts` ("accepts a real JPEG/PNG/WebP") | Local/mock | ✅ Aceptados los tres formatos |
| 6 | Usuario B intentando acceder a la foto privada de A | `workout-posts-mosaic.integration.spec.ts` ("getUserPosts never returns, and never signs, a private or followers-only post for an unauthorized viewer") | **Postgres local real** | ✅ La fila ni siquiera vuelve en el `SELECT` (filtro SQL de visibilidad); el extraño recibe solo el post público |
| 7 | Usuario no-seguidor intentando acceder a una foto de "solo seguidores" | mismo test que el #6 | **Postgres local real** | ✅ Excluida para el extraño; un seguidor activo sí la recibe, pero sigue sin recibir la privada |
| 8 | No se generan URLs firmadas cuando falla la autorización | mismo test que el #6/#7 (asserts sobre `toSignedReadUrl`/`toCachedSignedReadUrl`) + `shared-content.service.spec.ts` (fotos compartidas en chats: "post excluded by SQL entirely → zero signing calls", "post present but visible:false → zero signing calls") | **Postgres local real** + local/mock | ✅ Cero llamadas de firma para las URLs excluidas, en ambos módulos |
| 9 | Compatibilidad con fotografías existentes | `upload-url.util.spec.ts`, `uploads.service.spec.ts` ("passes through a URL that is not one of this owner's R2 uploads, unchanged") | Local/mock | ✅ Ver §11 |
| 10 | Reutilización de URL de PUT (bloqueo por `If-None-Match: '*'`) | Firma: `uploads.service.spec.ts` ("also signs If-None-Match: * among the signed headers") — confirma que el header forma parte de la firma. Cliente: `upload.service.test.ts` (frontend, "sends If-None-Match on every PUT and fails safely... if R2 rejects a reused key with 412") — confirma que la app manda el header en cada PUT y falla de forma segura (sin reintento, sin tratarlo como éxito) si R2 lo llegara a rechazar | Local/mock (ambos) | ✅ Firmado confirmado localmente; **el rechazo real de R2 a una key reutilizada no se verificó (requiere CP0)** |

**Fuera de alcance de CP7 (requerían R2 real):** ver §13 — ahora autorizado, pero bloqueado por falta de credenciales.

## 13. CP0 — resultado real (2026-10-24)

**CP0 fue autorizado explícitamente** por el responsable, exclusivamente contra un bucket de pruebas aislado de Cloudflare R2, nunca producción. **No se pudo ejecutar.**

Motivo exacto: `UploadsService` lee sus credenciales de cinco variables de entorno (`CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET_NAME`, `CLOUDFLARE_R2_PUBLIC_URL`). Este checkout local **no tiene archivo `.env`** (solo existe `.env.example`, sin valores reales) — se verificó con `ls -la .env*` antes de intentar nada. No hay ninguna credencial de Cloudflare disponible en este entorno, ni de un bucket de pruebas ni de producción. Las credenciales reales solo existen donde el equipo las tiene configuradas para despliegue (fuera de este checkout), y esta sesión no tiene acceso al panel de Cloudflare para crear un token o un bucket nuevo.

**Lo que se necesita exactamente para ejecutar CP0 en una próxima sesión:**

1. Un bucket R2 nuevo, creado y nombrado explícitamente como de prueba (por ejemplo `havit-b5-cp0-test`), **distinto del bucket de producción**.
2. Un token de API de Cloudflare (Access Key ID + Secret Access Key) con permisos acotados a ese bucket de prueba — `Object Read & Write`, sin alcance sobre el bucket de producción ni sobre la cuenta completa si se puede acotar por bucket.
3. El `Account ID` de Cloudflare (no es secreto, pero se necesita para construir el endpoint `https://<account_id>.r2.cloudflarestorage.com`).
4. Si se quiere probar también la ruta de URL pública (HeadObject/GetObject vía URL pública, no solo firmada), la URL pública base de ese bucket de prueba.
5. Confirmación de que ese bucket se puede borrar por completo al terminar (el plan ya es destruirlo).

Con esas cinco variables exportadas temporalmente en el entorno de la sesión (nunca escritas a `.env` ni commiteadas), CP0 ejecutaría exactamente la matriz pedida: `If-None-Match` contra un objeto ya existente, Content-Type/Content-Length firmados vs. reales, una URL de lectura firmada antes y después de expirar, HeadObject/GetObject sobre un objeto inexistente vs. un error transitorio simulado, y subida/verificación real de JPEG/PNG/WebP válidos — reutilizando el mismo `UploadsService` ya probado con mocks (§5, §12), apuntado al bucket de prueba vía esas variables, y borrando cada objeto y el bucket mismo al terminar, con verificación final de que no queda nada.

**Nada se ejecutó contra R2.** No se intentó ninguna llamada de red a Cloudflare en esta etapa.

## 14. Revisión de moderación — aprobación automática de fotos no evaluadas (corregido)

**Pregunta original:** ¿puede el mecanismo de aprobación por antigüedad aprobar automáticamente una foto cuya moderación falló (nunca fue evaluada)?

**Confirmado que sí ocurría, y corregido el 2026-10-24.** `moderatePostViaAi` (`workout-posts.service.ts`) tenía un único `catch` que envolvía tanto la firma de la URL de lectura como la llamada real a OpenAI. Cualquier excepción ahí dentro — viniera de `uploadsService.toSignedReadUrl` o de `moderationService.validateWorkoutImage` (un 429, un timeout, cualquier error de OpenAI) — caía en el mismo bloque: si el post llevaba más de `STALE_PENDING_FALLBACK_MS` (2 horas) pendiente, se aprobaba automáticamente, marcado en `moderationReason` para revisión humana posterior.

Este mecanismo **no es nuevo de B5**: existe desde un incidente real documentado en el propio código (2026-09, cuota de OpenAI agotada, toda publicación ajena quedó invisible durante horas porque "pendiente" se trata igual que "no existe" para un espectador). Es una válvula de seguridad deliberada, no un descuido, y **se mantiene intacta para un fallo real de OpenAI** (sigue aprobando automáticamente un post viejo si quien falla es `moderationService.validateWorkoutImage` — la situación para la que se diseñó). Lo que se corrigió es que un **fallo de firma** ya no puede disparar esa misma válvula.

**Corrección aplicada** (`src/workout-posts/workout-posts.service.ts`):

- Clase de error dedicada a nivel de módulo, `ModerationSigningFailedError extends Error`, lanzada únicamente cuando `toSignedReadUrl` devuelve `null` (no se pudo generar la URL firmada) — antes se lanzaba un `Error` genérico indistinguible del de OpenAI.
- En el `catch` de `moderatePostViaAi`, antes de evaluar la antigüedad del post: `if (error instanceof ModerationSigningFailedError) { return; }`. El post queda `pending` (se reintenta en el siguiente batch, igual que antes) y **nunca** llega a la rama de aprobación automática, sin importar cuántas horas lleve pendiente.
- **Nada más cambió.** El criterio de aprobar/rechazar según lo que OpenAI responde (`result.flagged`) es exactamente el mismo; la válvula de antigüedad para un fallo real de OpenAI es exactamente la misma; el mecanismo de reintento (siguiente batch, sin cambios en su cadencia) es exactamente el mismo.

**Pruebas que lo demuestran** (`workout-posts.service.spec.ts`):

- `never auto-approves — even a very stale post — when signing (not OpenAI) is what fails`: post de **48 horas** de antigüedad (24× el umbral de 2h), falla la firma → `moderationService.validateWorkoutImage` nunca se llama, `postRepo.update` nunca se llama (sigue `pending`).
- `should NOT auto-approve a recently-uploaded post when signing fails on its first attempt`: igual pero con un post recién creado (ya existía, se mantiene).
- `processPendingModerationBatch never approves a stale post when signing fails, even past STALE_PENDING_FALLBACK_MS`: repite la prueba anterior pasando por el punto de entrada real del cron (`processPendingModerationBatch`), no solo llamando `moderatePostViaAi` directamente.
- Sin regresión: la prueba preexistente `should auto-approve a post that has been pending for over 2 hours when the moderation service keeps failing` (fallo real de OpenAI, no de firma) sigue en verde sin cambios — confirma que la válvula sigue funcionando para su caso original.

Las 74 pruebas de `workout-posts.service.spec.ts` pasan (antes: 73); suite completa del backend: 1213/1213 (antes de este cambio: 1212), 0 fallos. Evidencia completa en `docs/sprint-10/evidencias-b5/unit-tests-backend.txt` (regenerado).

## 15. Orden de integración, despliegue y CP4b — confirmación

El orden de 7 pasos propuesto es correcto. Dependencias externas y permisos necesarios en cada paso:

| Paso | Dependencia externa / permiso necesario |
|---|---|
| 1. Terminar pruebas y correcciones | Ninguna — ya completado para CP1/CP2/CP4a/CP6/CP7 en esta etapa, salvo CP0 (§13) |
| 2. Integrar a `development` | Revisión y merge por el procedimiento del equipo (CLAUDE.md: PR a `development`, nunca `main`); CI en verde. Ningún permiso de infraestructura nuevo |
| 3. Desplegar backend y frontend compatibles | Acceso de despliegue a Azure (contenedor del backend) y al pipeline de build de la app (EAS/Expo o equivalente para una APK nueva). **No depende de que ambos salgan a la vez**: CP4a es enteramente del backend (el frontend ya trata las URLs como opacas, confirmado en el documento hermano, §4); CP6 (tipo MIME real) es compatible con cualquier backend, viejo o nuevo |
| 4. Verificar que todos los flujos usan URLs firmadas | Acceso de monitoreo/logs de producción (Azure) — verificación manual post-despliegue, no automatizable desde este checkout |
| 5. Confirmar que la moderación sigue funcionando | Igual que el paso 4. **Recomendado resolver primero la decisión de §14** (aceptar el riesgo tal cual, o aplicar la corrección mínima propuesta) — no es bloqueante técnicamente, pero sí es la última oportunidad de decidirlo antes de que el bucket se vuelva privado y la moderación dependa aún más de que la firma nunca falle silenciosamente |
| 6. Retirar el acceso público (CP4b) | Acceso al panel de Cloudflare R2 con permiso para cambiar la configuración pública/privada del bucket de producción. **No autorizado en esta etapa** |
| 7. Pruebas finales de privacidad y regresión | Acceso de verificación en producción (confirmar que una URL pública cruda ya no responde, que cada flujo sigue resolviendo imágenes vía URL firmada) — requiere el paso 6 ya hecho |

No se identificó ningún paso faltante en el orden propuesto. Una adición posible, no bloqueante: repetir una versión acotada de CP0 (§13) contra el bucket de producción real *después* del paso 6, para confirmar que el comportamiento verificado en el bucket de pruebas (si CP0 llega a ejecutarse) se sostiene también ahí — decisión del equipo, no de esta etapa.
