FROM node:20

WORKDIR /app

COPY package*.json ./

RUN npm install --legacy-peer-deps

COPY . .

RUN npm run build

EXPOSE 3000

# Applies any pending database/init, database/migrations and database/seeds
# files (tracked in havit.schema_migrations) before every start, then boots
# the API. See "Base de datos y migraciones" in CLAUDE.md.
CMD ["sh", "-c", "npm run db:migrate && node dist/main.js"]
