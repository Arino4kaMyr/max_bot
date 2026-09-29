# --- сборка ---
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

RUN npm prune --omit=dev

# --- исполнение ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY seed ./seed
COPY certs ./certs

# Часть узлов botapi.max.ru отдаёт неполную цепочку TLS — подкладываем
# публичные сертификаты промежуточного и корневого УЦ.
ENV NODE_EXTRA_CA_CERTS=/app/certs/max-ru-ca.pem

# Не работаем под root.
USER node

CMD ["node", "dist/main.js"]
