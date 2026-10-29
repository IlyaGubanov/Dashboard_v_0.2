# Сборка из корня репозитория: docker compose build api
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @mvs/api --workspace @mvs/shared --include-workspace-root --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @mvs/shared \
 && npm run db:generate -w @mvs/api \
 && npm run build -w @mvs/api

FROM node:22-alpine
RUN apk add --no-cache openssl
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 3000
# при каждом старте: применить новые миграции, дозаполнить справочники (идемпотентно),
# при DEMO_DATA=true — загрузить демо-данные в пустые направления, запустить API
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts && if [ \"$DEMO_DATA\" = \"true\" ]; then npx tsx prisma/demo/import.ts; fi && node dist/main.js"]
