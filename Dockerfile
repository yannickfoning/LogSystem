FROM node:20-alpine AS runner

RUN apk add --no-cache openssl curl unzip p7zip unrar
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && adduser -S logsystem -u 1001

COPY --chown=logsystem:nodejs package*.json ./
RUN npm install --legacy-peer-deps --production

COPY --chown=logsystem:nodejs . .

RUN mkdir -p /app/uploads /app/logs && \
    chown -R logsystem:nodejs /app/uploads /app/logs

USER logsystem

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:10000/health || exit 1

CMD ["node", "server.js"]
