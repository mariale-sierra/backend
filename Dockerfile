# B6: multi-stage build. Targets:
#   prod (default, last stage) — what the VM runs via raiz/docker-compose.yml:
#        production deps + dist/ + what the migration runner needs, non-root,
#        with a HEALTHCHECK on GET /health.
#   dev  — full source + devDependencies, `npm run dev` (nest --watch).
#        Selected with `target: dev` (raiz/docker-compose.local.yml).
# Same Node major as CI (.github/workflows/ci.yml) and the AWS SDK's minimum.
ARG NODE_IMAGE=node:22-bookworm-slim

# ---- deps: every dependency, reproducible from package-lock.json ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile TypeScript ----------------------------------------------
FROM deps AS build
COPY . .
RUN npm run build

# ---- dev: source + devDependencies, for the local compose flow ------------
FROM build AS dev
# nest --watch rewrites dist/ (deleteOutDir), so the tree must belong to the
# unprivileged user it runs as.
RUN chown -R node:node /app
USER node
EXPOSE 3000
# "npm run dev" runs db:migrate first via the "predev" hook.
CMD ["npm", "run", "dev"]

# ---- prod-deps: runtime dependencies only (pg for the migration runner is one)
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- prod -------------------------------------------------------------------
FROM ${NODE_IMAGE} AS prod
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PORT=3000
WORKDIR /app
# Everything stays owned by root and read-only for `node`: the app never
# writes to its own tree (uploads go to R2, logs to stdout), so a compromised
# process can't rewrite its code or migrations.
COPY package.json package-lock.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Migration runner (prestart hook -> database/scripts/migrate.js) and the SQL
# it applies. importers/ and demo/ are dev-only tools and stay out.
COPY database/scripts ./database/scripts
COPY database/init ./database/init
COPY database/migrations ./database/migrations
COPY database/seeds ./database/seeds
# Azure Postgres root CAs (B3, DB_SSL_CA_PATH=/app/certs/...).
COPY certs ./certs
USER node
EXPOSE 3000
# Liveness only (no DB): a slow Azure Postgres must not get the container
# restarted. start-period covers the migrations that run before the API boots.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# "npm start" runs db:migrate first via the "prestart" hook in package.json
# (applies any pending database/init, database/migrations and database/seeds
# files, tracked in havit.schema_migrations), then boots the API. See "Base
# de datos y migraciones" in CLAUDE.md.
CMD ["npm", "start"]
