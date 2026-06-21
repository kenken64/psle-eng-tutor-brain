# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG VITE_ASSET_BASE_URL
ENV VITE_ASSET_BASE_URL=${VITE_ASSET_BASE_URL}
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

COPY --from=builder /app/dist ./dist
COPY package.json package-lock.json server.js ./

EXPOSE 8080

CMD ["node", "server.js"]
