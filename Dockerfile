FROM node:22-alpine AS fe
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
ENV VITE_BASE=/
RUN npm run build

FROM node:22-alpine AS be
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci && npx tsc

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV MTG_RULES_PORT=3848
ENV FRONTEND_DIR=/app/frontend/dist
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=be /app/dist ./dist
COPY --from=fe /fe/dist ./frontend/dist
COPY mtg-rules.txt ./
EXPOSE 3848
CMD ["node", "dist/server.js"]
