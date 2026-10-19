# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

# Runtime stage
FROM node:22-alpine AS runner

RUN apk add --no-cache openssl curl unzip p7zip

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=10000

RUN addgroup -g 1001 -S nodejs && adduser -S logsystem -u 1001

COPY --chown=logsystem:nodejs --from=builder /app/node_modules ./node_modules
COPY --chown=logsystem:nodejs package*.json ./
COPY --chown=logsystem:nodejs . .

RUN mkdir -p /app/uploads /app/logs /app/temp && \
    chown -R logsystem:nodejs /app/uploads /app/logs /app/temp

USER logsystem

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:10000/health || exit 1

CMD ["node", "server.js"]
