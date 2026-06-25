FROM node:20-alpine AS deps

RUN apk add --no-cache openssl python3 make g++ p7zip
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runner

RUN apk add --no-cache openssl curl p7zip
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && adduser -S logsystem -u 1001

COPY --from=deps --chown=logsystem:nodejs /app/node_modules ./node_modules
COPY --chown=logsystem:nodejs package.json package-lock.json server.js ./
COPY --chown=logsystem:nodejs config ./config
COPY --chown=logsystem:nodejs db ./db
COPY --chown=logsystem:nodejs lib ./lib
COPY --chown=logsystem:nodejs middleware ./middleware
COPY --chown=logsystem:nodejs public ./public
COPY --chown=logsystem:nodejs routes ./routes
COPY --chown=logsystem:nodejs services ./services
COPY --chown=logsystem:nodejs workers ./workers

RUN mkdir -p /app/uploads /app/logs && chown -R logsystem:nodejs /app/uploads /app/logs

USER logsystem
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "server.js"]
