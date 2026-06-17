# ── Stage 1: Dépendances production ──────────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl python3 make g++
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl curl
WORKDIR /app
ENV NODE_ENV=production

# Utilisateur non-root
RUN addgroup -g 1001 -S nodejs && adduser -S logsystem -u 1001

# Copier node_modules depuis stage deps
COPY --from=deps --chown=logsystem:nodejs /app/node_modules ./node_modules

# Copier les fichiers sources backend
COPY --chown=logsystem:nodejs package.json yarn.lock ./
COPY --chown=logsystem:nodejs server.js ./server.js
COPY --chown=logsystem:nodejs config ./config
COPY --chown=logsystem:nodejs lib ./lib
COPY --chown=logsystem:nodejs middleware ./middleware
COPY --chown=logsystem:nodejs routes ./routes
COPY --chown=logsystem:nodejs services ./services
COPY --chown=logsystem:nodejs workers ./workers
COPY --chown=logsystem:nodejs db ./db
COPY --chown=logsystem:nodejs public ./public
COPY --chown=logsystem:nodejs scripts ./scripts

# Créer les répertoires de travail
RUN mkdir -p /app/uploads /app/logs && chown -R logsystem:nodejs /app/uploads /app/logs

USER logsystem
EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:10000/health || exit 1

CMD ["node", "server.js"]
