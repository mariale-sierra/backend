# B3 — HTTPS y seguridad del transporte (Sprint 10)

Responsable: Ale Pérez · Fecha: 2026-10-23 · Hallazgos de auditoría: **H1** (API en HTTP) y **M9** (TLS a Postgres sin verificar), ver `docs/security/AUDITORIA-OWASP-Y-CARGA-2026-10-13.md`.

Este documento es la referencia principal de B3 y cubre los tres repositorios. Hay documentos hermanos más cortos en `frontend/docs/sprint-10/B3-https-transporte.md` y `raiz/docs/sprint-10/B3-https-transporte.md`.

## 1. Resumen

El API queda listo para publicarse por HTTPS: Caddy hace de proxy inverso en `raiz/docker-compose.yml`, obtiene y renueva el certificado solo, y redirige HTTP → HTTPS (308). Nest confía únicamente en el salto del proxy (`TRUST_PROXY`), así que el limitador de peticiones sigue separando a los clientes por IP. Las conexiones a Azure PostgreSQL (app, runner de migraciones y PgBouncer) ahora verifican la cadena **y** el nombre del servidor por defecto. Las builds `preview`/`production` del APK exigen una URL `https://` y salen con `usesCleartextTraffic=false`.

**Criterio de aceptación: PARCIAL.** Todo lo que depende del código está hecho y verificado localmente con evidencia (sección 6). Faltan acciones con acceso a Azure/EAS que no tenía desde esta sesión: crear la etiqueta DNS, abrir 80/443 en el NSG, desplegar, compilar el APK HTTPS y, después de la transición, cerrar el 3000 (sección 4.5).

| Criterio | Estado | Evidencia |
|---|---|---|
| Comunicación app ↔ API de producción por HTTPS | ⏳ Pendiente (infra + APK) | Código listo; la build falla si la URL no es `https://` (`frontend/docs/sprint-10/evidencias-b3/expo-config.txt`) |
| Certificado TLS del API válido y verificable | ⏳ Pendiente (DNS + NSG) | Caddy validado con CA interna en local (`https-caddy-local.txt`) |
| HTTP redirige a HTTPS | ✅ en local / ⏳ en la VM | `308 Permanent Redirect` (`https-caddy-local.txt`) |
| Puerto 3000 no expuesto públicamente | ⏳ Pendiente (tras migrar los APK) | `BACKEND_BIND_ADDR=127.0.0.1` probado en local (`puerto-3000.txt`); hoy 3000 sigue abierto en `20.63.84.1` |
| Nest identifica la IP real del cliente detrás del proxy | ✅ | `trust-proxy.spec.ts` + 3 clientes reales a través de Caddy (`throttler-ip.txt`) |
| Build de producción sin HTTP inseguro | ✅ (configuración) / ⏳ (APK compilado) | `AndroidManifest.xml` generado con `usesCleartextTraffic="false"` (`android-manifest.txt`) |
| Azure PostgreSQL valida el certificado | ✅ en código / ⏳ contra Azure real | Pruebas con Postgres TLS local: CA ajena y nombre incorrecto fallan (`runner-tls.txt`). Desde aquí no hay acceso de red a Azure (firewall) |
| PgBouncer y runner con TLS seguro | ✅ en local | `pgbouncer-verify-full.txt`, `runner-tls.txt` (65 migraciones sobre TLS verificado) |
| Flujos críticos funcionan | ✅ login/registro/retos sobre HTTPS en local; ⏳ en dispositivo | `flujo-https-pgbouncer.txt` |
| Pruebas relevantes pasan | ✅ | Sección 5 |

## 2. Decisiones técnicas

| Decisión | Alternativas descartadas | Por qué |
|---|---|---|
| **Caddy 2.10.2** (`caddy:2.10.2-alpine`) como proxy | Nginx + certbot; Cloudflare delante de la IP; Azure Front Door / Application Gateway | Certificado y renovación automáticos y redirección HTTP→HTTPS sin configuración extra; un contenedor más en el mismo compose. Nginx exige un cron de certbot. Cloudflare requiere un dominio propio que no existe. Front Door/App Gateway suman costo y permisos de Azure que no hay. |
| **Dominio: etiqueta DNS de Azure** `<etiqueta>.<región>.cloudapp.azure.com` | Comprar un dominio | Es gratis, lo administra Azure y Let's Encrypt lo acepta. Cuando haya dominio propio, solo cambia `API_DOMAIN`. |
| **No comprimir en Caddy** (sin `encode gzip`) | `encode zstd gzip` | Las respuestas llevan JWT junto a texto que manda el usuario (superficie BREACH), y el API nunca comprimió: activarlo sería un cambio de comportamiento ajeno a B3. |
| **`TRUST_PROXY=loopback,uniquelocal`** (lista de direcciones) | `trust proxy = true`; `trust proxy = 1` | `true` toma la IP más a la izquierda de `X-Forwarded-For`, que controla el cliente, y el código ahora lo **rechaza**. `1` confiaría en cualquier cliente que llegue directo al 3000 durante la transición. Con la lista, solo se cree a saltos con IP privada (Caddy en la red Docker). Un cliente que entra directo al 3000 llega con su IP pública y su cabecera se ignora. Además, Caddy **reemplaza** el `X-Forwarded-For` del cliente (no tiene `trusted_proxies`). |
| **3000 publicado en `0.0.0.0` por defecto durante la transición**, configurable con `BACKEND_BIND_ADDR` | Cerrar ya (`127.0.0.1`) | Los APK instalados hoy usan `http://20.63.84.1:3000`; cerrarlo antes de distribuir el APK HTTPS los deja sin servicio. Con `127.0.0.1` el health check del deploy (`curl http://localhost:3000/`) sigue funcionando sin tocar el workflow (B6). |
| **Verificar TLS de Postgres por defecto** (`DB_SSL_REJECT_UNAUTHORIZED` ahora solo se usa para desactivarla con `false`) | Mantener la opción de activarla con `true` | Seguro por omisión (la auditoría lo marca como "valor invertido"). Desactivarla queda como palanca de rollback explícita, que avisa en el log en cada arranque. |
| **Bundle con solo CA raíz** (`certs/azure-postgres-root-cas.pem`: DigiCert Global Root G2, Microsoft RSA Root CA 2017 y DigiCert Global Root CA) | Fijar intermedias o el certificado del servidor; usar solo el almacén de Node | Microsoft rota intermedias y certificados de servidor **sin aviso**, y fijarlos es una configuración "no soportada". Con solo raíces se sigue la recomendación oficial. Las huellas SHA-256 se compararon con el almacén de raíces de macOS. Con un bundle explícito se confía en 3 raíces en lugar de ~150. |
| **Pasar `host` explícito en las opciones TLS** | Confiar en que `pg` lo haga | Encontrado al probar: con `DB_HOST` como **IP**, `pg` no le pasa ni `servername` ni `host` a `tls.connect` y Node compara el certificado contra `"localhost"`, así que la verificación del nombre no se hace (caso 4 de `runner-tls.txt`, que primero conectaba y ahora se rechaza). Azure usa nombre DNS, pero el fallo era silencioso. |
| **Lógica TLS duplicada** en `src/config/db-ssl.ts` y `database/scripts/lib.js`, con una prueba de paridad | Un solo módulo | El runner es JS plano que corre **antes** de compilar (hook `prestart`/`predev`) y no puede importar TS. `db-ssl.spec.ts` compara las dos implementaciones caso por caso. |
| **App → PgBouncer sin TLS** (sin cambios) | TLS de cliente en PgBouncer | Ese salto va por la red privada de Docker en la misma VM. El que cruza internet (PgBouncer → Azure) pasa de `require` a `verify-full`. `DB_POOL_SSL=true` sigue disponible si algún día el pooler tiene certificado propio. |
| **Variante de build en `app.config.js`** (`APP_VARIANT` en `eas.json`, con `EAS_BUILD_PROFILE` como respaldo) | Dejar `usesCleartextTraffic` fijo en `app.json` | `development` puede usar HTTP (backend en la LAN); `preview`/`production` no. Resolver la configuración **falla** si la URL no es https, para no publicar por error un APK que mande contraseñas en claro. |

## 3. Archivos modificados

**backend** (rama `feature/sprint10-b3-https`)

| Archivo | Cambio |
|---|---|
| `src/config/db-ssl.ts` (nuevo) | `resolveDbSsl` / `resolveAppDbSsl`: verificación por defecto, `DB_SSL_CA_PATH` (falla al arrancar si no se puede leer), `host` explícito, escape `DB_SSL_REJECT_UNAUTHORIZED=false` con aviso. |
| `src/config/trust-proxy.ts` (nuevo) | `resolveTrustProxy` a partir de `TRUST_PROXY`: `false`, número de saltos o lista de direcciones; rechaza `true`. |
| `src/app.module.ts` | `ssl: resolveAppDbSsl(process.env)` en lugar del objeto con `rejectUnauthorized` desactivado por defecto. |
| `src/main.ts` | `app.set('trust proxy', …)`; el servidor de Swagger pasa a ser relativo (`/`) en vez de `http://20.63.84.1:3000`. |
| `database/scripts/lib.js` | Elimina `rejectUnauthorized: false`; mismo `resolveDbSsl` que la app. |
| `certs/azure-postgres-root-cas.pem` (nuevo) | Raíces públicas de Azure PostgreSQL (sin secretos), con fuente y huellas. |
| `src/config/db-ssl.spec.ts`, `src/config/trust-proxy.spec.ts` (nuevos) | Pruebas automatizadas (sección 5). |
| `.env.example` | `DB_SSL_CA_PATH`, `DB_SSL_REJECT_UNAUTHORIZED`, `TRUST_PROXY`, `PUBLIC_API_URL`. |
| `docs/security/AUDITORIA-OWASP-Y-CARGA-2026-10-13.md` | Estado de H1 (parcial) y M9 (corregido en código). |
| `docs/sprint-10/B3-https-transporte.md`, `docs/sprint-10/evidencias-b3/*` | Este documento y la evidencia. |

**raiz** (rama `feature/sprint10-b3-https`)

| Archivo | Cambio |
|---|---|
| `caddy/Caddyfile` (nuevo) | Sitio `{$API_DOMAIN:localhost}` → `reverse_proxy backend:3000`, sin compresión, sin `trusted_proxies`. |
| `docker-compose.yml` | Servicio `caddy` (80, 443 y 443/udp, volúmenes `caddy_data`/`caddy_config`); `backend`: puerto `${BACKEND_BIND_ADDR:-0.0.0.0}:3000`, `TRUST_PROXY`, `DB_SSL_CA_PATH`; `pgbouncer`: `SERVER_TLS_SSLMODE=verify-full` + `SERVER_TLS_CA_FILE` montado desde `../backend/certs`. |
| `.env.example` | `API_DOMAIN`, `BACKEND_BIND_ADDR`, `CADDY_HTTP(S)_PORT`, `TRUST_PROXY`, notas de TLS de Postgres. |
| `docs/sprint-10/B3-https-transporte.md` | Resumen de infraestructura. |

**frontend** (rama `feature/sprint10-b3-https`)

| Archivo | Cambio |
|---|---|
| `app.config.js` | Variante de build; `usesCleartextTraffic` = solo en `development`; error si una build `preview`/`production` no tiene URL `https://`. |
| `app.json` | Se quitan el plugin `expo-build-properties` con `usesCleartextTraffic: true` fijo (ahora se declara en `app.config.js`) y la `extra.apiUrl` HTTP (`app.config.js` ya la sobrescribía). |
| `eas.json` | `env.APP_VARIANT` por perfil. |
| `services/api.ts` | La URL de respaldo HTTP solo aplica en `__DEV__`. |
| `__tests__/appConfig.test.ts` (nuevo) | 8 pruebas de la configuración por variante. |
| `docs/ARCHITECTURE-GUIDE.md`, `docs/sprint-10/B3-https-transporte.md`, `docs/sprint-10/evidencias-b3/*` | Documentación y evidencia. |

## 4. Configuración e infraestructura

### 4.1 Variables de entorno

| Variable | Dónde | Valor en la VM | Notas |
|---|---|---|---|
| `API_DOMAIN` | `raiz/.env` | `havit-api.<región>.cloudapp.azure.com` | Sin definir = `localhost` con certificado interno de Caddy. |
| `BACKEND_BIND_ADDR` | `raiz/.env` | sin definir (= `0.0.0.0`) durante la transición → `127.0.0.1` al final | Ver 4.5. |
| `TRUST_PROXY` | compose (por defecto `loopback,uniquelocal`) | no tocar | Nunca `true`. |
| `DB_SSL_CA_PATH` | compose (por defecto `/app/certs/azure-postgres-root-cas.pem`) | no tocar | El archivo viene en la imagen (`COPY . .`). |
| `DB_SSL_REJECT_UNAUTHORIZED` | `raiz/.env` | **sin definir** | `false` solo como rollback de emergencia. |
| `PGBOUNCER_SERVER_TLS_SSLMODE` | `raiz/.env` | sin definir (= `verify-full`) | `disable` solo contra un Postgres local sin TLS. |
| `PUBLIC_API_URL` | `raiz/.env` | `https://<API_DOMAIN>` (opcional) | Solo afecta a Swagger. |
| `EXPO_PUBLIC_API_URL` | `eas.json` o variables de entorno de EAS (`preview`, `production`) | `https://<API_DOMAIN>` | Obligatoria; sin ella las builds de release fallan a propósito. |

### 4.2 Certificados

- **API:** Caddy los guarda en el volumen `caddy_data`. **No borrarlo** (`docker-compose down` sin `-v` lo conserva; el deploy actual lo respeta). Perderlo obliga a reemitir en cada deploy y Let's Encrypt tiene límites semanales. Caddy renueva solo, con bastante anticipación al vencimiento.
- **Fecha de vencimiento del certificado del API:** aún no existe (dominio no aprovisionado). Para consultarla después: `echo | openssl s_client -connect <API_DOMAIN>:443 -servername <API_DOMAIN> 2>/dev/null | openssl x509 -noout -enddate`.
- **Postgres:** `backend/certs/azure-postgres-root-cas.pem`, solo raíces públicas. Vencen en 2038 (G2), 2042 (Microsoft RSA 2017) y 2031 (DigiCert Global Root CA). Si Microsoft anuncia una raíz nueva, se agrega aquí (nunca intermedias).

### 4.3 Azure / DNS

- **Dominio utilizado:** ninguno todavía. Propuesto: etiqueta DNS en la IP pública de la VM → `havit-api.<región>.cloudapp.azure.com`. Desde esta sesión no había `az` CLI ni credenciales, y no pude determinar la región de la VM.
- **NSG:** permitir entrada **TCP 80** (desafío ACME HTTP-01 y redirección) y **TCP 443** (HTTPS) desde Internet. UDP 443 (HTTP/3) es opcional. El puerto 22 no se toca.
- Estado verificado el 2026-10-23 desde Internet: `20.63.84.1:3000` abierto y responde 200 por HTTP; 80 y 443 filtrados; 6432 y 6379 filtrados (correcto).

### 4.4 Orden de despliegue (importante)

1. **backend** primero (merge a `main` → deploy). Con el `raiz` anterior no se define `DB_SSL_CA_PATH` y la app verifica contra las raíces de Node 20, que incluyen las de Azure (comprobado en `node:20` v20.20.2).
2. **raiz** después. Monta `../backend/certs/...` en PgBouncer y apunta `DB_SSL_CA_PATH` al archivo de la imagen. **Si raiz se despliega antes que backend, el archivo no existe:** el backend no arranca (falla de forma deliberada) y Docker crea un directorio vacío en lugar del CA de PgBouncer.
3. Etiqueta DNS + NSG 80/443 → Caddy obtiene el certificado solo (revisar `docker logs havit-caddy`).

### 4.5 Acciones manuales pendientes (exactas)

**Azure (alguien con acceso al portal):**
1. Portal → Máquina virtual → IP pública `20.63.84.1` → *Configuración* → **Etiqueta de nombre DNS** = `havit-api` → Guardar. Anotar el FQDN resultante (`havit-api.<región>.cloudapp.azure.com`). Con CLI: `az network public-ip update -g <rg> -n <ip-name> --dns-name havit-api`.
2. NSG de la VM → *Reglas de seguridad de entrada* → agregar `Allow TCP 80` y `Allow TCP 443` desde `Internet` (prioridad menor que cualquier Deny).
3. Comprobar: `dig +short havit-api.<región>.cloudapp.azure.com` → `20.63.84.1`.

**VM / Docker (después del merge a `main` en el orden de 4.4):**
4. En `/home/azureuser/raiz/.env`: `API_DOMAIN=havit-api.<región>.cloudapp.azure.com` (y, opcional, `PUBLIC_API_URL=https://…`). Redeploy (`docker-compose down --remove-orphans && docker-compose up -d --build`, sin `-v`).
5. Verificar: `docker logs havit-caddy | grep -i "certificate obtained"`, luego las pruebas de la sección 5.3 contra el dominio real, y `testssl.sh https://<API_DOMAIN>`.
6. Verificar la conexión TLS real con Azure: `docker logs havit-backend | grep "\[db\]"` (las migraciones deben aplicarse o decir "up to date", sin errores de certificado) y `docker logs havit-pgbouncer | grep "SSL established"`.

**EAS (B8):**
7. En `frontend/eas.json` (perfiles `preview` y `production`, bloque `env`) o en expo.dev → *Environment variables*: `EXPO_PUBLIC_API_URL=https://havit-api.<región>.cloudapp.azure.com`. Compilar `eas build -p android --profile preview` y probar en dispositivo login, retos, workout/progreso y subida de foto.
8. Cambiar `frontend/.env` a la URL https (para `expo start` contra el servidor) una vez que el dominio responda.

**Cierre (después de distribuir el APK HTTPS, ver sección 7):**
9. `BACKEND_BIND_ADDR=127.0.0.1` en `raiz/.env` + redeploy, y **eliminar la regla del NSG que abre el 3000**.

### 4.6 Checklist de cierre de puertos

- [ ] DNS resuelve a `20.63.84.1`
- [ ] NSG permite 80 y 443
- [ ] `curl -sI http://<API_DOMAIN>/` → `308` hacia `https://`
- [ ] `curl -sv https://<API_DOMAIN>/` → certificado verificado, 200
- [ ] APK HTTPS distribuido y probado (B8)
- [ ] Ventana de aviso cumplida para APK viejos (sección 7)
- [ ] `BACKEND_BIND_ADDR=127.0.0.1` y redeploy
- [ ] Regla del 3000 eliminada del NSG
- [ ] Desde fuera: `nc -z -G 5 20.63.84.1 3000` falla; en la VM `curl -sf http://localhost:3000/` sigue respondiendo (health check del deploy)
- [ ] 6432 (PgBouncer) y 6379 (Redis) siguen sin publicarse

## 5. Pruebas

### 5.1 Automatizadas nuevas

| Archivo | Qué prueba |
|---|---|
| `backend/src/config/db-ssl.spec.ts` (11) | Verificación por defecto; `DB_SSL=false`; escape con aviso; carga del bundle de Azure (3 certificados); fallo si falta el CA; **paridad app ↔ runner**; PgBouncer sin TLS en la red Docker; **handshakes TLS reales** con una CA desechable: acepta cadena y nombre correctos, rechaza CA ajena, rechaza nombre incorrecto, rechaza un host IP que antes pasaba como "localhost". |
| `backend/src/config/trust-proxy.spec.ts` (6) | Parseo de `TRUST_PROXY` y rechazo de `true`; **ThrottlerGuard real**: cada IP tiene su cupo, no se evade anteponiendo `X-Forwarded-For` falsos, y sin proxy configurado la cabecera se ignora. |
| `frontend/__tests__/appConfig.test.ts` (8) | `development` permite HTTP; `preview`/`production` bloquean cleartext y rechazan `http://`; respaldo con `EAS_BUILD_PROFILE`; el plugin se declara una sola vez. |

### 5.2 Suites existentes (ejecutadas el 2026-10-23)

| Comando | Resultado |
|---|---|
| `backend: env -u B2_TEST_DB_URL npx jest` | 62 suites ok (2 omitidas, requieren BD), **1049 pass**, 4 skipped |
| `backend: npx jest --ci integration` (Postgres 16 desechable, igual que CI) | 2/2 suites, 4/4 |
| `backend: npm run test:e2e -- --ci` | 1/1 suite, **28/28** |
| `backend: npm run build` | 0 errores |
| `backend: npx eslint src/config/*.ts src/main.ts src/app.module.ts` | Sin errores en los archivos de B3. Preexistentes: 1 error en `env.validation.ts` y 1 aviso (`bootstrap()` sin `void`) en `main.ts`, ambos ya en `origin/development`. |
| `frontend: npx jest` | **174/174 suites, 2078/2078**. En una primera corrida `CommentsSheet.test.tsx` falló por timeout bajo carga; pasa aislado con y sin los cambios de B3 y en la segunda corrida completa. |
| `frontend: npm run typecheck` | 0 errores |
| `frontend: npm run i18n:check` | OK |

### 5.3 Verificación manual con stack local (topología real con CA de prueba)

Stack: `docs/sprint-10/evidencias-b3/stack-verificacion-local.compose.yml`. Postgres 16 con TLS obligatorio (`hostnossl … reject`) y certificado para `pg.havit.test`, PgBouncer con `verify-full`, imagen del backend construida desde esta rama con `npm run dev` (igual que en producción) y el `Caddyfile` real de `raiz`.

| Prueba | Comando (resumen) | Resultado |
|---|---|---|
| HTTP → HTTPS | `curl -sD - http://localhost:58080/` | `308 Permanent Redirect`, `Location: https://localhost/` |
| Certificado y nombre | `curl -v --cacert <caddy-root> https://localhost:58443/` | `SSL certificate verify ok`, TLSv1.3, HSTS `max-age=31536000; includeSubDomains`, 200 |
| `openssl s_client -verify_hostname localhost` | — | `Verify return code: 0 (ok)` |
| `openssl s_client -verify_hostname api.otro-dominio.com` | — | `62 (hostname mismatch)` |
| Cliente sin la CA | `curl https://localhost:58443/` | `(60) unable to get local issuer certificate` |
| `testssl.sh` 3.2 (contenedor `drwetter/testssl.sh:3.2`) | `-p -P -h -U -S` | Solo TLS 1.2 y 1.3; SSLv2/3 y TLS 1.0/1.1 no ofrecidos; sin vulnerabilidades (Heartbleed, ROBOT, POODLE, SWEET32, LOGJAM, BEAST…); BREACH sin compresión; HSTS 365 días. `Chain of trust NOT ok` es esperado con la CA interna local y debe salir OK con Let's Encrypt en la VM. |
| Throttler por IP (límite 3/min) | 3 contenedores simultáneos con IP distinta → HTTPS → Caddy | A: 200,200,200,**429**; B: 200,200,200,429 (cupo propio); C rotando `X-Forwarded-For` falso: 200,200,200,**429** (no evade) |
| Flujo real | `POST /auth/register`, `POST /auth/login`, `GET /users/me`, `GET /challenges` por HTTPS | 200 en todos |
| Runner: CA correcta | `npm run db:migrate` | 65 archivos aplicados sobre TLSv1.3 verificado; re-ejecución no-op |
| Runner: CA ajena (bundle de Azure / rogue) | — | `UNABLE_TO_VERIFY_LEAF_SIGNATURE` |
| Runner: nombre que no cubre el certificado | `DB_HOST=127.0.0.1` | `ERR_TLS_CERT_ALTNAME_INVALID` |
| Runner: `DB_SSL_CA_PATH` inexistente | — | Falla al arrancar con un mensaje claro |
| PgBouncer `verify-full`: correcto | `psql -h pgbouncer` | `SSL established: TLSv1.3`; Postgres ve la conexión del pooler con `ssl=t` |
| PgBouncer: CA ajena / bundle de Azure | — | `certificate verify failed` |
| PgBouncer: host fuera del SAN | `PGB_TARGET_HOST=pg` | `name 'pg' not present in server certificate` |
| Puerto con `127.0.0.1` | `curl` a loopback y a la IP LAN | loopback 200; IP LAN sin conexión; HTTPS por la IP LAN 200 |
| `http://` en el frontend | `grep -rn "http://"` | Solo respaldos de desarrollo (`app.config.js`, `services/api.ts` con `__DEV__`), `scripts/dev-local.js` (LAN), README y pruebas. Ninguna configuración de producción. |

**No ejecutado (sin acceso):** pruebas contra `20.63.84.1`/el dominio real con HTTPS, conexión TLS verificada contra Azure PostgreSQL real (el firewall de Azure bloquea esta IP: `connect timeout` en 5432), compilación del APK en EAS y prueba en dispositivo de subida de fotos y workouts.

## 6. Evidencia

Backend, `docs/sprint-10/evidencias-b3/`:
- `https-caddy-local.txt`: redirección, `curl -v`, `openssl s_client`.
- `testssl-caddy-local.txt`: salida completa de testssl.sh.
- `throttler-ip.txt`: limitador por IP detrás de Caddy.
- `flujo-https-pgbouncer.txt`: registro, login y lecturas autenticadas; `pg_stat_ssl`; configuración efectiva de PgBouncer.
- `pgbouncer-verify-full.txt`: casos positivos y negativos de PgBouncer.
- `runner-tls.txt`: casos del runner de migraciones.
- `puerto-3000.txt`: bind a loopback.
- `stack-verificacion-local.compose.yml`: stack para reproducir (credenciales desechables `*-test-only`, no reales).

Frontend, `docs/sprint-10/evidencias-b3/`:
- `expo-config.txt`: `npx expo config` por variante.
- `android-manifest.txt`: `AndroidManifest.xml` generado con `expo prebuild` por variante.

## 7. Pendientes y riesgos

- **APK viejos (plan de transición, con B8):** (1) desplegar HTTPS **sin** cerrar el 3000; (2) B8 compila y distribuye el APK con `https://`; (3) avisar al equipo y a los testers para que instalen el nuevo APK, con una ventana acordada (sugerido: 1 semana o el fin del sprint); (4) revisar en los logs de Caddy/Nest que ya no llega tráfico relevante al 3000; (5) cerrar el 3000 (4.5, paso 9). A partir de ahí los APK HTTP dejan de conectar y muestran el error de red. No se implementa una redirección 3000 → HTTPS para ellos: el cliente HTTP de Android (OkHttp) no sigue de forma fiable un 307/308 en peticiones POST (login, registro de progreso), así que solo arreglaría las lecturas, y mantenerla obligaría a dejar el 3000 abierto.
- **Builds de preview/production bloqueadas hasta definir la URL https.** Es intencional, y por eso la rama de frontend no se integra a `development` hasta tener el dominio (ver el PR). Los perfiles `development` siguen funcionando.
- **B6 (Dockerfile / compose / CI):** agregué un servicio (`caddy`) y variables a `raiz/docker-compose.yml`, pero no toqué Dockerfile ni workflows. **Hallazgo para B6 (preexistente, no corregido):** `database/importers/repdb/import-repdb.ts` amplía el `rootDir` de TypeScript y `nest build` emite `dist/src/main.js`, mientras que `npm start` (CMD del Dockerfile) ejecuta `node dist/main.js` → `Cannot find module '/app/dist/main.js'`. En la VM no se nota porque compose usa `npm run dev`. También pasa en `main`.
- **B4 (auth):** en el checkout local de `backend/` hay trabajo sin commitear de login social (`src/auth/social`, etc.) que no toqué; trabajé en un worktree aparte. Si el login social usa URLs de redirección (OAuth), deben registrarse con `https://<API_DOMAIN>`.
- **B11/B12:** volver a correr `docs/security/scripts/security-probe.mjs` contra el dominio HTTPS (el hallazgo A02-08 debería desaparecer) y `testssl.sh` contra el dominio real.
- **Riesgo de orden de despliegue:** ver 4.4.
- **Let's Encrypt:** si el NSG no abre 80/443 cuando `API_DOMAIN` está definido, Caddy reintenta con espera creciente (sin afectar al API por el 3000). No borrar `caddy_data`.
- **iOS:** no hay build iOS activa; Expo ya deja ATS (`NSAllowsArbitraryLoads=false`) en release, así que con `https://` no hay que cambiar nada.

## 8. Rollback

Cada paso se revierte por separado y no requiere migraciones de base de datos (B3 no crea ninguna).

1. **Postgres sin verificación (emergencia, p. ej. Azure cambia de raíz):** `DB_SSL_REJECT_UNAUTHORIZED=false` y `PGBOUNCER_SERVER_TLS_SSLMODE=require` en `raiz/.env` → redeploy. El cifrado sigue activo; solo se deja de verificar. Arreglo definitivo: agregar la raíz nueva a `certs/azure-postgres-root-cas.pem`.
2. **Proxy:** detener Caddy (`docker-compose stop caddy`) o volver a la versión anterior de `raiz` (`git revert <commit de B3>` en `raiz` → deploy). Mientras el 3000 siga publicado, la API sigue respondiendo por HTTP como antes.
3. **Puerto 3000 cerrado demasiado pronto:** quitar `BACKEND_BIND_ADDR` de `raiz/.env` (vuelve a `0.0.0.0`) + redeploy, y restaurar la regla del NSG.
4. **`trust proxy`:** `TRUST_PROXY=false` en `raiz/.env` (vuelve al comportamiento anterior: todos detrás de Caddy comparten IP en el limitador).
5. **Frontend:** `git revert` del commit de B3 en `frontend` (vuelve `usesCleartextTraffic: true` y la URL HTTP). Solo hace falta si hay que publicar con urgencia un APK contra HTTP.
6. **Código backend:** `git revert` del commit de B3 en `backend`.
