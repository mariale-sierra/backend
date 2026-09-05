FROM node:20

WORKDIR /app

COPY package*.json ./

RUN npm install --legacy-peer-deps

COPY . .

RUN npm run build

EXPOSE 3000

# "npm start" runs db:migrate first via the "prestart" hook in package.json
# (applies any pending database/init, database/migrations and database/seeds
# files, tracked in havit.schema_migrations), then boots the API. See "Base
# de datos y migraciones" in CLAUDE.md.
CMD ["npm", "start"]
