# ── Stage 1: Dépendances ──────────────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl python3 make g++
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=false

# ── Stage 2: Build Next.js ────────────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ARG SESSION_SECRET
ENV SESSION_SECRET=${SESSION_SECRET}
RUN yarn build

# ── Stage 3: Production ───────────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl curl
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Utilisateur non-root
RUN addgroup -g 1001 -S nodejs && adduser -S logsystem -u 1001

# Copier le standalone Next.js
COPY --from=builder --chown=logsystem:nodejs /app/.next/standalone ./
COPY --from=builder --chown=logsystem:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=logsystem:nodejs /app/public ./public

# Copier les fichiers Express/Node backend
COPY --from=builder --chown=logsystem:nodejs /app/config ./config
COPY --from=builder --chown=logsystem:nodejs /app/lib ./lib
COPY --from=builder --chown=logsystem:nodejs /app/middleware ./middleware
COPY --from=builder --chown=logsystem:nodejs /app/routes ./routes
COPY --from=builder --chown=logsystem:nodejs /app/services ./services
COPY --from=builder --chown=logsystem:nodejs /app/workers ./workers
COPY --from=builder --chown=logsystem:nodejs /app/db ./db
COPY --from=builder --chown=logsystem:nodejs /app/server.js ./server.js
COPY --from=builder --chown=logsystem:nodejs /app/package.json ./package.json

# Copier node_modules complets (backend en a besoin)
COPY --from=deps --chown=logsystem:nodejs /app/node_modules ./node_modules

RUN mkdir -p /app/uploads /app/logs && chown -R logsystem:nodejs /app/uploads /app/logs

USER logsystem
EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:10000/health || exit 1

CMD ["node", "server.js"]
