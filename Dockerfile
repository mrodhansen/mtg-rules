FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci && npx tsc

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV MTG_RULES_PORT=3848
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY mtg-rules.txt ./
EXPOSE 3848
CMD ["node", "dist/server.js"]
