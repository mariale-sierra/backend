# B7 — Backups y recuperación (Sprint 10)

Responsable: Martin Villatoro · Fecha: 2026-10-25 · Repo: `backend/` (scripts + docs).

> **Alcance corregido por indicación de la líder.** B7 **no** crea servidores ni ejecuta una restauración PITR real. Entrega (a) la verificación automatizada de la configuración real de backups del servidor existente y (b) el plan de recuperación documentado. El restore de Azure queda **solo como procedimiento**.

> **Regla de este documento: no hay evidencia inventada.** Lo que no se ejecutó dice que no se ejecutó. Lo que no se verificó aparece como pendiente, con el acceso exacto que falta. Ninguna cifra de este documento se dio por buena por venir de una corrida anterior.

## 1. Resumen y criterio de aceptación

B7 deja un verificador reproducible de los backups automáticos de Azure (`scripts/verify-azure-backups.js`) con criterios PASS/FAIL explícitos y códigos de salida aptos para automatización, más el plan de recuperación escrito para que lo ejecute alguien que no participó. **La verificación ya se ejecutó contra el servidor real** el 2026-10-25 a las 15:29:06 UTC: resultado **PASS** (4 PASS, 1 WARN, 0 FAIL, exit 0) sobre `pg-havit-dev-01` en el resource group `rg-havit-dev`, con retención de 7 días, 7 backups diarios y la ventana PITR abierta. La redundancia del backup resultó **`Disabled`**, que es el WARN y el riesgo principal que queda abierto (§7).

Lo que B7 **no** entrega: ninguna restauración real de Azure, y por lo tanto **ningún RTO medido**. Eso quedó fuera del alcance autorizado y figura como tal en §6.2 y §10.

Criterio original del bloque: *"respaldos automáticos verificados y restauración exitosa sin afectar la base de producción."*

| Parte del criterio | Estado | Evidencia |
|---|---|---|
| Respaldos automáticos **verificados** | **CUMPLIDO** — verificación automatizada y ejecutada contra el servidor real, con resultado PASS | `evidencias-b7/verificacion-2026-10-25T15-29-06-765Z.txt` y `.json`; tabla en §6.1 |
| Restauración **exitosa** desde Azure | **NO CUMPLIDO — fuera de alcance por decisión** | No se ejecutó ningún restore. El procedimiento queda en §9 |
| Restauración verificable (evidencia de recuperabilidad) | **PARCIAL** — solo el drill local del Sprint 9, con datos sintéticos | `docs/confiabilidad/B11-CONFIABILIDAD-BACKUPS-INTEGRACIONES.md` §3: 60/60 tablas idénticas, `pg_amcheck` limpio |
| **Sin afectar la base de producción** | **CUMPLIDO** | Las únicas operaciones contra `pg-havit-dev-01` fueron tres lecturas del plano de control de Azure (`account show`, `flexible-server show`, `backup list`). No se tocó la base de datos ni se modificó ningún recurso |
| Procedimiento comprensible para alguien que no participó | **CUMPLIDO** | §9, con comandos, roles, autorizaciones, validaciones y reversión |
| RTO medido | **NO CUMPLIDO** | No se midió. No hubo restore que cronometrar (§6.2, §10) |
| RPO ≤ 15 min demostrado | **NO DEMOSTRADO** | La verificación confirma que el mecanismo PITR está disponible, pero **no mide** el RPO. Ver §10 |

**En una línea:** la herramienta y el procedimiento están listos; la evidencia real de Azure queda a una corrida de distancia (`az login` + §5.2).

## 2. Decisiones tomadas y alternativas descartadas

| Decisión | Alternativas descartadas | Por qué |
|---|---|---|
| **Usar el backup nativo de Azure**, sin agregar respaldos propios | `pg_dump` programado (cron en la VM o job de GitHub) hacia almacenamiento propio | Azure ya hace snapshot diario + WAL continuo, con PITR. Un `pg_dump` paralelo contra la base compartida agrega carga, un destino que habría que asegurar y respaldar, y una segunda cosa que se puede romper en silencio. Lo que faltaba no era otro backup: era **verificar** el que ya existe. El doc B11 ya había descartado este mismo plan |
| **Script propio en Node sobre Azure CLI** | `--query` de JMESPath a mano; portal; SDK de Azure para Node | El `--query` a mano no da PASS/FAIL ni código de salida, y nadie lo repite igual dos veces. El portal no es automatizable ni deja evidencia reproducible. El SDK obligaría a una dependencia nueva y a credenciales propias; `az` ya resuelve la autenticación |
| **Sin dependencias nuevas** (`child_process` + `JSON.parse`) | `@azure/arm-postgresql-flexible`, `yargs`, `zod` | La salida de `az` ya es JSON y el parseo de argumentos son 30 líneas. El repo no necesita otra dependencia para esto |
| **Script bajo demanda, sin workflow de GitHub Actions** | Job programado en Actions con OIDC; cron en la VM del runner | Un job en Actions exige registrar una app en Azure AD, una credencial federada y tres secrets, más un *role assignment* de Reader. Eso es infraestructura y secretos nuevos, fuera de lo autorizado aquí. §4.3 deja documentado exactamente qué habría que configurar para activarlo después, sin dejar un workflow muerto en el repo |
| **C5 (redundancia) es WARN, nunca FAIL** | Que `geoRedundantBackup = Disabled` falle la verificación | La geo-redundancia **solo se puede elegir al crear el servidor**. Un FAIL ahí sería permanente y nadie podría arreglarlo sin recrear el servidor: convertiría la verificación en ruido que se aprende a ignorar. Se reporta como riesgo (§7) |
| **Umbral de retención configurable, por defecto 7** | Fijar 30 días; no verificar la retención | 7 es a la vez el mínimo que permite Azure y lo que el equipo tiene hoy. Es un umbral declarado del equipo, no un SLA inventado. Cuando la retención es exactamente el mínimo, el script lo dice ("no hay margen") sin fallar |
| **No reutilizar los valores verificados el 2026-10-12** | Copiar al doc B7 la tabla ya verificada en el portal | Con 7 días de retención, el *earliest restore point* de hace 13 días ya no existe. Copiarlo sería presentar como actual un dato caducado |
| **Un solo documento** (este), que referencia a B11 sin editarlo | Un runbook aparte en `docs/confiabilidad/` | El doc B11 tiene cambios locales sin commitear que pertenecen a otra tarea y debían preservarse. Un segundo runbook duplicaría su §4 y los dos se desincronizarían |

## 3. Archivos creados o modificados

| Archivo | Cambio |
|---|---|
| `scripts/verify-azure-backups.js` | **Nuevo.** Verificador de backups automáticos: 5 checks PASS/FAIL/WARN, salida legible y JSON, evidencia a disco, modos `--dry-run` y `--fixture`, códigos de salida 0/1/2. Solo lectura |
| `package.json` | **Una línea:** script `backups:verify`. Sin dependencias nuevas |
| `docs/sprint-10/B7-backups-recuperacion.md` | **Nuevo.** Este documento |
| `docs/sprint-10/evidencias-b7/verificacion-2026-10-25T15-29-06-765Z.txt` | **Nuevo.** Informe legible de la corrida real contra Azure: PASS, 4 PASS + 1 WARN, exit 0 |
| `docs/sprint-10/evidencias-b7/verificacion-2026-10-25T15-29-06-765Z.json` | **Nuevo.** La misma corrida en JSON, con la respuesta completa de `az` y `administratorLogin` redactado |
| `docs/sprint-10/evidencias-b7/pruebas-locales.txt` | **Nuevo.** Transcripción de las 9 pruebas locales con sus códigos de salida |
| `docs/sprint-10/evidencias-b7/fixture-fail-ejemplo.json` | **Nuevo.** Captura de ejemplo con un servidor mal configurado, para reproducir el camino FAIL sin Azure. Datos inventados a propósito y marcados como tales |

**No modificado a propósito:** `docs/confiabilidad/B11-CONFIABILIDAD-BACKUPS-INTEGRACIONES.md`, que tiene cambios locales sin commitear de otra tarea. B7 lo referencia y corrige por su cuenta el comando equivocado que contiene (§4.1), sin tocarlo.

## 4. Configuración, variables e infraestructura

- **Sin cambios de base de datos.** B7 no agrega migraciones ni seeds: no toca el esquema.
- **Sin variables de entorno nuevas.** El script no lee `.env` ni necesita `DB_*`: habla con Azure por `az`, no con PostgreSQL.
- **Sin secretos.** No se creó, leyó ni modificó ningún secreto. La evidencia que escribe el script **redacta** `administratorLogin` y `administratorLoginPassword` antes de guardar el JSON, porque esos archivos se commitean.

### 4.1 Comandos de Azure que usa (todos de solo lectura)

```bash
az account show -o json
az postgres flexible-server show --resource-group <rg> --name <servidor> -o json
az postgres flexible-server backup list --resource-group <rg> --server-name <servidor> -o json
```

> **Corrección respecto al doc B11.** El doc B11 documenta `backup list ... -n pg-havit-dev-01`. Eso es incorrecto: en `backup list` el parámetro del servidor es `--server-name/-s`; `-n/--name` es el *nombre de un backup* y solo existe en `backup show` y `backup delete`. La forma correcta es la de arriba, que es la que usa el script.

El script **no ejecuta** `restore`, `create`, `delete` ni `update`. No hay ninguna ruta de código que lo haga.

### 4.2 Roles y permisos

| Operación | Rol mínimo | Quién |
|---|---|---|
| Verificación de backups (todo lo de B7) | **Reader** sobre el resource group del servidor | Quien corra `npm run backups:verify` |
| Restore PITR a un servidor nuevo (§9, no ejecutado) | **Contributor** | Pendiente de designar (§7) |
| Eliminar el servidor temporal tras un simulacro | **Contributor** | Pendiente de designar |

### 4.3 Qué habría que configurar a mano para programarlo (no hecho)

Hoy el script se corre a demanda. Para que corra solo en GitHub Actions haría falta, por parte de alguien con permisos en Azure AD y en el repo:

1. **App registration** en Azure AD con una **credencial federada** (OIDC) apuntando al repo `mariale-sierra/backend`.
2. **Role assignment de Reader** para esa identidad, sobre el resource group del servidor.
3. Tres **variables o secrets** en el repo: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (ninguno es una contraseña; con OIDC no hace falta un *client secret*).
4. Un workflow con `permissions: id-token: write`, `azure/login@v2` y el paso `npm run backups:verify -- --server <s> --resource-group <rg> --out …`, con `schedule:` diario.

Comprobado el 2026-10-25: el repo **no tiene secrets ni variables configurados** (`gh secret list` y `gh variable list` vacíos), así que hoy ese workflow no podría autenticarse. Por eso no se agregó.

La alternativa sin OIDC es un cron en la VM del runner self-hosted de B6 usando una **managed identity** con rol Reader; también es infraestructura nueva y tampoco se hizo.

## 5. Cómo se probó

### 5.1 Lo que sí se ejecutó (local, sin Azure)

Entorno: macOS (Darwin 25.6.0), Node v24.22.0, Azure CLI 2.91.0 instalada pero, **en ese momento, sin sesión iniciada**.

| # | Prueba | Comando | Esperado | Resultado |
|---|---|---|---|---|
| P1 | Ayuda | `node scripts/verify-azure-backups.js --help` | exit 0 | ✅ exit 0 |
| P2 | Camino PASS completo | `--dry-run` | exit 0, 4 PASS + 1 WARN | ✅ exit 0 |
| P3 | Camino FAIL completo | `--fixture docs/sprint-10/evidencias-b7/fixture-fail-ejemplo.json` | exit 1, 4 FAIL | ✅ exit 1 |
| P4 | Falta `--server` | (sin argumentos) | exit 2 | ✅ exit 2 |
| P5 | **Contra Azure sin sesión** | `--server pg-havit-dev-01 --resource-group EJEMPLO-NO-REAL` | exit 2 con mensaje accionable | ✅ exit 2, *"No hay sesión de Azure iniciada. Ejecutá `az login`"* |
| P6 | Opción desconocida | `--borrar-todo` | exit 2 | ✅ exit 2 |
| P7 | `--dry-run` + `--fixture` | ambos juntos | exit 2 | ✅ exit 2 |
| P8 | Fixture inexistente | `--fixture no-existe.json` | exit 2 | ✅ exit 2 |
| P9 | Umbral configurable | `--dry-run --min-retention-days 14` | C2 pasa a FAIL, exit 1 | ✅ exit 1 |

P5 es la única prueba que invocó el binario `az`. La llamada fue `az account show`, que **falló en el paso de autenticación y nunca llegó a ningún recurso de Azure**: no se consultó, modificó ni creó nada. Sirvió para validar el manejo de errores contra la CLI real y no contra un mock.

Además: `node --check` sobre el script pasa sin errores. `npm run lint` **no cubre este archivo** — su glob es `{src,apps,libs,test}/**/*.ts`, así que `scripts/*.js` queda fuera, igual que `scripts/b11-integration-sample.js` y `scripts/test-summary.js`. No se agregó lint nuevo para no cambiar la configuración del repo dentro de B7.

### 5.2 La corrida real contra Azure — EJECUTADA el 2026-10-25

```bash
az login
cd backend
npm run backups:verify -- \
  --server pg-havit-dev-01 \
  --resource-group rg-havit-dev \
  --out docs/sprint-10/evidencias-b7
```

**Resultado: PASS, exit 0** (4 PASS, 1 WARN, 0 FAIL), a las 15:29:06 UTC. Produjo los dos archivos de evidencia de §6 y llenó la tabla de §6.1.

Los tres comandos que ejecutó el script, todos de lectura, quedaron registrados en el propio informe:

```
az account show -o json
az postgres flexible-server show --resource-group rg-havit-dev --name pg-havit-dev-01 -o json
az postgres flexible-server backup list --resource-group rg-havit-dev --server-name pg-havit-dev-01 -o json
```

**Para repetirla** basta el mismo comando: el script no guarda estado y cada corrida escribe su propio par de archivos con la marca de tiempo.

## 6. Evidencia

Todo en `docs/sprint-10/evidencias-b7/`:

- **`verificacion-2026-10-25T15-29-06-765Z.txt`** — el informe legible de la corrida real: comandos ejecutados, configuración observada, los 5 checks con su esperado/observado y el veredicto PASS. **Esta es la evidencia principal de B7.**
- **`verificacion-2026-10-25T15-29-06-765Z.json`** — la misma corrida en formato máquina, con la respuesta completa de `az` (servidor y los 7 backups), los umbrales aplicados y `exitCode: 0`. El campo `administratorLogin` viene como `[redactado]`: el script lo censura antes de escribir, porque esta evidencia se commitea.
- `pruebas-locales.txt` — transcripción completa de P1–P9 con sus códigos de salida y la aclaración de que ninguna de esas pruebas consultó datos de Azure. Todas las rutas son relativas a `backend/`, así que se repiten tal cual con un `cd backend`.
- `fixture-fail-ejemplo.json` — la captura de ejemplo que usa P3 para ejercitar el camino FAIL, sin Azure y sin archivos temporales.

Los archivos producidos por `--dry-run` o `--fixture` se nombran `FIXTURE-NO-ES-EVIDENCIA-<timestamp>` y llevan el aviso en el encabezado, en el cuerpo y en el campo `source` del JSON. Los de una corrida real se llaman `verificacion-<timestamp>`, como los dos de arriba. Los nombres no se solapan nunca.

> **Censura aplicada a mano sobre la evidencia.** El identificador y el nombre de la suscripción de Azure se reemplazaron por `[redactado]` en los dos archivos, incluidos los que aparecían embebidos en los *resource id* de ARM (que quedan como `/subscriptions/[redactado]/resourceGroups/rg-havit-dev/...`). No son credenciales, pero son identificadores de la infraestructura y el historial de git es permanente. **Todo lo técnicamente relevante se conservó**: resource group, servidor, región, SKU, configuración de backups, los 7 backups con sus fechas, los checks y el veredicto. El `administratorLogin` ya venía redactado por el propio script.
>
> **Pendiente derivado:** el script todavía **no** censura la suscripción por su cuenta, así que una corrida futura la volverá a escribir. Hay que agregar esos campos a `REDACTED_FIELDS` en `scripts/verify-azure-backups.js`; no se hizo aquí para no mezclar un cambio de código en un commit de evidencia (§7).

> Detalle menor de `pruebas-locales.txt`: en su encabezado el campo de versión de Azure CLI quedó **vacío** por un problema de comillas al generarlo. La versión correcta es **2.91.0**. El archivo se dejó tal cual en lugar de editarlo a mano, para no tocar una transcripción que por lo demás es auténtica; regenerarlo hoy tampoco serviría, porque la prueba P5 depende de que **no** haya sesión de Azure iniciada y ahora sí la hay.

### 6.1 Tabla de configuración real de backups — VERIFICADA

Verificado el **2026-10-25 a las 15:29:06 UTC** por Martin Villatoro, con `npm run backups:verify` (§5.2). Todos los valores salen de la salida de `az`, no de una captura de pantalla ni de una corrida anterior.

| Dato | Valor observado | Fuente |
|---|---|---|
| Nombre exacto del servidor | `pg-havit-dev-01` | `show` → `name` |
| Resource group | `rg-havit-dev` | `show` → `resourceGroup` |
| FQDN | `pg-havit-dev-01.postgres.database.azure.com` | `show` → `fullyQualifiedDomainName` |
| Región | **Mexico Central** | `show` → `location` |
| Estado | **Ready** | `show` → `state` |
| SKU / nivel | `Standard_B1ms` / **Burstable** | `show` → `sku.name` / `sku.tier` |
| Versión de PostgreSQL | 16 | `show` → `version` |
| Alta disponibilidad | Disabled | `show` → `highAvailability.mode` |
| Backups automáticos | **Activos** | retención configurada en 7 días + 7 backups listados |
| Retención | **7 días** (el mínimo de Azure; admite hasta 35) | `show` → `backup.backupRetentionDays` |
| Redundancia del backup | **`Disabled`** — sin geo-redundancia | `show` → `backup.geoRedundantBackup` |
| Earliest restore point | **2026-10-19T00:10:47.883591+00:00** | `show` → `backup.earliestRestoreDate` |
| Backups disponibles | **7**, diarios, uno por día del 2026-10-19 al 2026-10-25, todos `Full` / `Automatic` | `backup list` → `completedTime` |
| Backup más reciente | 2026-10-25T00:11:26.088981+00:00 — **hace 15,3 h** al momento de la corrida | `backup list` |
| Almacenamiento (GB) | *no expuesto por esta versión de az* | `show` → `storage.storageSizeGB` |
| **Resultado** | **PASS** — 4 PASS, 1 WARN, 0 FAIL, `exit 0` | salida del script |

El único WARN es la redundancia (C5): está en `Disabled`, y como la geo-redundancia **solo se puede elegir al crear el servidor**, no es algo que se pueda corregir sobre este servidor. Se reporta como riesgo en §7, no como falla.

**Qué demuestra esta corrida:** que el servidor real tiene backups automáticos diarios funcionando, con 7 días de retención y una ventana PITR abierta y continua desde el 2026-10-19.

**Qué NO demuestra:** que un restore funcione, ni cuánto tarda, ni cuántos datos se perderían. Para eso hace falta ejecutar un PITR, que quedó fuera de alcance (§9, §10).

**Sobre el dato del 2026-10-12.** El doc B11 §2 registra una verificación hecha en el portal ese día (retención 7 días, *earliest restore point* `2026-10-07`). Sigue siendo válida como lo que se vio entonces, pero **no se reutilizó aquí**: con 7 días de retención, aquellos backups ya rotaron. Los valores de esta tabla son todos de la corrida del 2026-10-25. Lo que ambas verificaciones coinciden en mostrar es que la retención lleva al menos dos semanas en 7 días y que el ritmo diario de backups se sostiene.

**Nivel Burstable: no se pueden forzar backups.** Azure no admite backups a petición en este nivel. El comando `az postgres flexible-server backup create` existe y es GA, pero sobre este servidor fallaría. Antes de un eventual simulacro hay que trabajar con el snapshot diario automático de las ~00:10 UTC. El script no usa ese comando.

### 6.2 Tabla de tiempos medidos

| Medición | Valor | Nota |
|---|---|---|
| Hora solicitada del restore | — | No se ejecutó ningún restore |
| Hora efectiva del restore | — | idem |
| Duración del restore (RTO de Azure) | — | idem |
| Tiempo de validación del servidor restaurado | — | idem |
| Tiempo hasta que la API responde | — | idem |

**No hay tiempos medidos de Azure.** La verificación del 2026-10-25 confirma que los backups existen, pero **no cronometra nada**: no hubo restore. Los únicos tiempos reales que existen son los del drill local del Sprint 9 (`pg_dump -Fc` 0,14 s y `pg_restore` 0,54 s sobre 13 MB de datos sintéticos), que miden un restore lógico local y **no** el PITR de Azure.

> **Cuidado con leer el "hace 15,3 h" como pérdida de datos.** Esas 15,3 horas son la antigüedad del último **snapshot diario**, no el punto de recuperación. Azure complementa el snapshot con archivado continuo de WAL, así que un PITR puede restaurar a un momento mucho más cercano al presente que el último snapshot. Confundir las dos cosas daría un RPO aparente de 15 horas, que no es lo que ofrece el servicio. Lo que esta evidencia **no** incluye es una medición del retraso real de archivado de WAL en este servidor (§10).

## 7. Pendientes, riesgos y dependencias

### Pendientes

| # | Pendiente | Bloqueado por |
|---|---|---|
| 1 | **Restore real (PITR) y medición del RTO** | Fuera del alcance autorizado: exige crear un servidor nuevo. Procedimiento listo en §9 |
| 2 | Decidir si la retención sube de 7 días (Azure admite hasta 35) | decisión del equipo + coordinación con B11. Hoy está en el mínimo, sin margen |
| 3 | Decidir qué hacer con la **falta de geo-redundancia** (`Disabled`) | decisión del equipo. No se puede cambiar sobre este servidor: exigiría crear uno nuevo y migrar |
| 4 | Confirmar **cuál es el entorno de producción** | Ale Pérez / Ale Sierra. El servidor se llama `pg-havit-dev-01` y el PDF del sprint ya marcaba esta duda |
| 5 | Designar quién tiene **Contributor** para un restore real | Ale Pérez / Ale Sierra |
| 6 | Activar la verificación programada (§4.3) | requiere OIDC y secrets, no autorizado aquí |
| 7 | Repetir la verificación periódicamente | hoy es manual. Mientras no exista (6), conviene correrla antes de cada entrega |
| 8 | **Censurar la suscripción desde el script**: agregar su id y nombre a `REDACTED_FIELDS` en `scripts/verify-azure-backups.js` | nada. Es un cambio de una línea, separado del commit de evidencia a propósito. Hoy la censura de §6 se hizo a mano |

Los pendientes 1 a 3 de la versión anterior de este documento (correr la verificación, registrar el resource group, registrar la redundancia) **quedaron resueltos** con la corrida del 2026-10-25.

### Riesgos y límites

- **Objetos de Cloudflare R2 (fotos): NO están en el backup de PostgreSQL.** Es el límite más importante de todo este bloque. Un restore de la base devuelve las filas de `workout_posts`, `user_profiles` y `spaces` con su `image_url`, pero **no devuelve ni un solo archivo de imagen**. Si se pierden los objetos de R2, no hay nada aquí que los recupere.
- **Qué pasa con las URLs de fotos tras restaurar la base.** La base guarda la URL pública en `image_url`; tras B5 la lectura de fotos no públicas pasa por `toSignedReadUrl`, que firma al leer a partir de esa URL. Entonces: si se restaura la base a un punto anterior, las filas vuelven a su `image_url` de ese momento y **las fotos siguen resolviendo mientras el objeto exista en R2**, porque R2 no se revierte. Los dos desfases posibles son (a) fotos subidas después del punto de restauración: el objeto existe en R2 pero ya no hay fila que lo referencie, y queda huérfano y sin dueño para `deleteUserObjects`; (b) fotos borradas después del punto de restauración: la fila vuelve, pero el objeto ya no está y la lectura falla. Ninguno de los dos casos está cubierto hoy.
- **Sin geo-redundancia — confirmado, no supuesto.** La verificación del 2026-10-25 observó `geoRedundantBackup: Disabled`. Los backups viven **solo en Mexico Central**, la misma región del servidor. Una caída de toda la región deja la base sin backup accesible, y para ese escenario **no hay RPO ni RTO de ningún tipo**. Y no es corregible sobre este servidor: la geo-redundancia solo se puede elegir al crearlo, así que activarla exigiría crear un servidor nuevo y migrar.
- **Retención en el mínimo — confirmado.** Los 7 días observados son el piso que permite Azure. Una pérdida detectada al día 8 **no es recuperable**: ningún mecanismo la alcanza. La ventana real verificada arranca el 2026-10-19. Azure permite subir hasta 35 días; es una decisión de costo del equipo.
- **Borrar el servidor borra sus backups.** Microsoft lo documenta sin matices: eliminar el servidor elimina también todos sus backups, sin recuperación posible.
- **Costo de un servidor restaurado.** Un PITR crea un servidor nuevo que **se factura desde que existe**. Si alguna vez se hace un simulacro, hay que borrarlo al terminar y dejar constancia del borrado.
- **La base es compartida.** `pg-havit-dev-01` sirve al contenedor desplegado y al compose local. Nada destructivo sobre ella sin autorización explícita. El script de B7 es de solo lectura y ni siquiera se conecta a PostgreSQL.
- **Diferencia entre el drill local y un restore real de Azure.** El drill del Sprint 9 prueba que el esquema de Havit se respalda y restaura sin pérdida, con datos sintéticos y `pg_dump`/`pg_restore`. **No** prueba que los backups de Azure existan, que el PITR funcione para este servidor, ni cuánto tarda. Son evidencias de cosas distintas y este documento no las mezcla.
- **El verificador depende del formato de salida de `az`.** Los nombres de campo se tomaron de la documentación de Azure (`backup.backupRetentionDays`, `backup.geoRedundantBackup`, `backup.earliestRestoreDate`, y `completedTime`/`backupType`/`source` en `backup list`), pero no se confirmaron contra una respuesta real. Si una versión de `az` no devuelve alguno, el script lo reporta como *"no expuesto por esta versión de az"* en vez de inventar un valor, y los checks que dependan de él fallan de forma visible.

### Dependencias con otros bloques

- **B5** (fotos y R2, ya fusionado — backend `f84dba5`, frontend `44e65bf`): **no se reabrió ni se modificó**. La única relación real es la dependencia documentada arriba: los objetos de R2 quedan fuera del backup de Postgres. Los pendientes CP0 y CP4b de B5 siguen como estaban.
- **B6** (despliegue y CI/CD, ya fusionado — backend `909ef395`, raiz `73df9ef`): **no se rehízo nada**. Se reutilizó su diagnóstico de la infraestructura de CI (`.github/workflows/ci.yml`, runner self-hosted) para decidir dónde correría la verificación programada (§4.3). B7 no modifica el workflow.
- **B11**: su doc `docs/confiabilidad/B11-CONFIABILIDAD-BACKUPS-INTEGRACIONES.md` es el insumo de B7 y **tiene cambios locales sin commitear que B7 preservó intactos**. Además, `frontend/constants/legal/legalDocs.ts:90` dice *"Las copias de seguridad pueden conservar datos hasta [N] días antes de sobrescribirse"*: ese `[N]` se llena con la retención que confirme §6.1 (hoy, 7). El cambio es de B11, no de B7.
- **B12**: necesita de aquí las cifras de RPO/RTO para la matriz de requisitos no funcionales. Lo que B7 puede entregarle hoy es §10, con el RTO **sin medir** y declarado como tal.

## 8. Cómo revertir

- **Todo B7:** borrar `scripts/verify-azure-backups.js`, `docs/sprint-10/B7-backups-recuperacion.md` y `docs/sprint-10/evidencias-b7/`, y quitar la línea `backups:verify` de `package.json`. No hay nada más que deshacer.
- **No hay nada que revertir en Azure**: no se creó, modificó ni eliminó ningún recurso.
- **No hay nada que revertir en la base de datos**: sin migraciones, sin seeds, sin cambios de esquema.
- **No hay nada que revertir en el pipeline**: no se tocó `.github/workflows/ci.yml`.
- **Si la verificación real diera FAIL:** eso no es algo que revertir, es un hallazgo. Se documenta en §6.1 con la salida del script y se escala al equipo con la causa concreta.
- **Si el script falla por un cambio de formato de `az`:** correr con `--json`, guardar la salida y reevaluarla con `--fixture` una vez corregido el campo, sin volver a consultar Azure.

---

## 9. Plan de recuperación (procedimiento documentado — NO ejecutado)

> **Nada de esta sección se ejecutó.** Es el procedimiento a seguir ante un incidente real, o ante un simulacro si en el futuro se autoriza crear el servidor temporal.

**Lo primero que hay que entender:** en Azure, un Point-in-Time Restore **siempre crea un servidor nuevo**. Nunca sobrescribe el original y no existe la opción de "restaurar encima". Eso es una garantía de seguridad — `pg-havit-dev-01` no corre riesgo durante un restore — pero también significa que todo restore implica un servidor adicional, con su costo, hasta que se elimine. Por esa razón el equipo decidió no ejecutar un simulacro.

### 9.1 Antes de tocar nada: autorizaciones

Ninguno de los pasos siguientes arranca sin esto confirmado y escrito:

| Qué confirmar | Con quién |
|---|---|
| Cuál es el entorno de producción (el servidor se llama `pg-havit-dev-01`) | Ale Pérez / Ale Sierra |
| Resource group, servidor origen y región | quien tenga acceso a Azure |
| Nombre del servidor destino y que **no** sea un nombre existente | responsable del restore |
| Punto temporal exacto (UTC) y que caiga dentro de la retención | responsable del restore + quien reportó el incidente |
| Que el servidor restaurado quede **aislado** y que la API **no** se apunte a él sin coordinar | Ale Pérez |
| Quién tiene rol **Contributor** y ejecuta | Ale Pérez / Ale Sierra |
| Procedimiento y responsable de la **eliminación** del servidor temporal | responsable del restore |
| Plan de reversión (§9.5) | responsable del restore |

### 9.2 A quién notificar

1. **Antes de empezar:** avisar al equipo que se va a crear un servidor temporal y por qué (costo visible en la suscripción, y evita que alguien crea que es un recurso abandonado).
2. **Si se va a cambiar `DB_HOST`** (solo en incidente real): avisar antes, porque implica reiniciar el backend y hay corte de servicio.
3. **Al terminar:** confirmar por escrito que el servidor temporal se eliminó, con la hora.

### 9.3 Procedimiento

| Paso | Comando / acción |
|---|---|
| 1. Verificar la ventana | `npm run backups:verify -- --server pg-havit-dev-01 --resource-group <rg>`. El *earliest restore point* acota hacia atrás hasta dónde se puede ir |
| 2. Elegir el punto | Hora **UTC** inmediatamente anterior al incidente, dentro de la retención |
| 3. Restaurar a un servidor **nuevo** | `az postgres flexible-server restore --resource-group <rg> --name pg-havit-restore-<yyyymmdd> --source-server pg-havit-dev-01 --restore-time "<YYYY-MM-DDTHH:MM:SSZ>"` — requiere **Contributor** |
| 4. Anotar los tiempos | Hora en que se lanzó el comando, hora en que el servidor quedó `Ready`, y la diferencia. Eso es el RTO real de Azure, el número que hoy falta |
| 5. Configurar acceso | Regla de firewall para la IP desde la que se va a validar. **No** abrir el servidor restaurado a todo internet |
| 6. Validar (solo lectura) | §9.4 |
| 7a. Si era un **simulacro** | Registrar la evidencia y **eliminar el servidor**: `az postgres flexible-server delete --resource-group <rg> --name pg-havit-restore-<yyyymmdd> --yes`. Dejar constancia escrita del borrado y de la hora |
| 7b. Si era un **incidente real** | Cambiar `DB_HOST` del backend al servidor restaurado y reiniciar el contenedor. `npm run db:migrate` corre solo al arrancar y aplica únicamente lo pendiente, porque el tracking (`havit.schema_migrations`) viaja dentro de la base restaurada |

### 9.4 Validaciones posteriores (sobre el servidor restaurado, solo lectura)

Conectarse con `psql` **al servidor nuevo** y repetir las validaciones que el drill local del Sprint 9 ya dejó ensayadas (doc B11 §3):

| Validación | Qué comprobar |
|---|---|
| Conexión y lectura | Conecta con TLS verificado (la CA de Azure está en `certs/azure-postgres-root-cas.pem`) |
| Conteo de tablas | El esquema `havit` tiene el número de tablas esperado |
| Conteo por tabla | `count(*)` en las tablas principales: `users`, `challenges`, `workout_logs`, `workout_posts`, `direct_messages` |
| Huella por tabla | `md5(string_agg(fila::text ORDER BY fila::text))` por tabla, comparable contra el origen |
| `schema_migrations` | Número de archivos aplicados coherente con el commit desplegado (hoy el repo tiene 66: 1 init + 58 migraciones + 7 seeds) |
| PK / FK / constraints | Que no haya constraints sin validar |
| Lecturas representativas de Havit | Un usuario conocido, un challenge activo con sus participantes, y una lectura tipo feed con joins entre posts, workout_logs, challenges y users |
| Continuidad de secuencias | Un `INSERT` de prueba dentro de una transacción con `ROLLBACK`, para confirmar que no colisionan los ids |

Si alguna falla, **no** apuntar la API al servidor restaurado.

### 9.5 Reversión

- **Durante un simulacro:** no hay nada que revertir en producción, porque nunca se tocó. La reversión es simplemente eliminar el servidor temporal (paso 7a). Si se olvida, el único daño es el costo acumulado.
- **Tras apuntar la API al servidor restaurado (incidente real):** la reversión es volver `DB_HOST` al valor anterior y reiniciar el contenedor. **Ojo:** los datos escritos contra el servidor restaurado desde el cambio **no existen** en el original. Volver atrás los pierde. Antes de revertir hay que decidir explícitamente qué pasa con esos datos.
- **Si el restore falla a medias:** Azure puede dejar un servidor en estado fallido. Eliminarlo con `flexible-server delete` y reintentar. El servidor origen sigue intacto en cualquier caso: PITR nunca lo modifica.

## 10. RPO / RTO — resultado honesto

> Siguen siendo **objetivos propuestos**, no un SLA confirmado. La verificación del 2026-10-25 confirma que el **mecanismo** de recuperación existe y está sano, pero **no mide ni el RPO ni el RTO**. Para eso hace falta un restore, que quedó fuera de alcance.

| | OBSERVADO POR B7 (2026-10-25) | DOCUMENTACIÓN OFICIAL DE AZURE | OBJETIVO PROPUESTO | ¿Demostrado? |
|---|---|---|---|---|
| **RPO** | Backups automáticos activos, retención 7 días, ventana PITR abierta desde el 2026-10-19, 7 backups diarios consecutivos, el último hace 15,3 h. **Ninguna medición del retraso de archivado de WAL.** | Hasta 5 min de retraso con PITR en la misma región; hasta 1 h con geo-restore, que aquí **no aplica** porque la geo-redundancia está en `Disabled` | **≤ 15 min** | **NO DEMOSTRADO** |
| **RTO** | **No medido. No se ejecutó ningún restore de Azure.** El único tiempo real disponible es el del drill local del Sprint 9 (0,54 s de `pg_restore` sobre 13 MB sintéticos), que **no mide el PITR de Azure** | "The overall recovery time usually takes from few minutes up to a few hours", según el replay de WAL | **≤ 4 h** | **NO MEDIDO** |

**Qué se puede afirmar con esta evidencia:** que existe un mecanismo de backup automático administrado por Azure, verificado y sano, con capacidad de PITR y una ventana de recuperación abierta y continua de 7 días. Eso es una condición **necesaria** para cumplir el RPO de 15 minutos.

**Qué no se puede afirmar:**

- **El RPO de ≤ 15 min no está demostrado.** La verificación comprueba que el mecanismo que lo haría posible está activo, pero no mide cuántos datos se perderían realmente. El número de 5 minutos es lo que Microsoft documenta para el servicio en general; nadie lo ha observado en `pg-havit-dev-01`. Medirlo exigiría un restore a un punto conocido y comparar qué transacciones sobrevivieron.
- **El RTO de ≤ 4 h no está medido, ni estimado con datos propios.** Para medirlo hace falta exactamente un PITR cronometrado (§9.3, paso 4).
- **Para una caída regional no hay ningún objetivo aplicable.** Sin geo-redundancia no hay copia fuera de Mexico Central, así que ni el RPO ni el RTO propuestos significan nada en ese escenario.

**Para B12:** en la matriz de requisitos no funcionales, el RPO debe figurar como *no demostrado* y el RTO como *no medido*, con esta evidencia como respaldo de que el mecanismo existe — no de que los objetivos se cumplan. Presentarlos como cumplidos sería falso.
