# ---- deps: install once, cached on lockfile ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts

# ---- build: generate the Prisma client, compile TS ----
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ---- prod deps only ----
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# ---- runtime: slim, non-root ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache dumb-init && \
    addgroup -S app && adduser -S app -G app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build     /app/dist         ./dist
COPY --from=build     /app/prisma       ./prisma
COPY prisma.config.ts package.json ./

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# dumb-init reaps zombies and forwards SIGTERM so Nest's shutdown hooks fire.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main"]
