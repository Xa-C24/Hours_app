FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY db.js ./
COPY db-sqlite.js ./
COPY db-postgres.js ./
COPY settings.js ./
COPY excel-export.js ./
COPY pdf-export.js ./
COPY views ./views
COPY public ./public
COPY assets/fonts ./assets/fonts

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3002
ENV DB_PATH=/app/data/hours.db

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3002}/healthz`).then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "server.js"]
