FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js db.js schema.sql ./
COPY views ./views
COPY public ./public

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3002
ENV DB_PATH=/app/data/hours.db

EXPOSE 3002

CMD ["node", "server.js"]
